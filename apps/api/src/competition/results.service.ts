import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Attempt, Prisma, TiePolicy } from '@prisma/client';
import { Workbook } from 'exceljs';
import { gradeScope, lockStaff, StaffPrincipal } from '../auth/principal';
import { Database } from '../database/database.module';
import { AttemptService, lockCompetition, lockStudent, StudentPrincipal } from './attempt.service';
import { denseRanking } from './ranking';
import { databaseTime, effectiveStatus } from './competition-data';

type Tx = Prisma.TransactionClient;
const rankingFields = { id: true, gradeId: true, studentId: true, score: true, maxScore: true, startedAt: true, finishedAt: true } as const;
type Ranked = Pick<Attempt, keyof typeof rankingFields>;

function rankAttempts(attempts: Ranked[], tiePolicy: TiePolicy) {
  const groups = new Map<string, Ranked[]>();
  for (const attempt of attempts) {
    const group = groups.get(attempt.gradeId) ?? [];
    group.push(attempt);
    groups.set(attempt.gradeId, group);
  }
  const ranks = new Map<string, number>();
  for (const group of groups.values()) {
    for (const { attempt, rank } of denseRanking(group, tiePolicy)) ranks.set(attempt.id, rank);
  }
  return ranks;
}

@Injectable()
export class ResultsService {
  constructor(private readonly db: Database, private readonly attempts: AttemptService) {}

  private async ranked(tx: Tx, competitionId: string, gradeIds: string[], tiePolicy: TiePolicy) {
    const attempts = await tx.attempt.findMany({
      where: { competitionId, gradeId: { in: gradeIds }, status: { in: ['SUBMITTED', 'TIMED_OUT'] } }, select: rankingFields,
    });
    return rankAttempts(attempts, tiePolicy);
  }

  async report(actor: StaffPrincipal, id: string, results = false) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const scope = await gradeScope(tx, actor);
      const competition = await lockCompetition(tx, id);
      const grades = await tx.competitionGrade.findMany({
        where: { competitionId: id, gradeId: scope ? { in: scope } : undefined }, select: { gradeId: true },
      });
      if (scope && (!grades.length || competition.status === 'DRAFT')) throw new ForbiddenException();
      if (results && actor.role === 'SERVANT' && !competition.publishedAt) throw new ForbiddenException('Results have not been published');
      const gradeIds = grades.map(({ gradeId }) => gradeId);
      const where = { competitionId: id, gradeId: { in: gradeIds } };
      await this.attempts.reconcileScope(tx, where, await databaseTime(tx));
      const [attempts, roster] = await Promise.all([
        tx.attempt.findMany({
          where: { ...where, status: { not: 'INVALIDATED' } },
          include: { student: { select: { displayLabel: true } } },
        }),
        tx.student.findMany({
          where: { gradeId: { in: gradeIds }, status: { not: 'SUSPENDED' } },
          select: { id: true, gradeId: true, displayLabel: true },
        }),
      ]);
      const ranks = results ? rankAttempts(attempts.filter((attempt) => attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT'), competition.tiePolicy) : undefined;
      const showScores = actor.role === 'SUPER_ADMIN' || !!competition.publishedAt;
      const counts = { notStarted: 0, inProgress: 0, completed: 0, timedOut: 0 };
      const started = new Set(attempts.map((attempt) => attempt.studentId));
      const students = attempts.map((attempt) => {
        const score = showScores && (attempt.status === 'SUBMITTED' || attempt.status === 'TIMED_OUT') ? Number(attempt.score) : null;
        if (attempt.status === 'AWAITING_START') counts.notStarted++;
        if (attempt.status === 'IN_PROGRESS') counts.inProgress++;
        if (attempt.status === 'SUBMITTED') counts.completed++;
        if (attempt.status === 'TIMED_OUT') counts.timedOut++;
        return {
          studentId: attempt.studentId, gradeId: attempt.gradeId, attemptId: attempt.id as string | null,
          displayLabel: attempt.student.displayLabel, status: attempt.status as string, score,
          maxScore: attempt.maxScore || null, ...(results ? { rank: ranks?.get(attempt.id) ?? null } : {}),
        };
      });
      for (const student of roster) {
        if (started.has(student.id)) continue;
        counts.notStarted++;
        students.push({
          studentId: student.id, gradeId: student.gradeId, attemptId: null,
          displayLabel: student.displayLabel, status: 'NOT_STARTED', score: null, maxScore: null,
          ...(results ? { rank: null } : {}),
        });
      }
      students.sort((a, b) => a.gradeId.localeCompare(b.gradeId) || (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.displayLabel.localeCompare(b.displayLabel));
      return { counts, students };
    }, { timeout: 30000 });
  }

  async export(actor: StaffPrincipal, id: string, format: 'csv' | 'xlsx') {
    const { students } = await this.report(actor, id, true);
    const rows = [
      ['Name', 'Grade ID', 'Status', 'Score', 'Maximum score', 'Rank'],
      ...students.map((row) => [row.displayLabel, row.gradeId, row.status, row.score, row.maxScore, row.rank ?? null]),
    ];
    if (format === 'csv') {
      const csv = rows.map((row) => row.map((cell) => {
        const value = typeof cell === 'string' && /^[\s]*[=+\-@]/u.test(cell) ? `'${cell}` : String(cell ?? '');
        return `"${value.replaceAll('"', '""')}"`;
      }).join(',')).join('\r\n');
      return Buffer.from(`\uFEFF${csv}\r\n`);
    }
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Results');
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    [36, 40, 24, 12, 18, 12].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async student(actor: StudentPrincipal, id?: string) {
    return this.db.$transaction(async (tx) => {
      const student = await lockStudent(tx, actor.id);
      const candidates = await tx.competition.findMany({
        where: {
          id, status: { not: 'DRAFT' },
          OR: [
            { status: { not: 'ARCHIVED' }, grades: { some: { gradeId: student.gradeId } } },
            { attempts: { some: { studentId: actor.id, status: { not: 'INVALIDATED' } } } },
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (id && !candidates.length) throw new NotFoundException('Competition was not found');
      const items = [];
      for (const { id: competitionId } of candidates) {
        const competition = await lockCompetition(tx, competitionId);
        const now = await databaseTime(tx);
        await this.attempts.reconcileScope(tx, { competitionId, studentId: actor.id }, now);
        const attempt = await tx.attempt.findFirst({
          where: { competitionId, studentId: actor.id, status: { not: 'INVALIDATED' } },
        });
        const gradeId = attempt?.gradeId ?? student.gradeId;
        const selection = await tx.competitionGrade.findUniqueOrThrow({
          where: { competitionId_gradeId: { competitionId, gradeId } },
          include: { _count: { select: { questions: true } } },
        });
        let result = null;
        if (competition.publishedAt && attempt) {
          const ranks = await this.ranked(tx, competitionId, [gradeId], competition.tiePolicy);
          const rank = ranks.get(attempt.id);
          if (rank !== undefined) result = { score: Number(attempt.score), maxScore: attempt.maxScore, rank };
        }
        const { title, description, instructions, opensAt, closesAt, durationMinutes } = competition;
        items.push({
          id: competition.id, title, description, instructions, opensAt, closesAt, durationMinutes,
          questionCount: selection._count.questions, status: effectiveStatus(competition, now),
          attemptId: attempt?.id ?? null, attemptStatus: attempt?.status ?? null, result,
        });
      }
      items.sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime());
      return id ? items[0] : items;
    }, { timeout: 30000 });
  }
}
