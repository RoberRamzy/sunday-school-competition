import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Attempt, Competition, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { audit, groupOf, lockStaff, requireGrade, StaffPrincipal } from '../auth/principal';
import type { Principal } from '../auth/principal';
import { Database } from '../database/database.module';
import { databaseTime, effectiveStatus } from './competition-data';
import { answerInput, snapshotInput } from './competition.input';

export type StudentPrincipal = Extract<Principal, { role: 'STUDENT' }>;
type Tx = Prisma.TransactionClient;

export function shuffle<T>(input: readonly T[], draw: (min: number, max: number) => number = randomInt) {
  const result = [...input];
  for (let index = result.length - 1; index > 0; index--) {
    const selected = draw(0, index + 1);
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}

export async function lockCompetition(tx: Tx, id: string, exclusive = false) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Competition" WHERE id = ${id}::uuid
    ${exclusive ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}
  `;
  if (!rows.length) throw new NotFoundException('Competition was not found');
  return tx.competition.findUniqueOrThrow({ where: { id } });
}

async function lockAttempt(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Attempt" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Attempt was not found');
  return tx.attempt.findUniqueOrThrow({ where: { id } });
}

export async function lockStudent(tx: Tx, id: string) {
  const [student] = await tx.$queryRaw<{ gradeId: string; status: string }[]>`
    SELECT "gradeId", status FROM "Student" WHERE id = ${id}::uuid FOR UPDATE
  `;
  if (student?.status !== 'ACTIVE') throw new ForbiddenException();
  return student;
}

@Injectable()
export class AttemptService {
  constructor(private readonly db: Database) {}

  async start(actor: StudentPrincipal, competitionId: string) {
    return this.db.$transaction(async (tx) => {
      const student = await lockStudent(tx, actor.id);
      const competition = await lockCompetition(tx, competitionId, true);
      if (competition.groupId !== groupOf(actor)) throw new NotFoundException('Competition was not found');
      const current = await tx.attempt.findFirst({
        where: { competitionId, studentId: actor.id, status: { not: 'INVALIDATED' } },
      });
      const attempt = current ? await lockAttempt(tx, current.id) : undefined;
      const now = await databaseTime(tx);
      if (attempt && attempt.status !== 'AWAITING_START') {
        return this.state(tx, await this.reconcile(tx, attempt, now), now);
      }
      const gradeId = attempt?.gradeId ?? student.gradeId;
      if (student.gradeId !== gradeId) throw new ForbiddenException('Grade is no longer eligible');
      const grade = await tx.competitionGrade.findUnique({
        where: { competitionId_gradeId: { competitionId, gradeId } },
        include: { questions: { orderBy: { position: 'asc' } } },
      });
      if (!grade) throw new ForbiddenException('Grade is not eligible');
      if (effectiveStatus(competition, now) !== 'ACTIVE') throw new ConflictException('Competition is outside its entry window');
      if (!competition.hasStarted) await tx.competition.update({ where: { id: competitionId }, data: { hasStarted: true } });
      const snapshots = grade.questions.map((row) => snapshotInput.parse(row.snapshot));
      if (!snapshots.length) throw new ConflictException('Competition quiz is not configured');
      const { timerEnabled } = competition;
      const expiresAt = timerEnabled ? new Date(Math.min(now.getTime() + competition.durationMinutes * 60000, competition.closesAt.getTime())) : competition.closesAt;
      const data = { status: 'IN_PROGRESS' as const, startedAt: now, expiresAt, timerEnabled, maxScore: snapshots.reduce((sum, row) => sum + row.points, 0) };
      const started = attempt
        ? await tx.attempt.update({ where: { id: attempt.id }, data })
        : await tx.attempt.create({ data: { ...data, studentId: actor.id, competitionId, gradeId } });
      await tx.attemptQuestion.createMany({
        data: shuffle(snapshots).map((snapshot, position) => ({
          attemptId: started.id, questionId: snapshot.id, position, snapshot,
          itemOrder: shuffle(snapshot.items.map((item) => item.id)),
        })),
      });
      await audit(tx, actor, 'ATTEMPT_STARTED', { attemptId: started.id, competitionId });
      return this.state(tx, started, now);
    }, { timeout: 15000 });
  }

  private async owned<T>(actor: StudentPrincipal, id: string, handle: (tx: Tx, attempt: Attempt, now: Date) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await lockStudent(tx, actor.id);
      const owner = await tx.attempt.findFirst({ where: { id, studentId: actor.id }, select: { competitionId: true } });
      if (!owner) throw new NotFoundException('Attempt was not found');
      await lockCompetition(tx, owner.competitionId);
      const attempt = await lockAttempt(tx, id);
      const now = await databaseTime(tx);
      return handle(tx, await this.reconcile(tx, attempt, now), now);
    });
  }

  async status(actor: StudentPrincipal, id: string) {
    return this.owned(actor, id, (tx, attempt, now) => this.state(tx, attempt, now));
  }

  async answer(actor: StudentPrincipal, id: string, input: z.infer<typeof answerInput>) {
    return this.owned(actor, id, async (tx, attempt, now) => {
      if (attempt.status !== 'IN_PROGRESS') return this.state(tx, attempt, now);
      const question = await tx.attemptQuestion.findUnique({
        where: { attemptId_questionId: { attemptId: id, questionId: input.questionId } },
        include: { answer: true },
      });
      if (!question) throw new BadRequestException('Question is not in this attempt');
      const previous = question.answer;
      const sameItems = previous && equalOrder(previous.itemIds, input.itemIds);
      if (previous?.revision === input.revision) {
        if (sameItems && Boolean(previous.lockedAt) === input.advance) return this.state(tx, attempt, now);
        throw new ConflictException('This answer revision was already used');
      }
      if (question.position !== attempt.position || previous?.lockedAt || (previous && input.revision < previous.revision)) {
        throw new ConflictException('This answer revision is stale');
      }
      const snapshot = snapshotInput.parse(question.snapshot);
      const ids = new Set(input.itemIds);
      if (!(input.advance && input.itemIds.length === 0) && (ids.size !== input.itemIds.length ||
          ids.size !== (snapshot.type === 'MCQ' ? 1 : snapshot.items.length) ||
          input.itemIds.some((item) => !question.itemOrder.includes(item)))) {
        throw new BadRequestException('Choose the expected question items');
      }
      const data = { itemIds: input.itemIds, revision: input.revision, savedAt: now, lockedAt: input.advance ? now : null };
      await tx.attemptAnswer.upsert({
        where: { attemptQuestionId: question.id }, create: { attemptQuestionId: question.id, ...data }, update: data,
      });
      const next = input.advance
        ? await tx.attempt.update({ where: { id }, data: { position: { increment: 1 } } })
        : attempt;
      return this.state(tx, next, now);
    });
  }

  async submit(actor: StudentPrincipal, id: string) {
    return this.owned(actor, id, async (tx, attempt, now) => {
      if (attempt.status === 'AWAITING_START') throw new ConflictException('Start the replacement first');
      const next = attempt.status === 'IN_PROGRESS'
        ? await this.finish(tx, attempt, 'SUBMITTED', now)
        : attempt;
      return this.state(tx, next, now);
    });
  }

  async reconcile(tx: Tx, attempt: Attempt, now: Date) {
    if (attempt.status === 'IN_PROGRESS' && attempt.expiresAt && now >= attempt.expiresAt) {
      return this.finish(tx, attempt, 'TIMED_OUT', now);
    }
    return attempt;
  }

  async reconcileScope(tx: Tx, where: Prisma.AttemptWhereInput, cutoff: Date) {
    const overdue = await tx.attempt.findMany({
      where: { ...where, status: 'IN_PROGRESS', expiresAt: { lte: cutoff } },
      orderBy: { id: 'asc' }, select: { id: true },
    });
    for (const row of overdue) {
      const current = await lockAttempt(tx, row.id);
      await this.reconcile(tx, current, await databaseTime(tx));
    }
  }

  private async finish(tx: Tx, attempt: Attempt, status: 'SUBMITTED' | 'TIMED_OUT', now: Date) {
    const finishedAt = status === 'SUBMITTED' ? now : attempt.expiresAt!;
    const questions = await tx.attemptQuestion.findMany({ where: { attemptId: attempt.id }, include: { answer: true } });
    const { stats, scores } = this.score(questions, attempt.maxScore);
    await this.saveEarnedPoints(tx, scores, finishedAt);
    const final = await tx.attempt.update({ where: { id: attempt.id }, data: {
      ...stats, status, finishedAt, submittedAt: status === 'SUBMITTED' ? now : undefined,
    } });
    await tx.auditLog.create({
      data: {
        actorType: status === 'SUBMITTED' ? 'STUDENT' : 'SYSTEM', actorId: attempt.studentId,
        eventType: status === 'SUBMITTED' ? 'ATTEMPT_SUBMITTED' : 'ATTEMPT_TIMED_OUT',
        metadataJson: { attemptId: attempt.id, competitionId: attempt.competitionId, finishedAt: finishedAt.toISOString(), processedAt: now.toISOString() },
      },
    });
    return final;
  }

  private score(questions: Prisma.AttemptQuestionGetPayload<{ include: { answer: true } }>[], maxScore: number) {
    let cents = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    const scores: Prisma.Sql[] = [];
    for (const question of questions) {
      if (!question.answer?.itemIds.length) {
        unansweredCount++;
        if (question.answer) scores.push(Prisma.sql`(${question.id}::uuid, 0::decimal)`);
        continue;
      }
      const answer = question.answer;
      const snapshot = snapshotInput.parse(question.snapshot);
      const matching = snapshot.correctOrder.filter((id, index) => id === answer.itemIds[index]).length;
      const correct = matching === snapshot.correctOrder.length;
      if (correct) correctCount++;
      else incorrectCount++;
      const total = snapshot.points * 100;
      const partial = snapshot.type === 'SORTING' && snapshot.sortingMode === 'PARTIAL';
      // Integer cents, rounded half up per question before adding to the total.
      const earned = correct ? total : partial ? Math.floor((2 * total * matching + snapshot.items.length) / (2 * snapshot.items.length)) : 0;
      cents += earned;
      scores.push(Prisma.sql`(${question.id}::uuid, ${(earned / 100).toFixed(2)}::decimal)`);
    }
    return { scores, stats: {
      correctCount, incorrectCount, unansweredCount, score: (cents / 100).toFixed(2),
      percentage: (maxScore ? (cents / maxScore).toFixed(2) : 0),
    } };
  }

  private async saveEarnedPoints(tx: Tx, scores: Prisma.Sql[], finishedAt?: Date) {
    if (!scores.length) return;
    const lockAnswers = finishedAt ? Prisma.sql`, "lockedAt" = COALESCE(answer."lockedAt", ${finishedAt})` : Prisma.empty;
    await tx.$executeRaw`
      UPDATE "AttemptAnswer" AS answer SET "earnedPoints" = scores.earned ${lockAnswers}
      FROM (VALUES ${Prisma.join(scores)}) AS scores(id, earned)
      WHERE answer."attemptQuestionId" = scores.id
    `;
  }

  // The caller holds an exclusive competition lock throughout the correction.
  async regrade(tx: Tx, competitionId: string) {
    const where = { competitionId, status: { in: ['SUBMITTED', 'TIMED_OUT'] } } satisfies Prisma.AttemptWhereInput;
    const batchSize = 25;
    let offset = 0;
    while (true) {
      const attempts = await tx.attempt.findMany({
        where, orderBy: { id: 'asc' }, skip: offset, take: batchSize,
        select: { id: true, maxScore: true, questions: { include: { answer: true } } },
      });
      if (!attempts.length) return offset;
      const counts: Prisma.Sql[] = [];
      const earned: Prisma.Sql[] = [];
      for (const attempt of attempts) {
        const { stats, scores } = this.score(attempt.questions, attempt.maxScore);
        counts.push(Prisma.sql`(${attempt.id}::uuid, ${stats.score}::decimal, ${stats.percentage}::decimal,
          ${stats.correctCount}::integer, ${stats.incorrectCount}::integer, ${stats.unansweredCount}::integer)`);
        earned.push(...scores);
      }
      await this.saveEarnedPoints(tx, earned);
      await tx.$executeRaw`
        UPDATE "Attempt" AS a SET score = stats.score, percentage = stats.percentage,
          "correctCount" = stats.correct, "incorrectCount" = stats.incorrect, "unansweredCount" = stats.unanswered,
          "updatedAt" = clock_timestamp()
        FROM (VALUES ${Prisma.join(counts)}) AS stats(id, score, percentage, correct, incorrect, unanswered)
        WHERE a.id = stats.id
      `;
      offset += attempts.length;
      if (attempts.length < batchSize) return offset;
    }
  }

  private async state(tx: Tx, attempt: Attempt, now: Date) {
    const total = await tx.attemptQuestion.count({ where: { attemptId: attempt.id } });
    const row = attempt.status === 'IN_PROGRESS'
      ? await tx.attemptQuestion.findUnique({
          where: { attemptId_position: { attemptId: attempt.id, position: attempt.position } },
          include: { answer: { select: { itemIds: true, revision: true } } },
        })
      : undefined;
    const snapshot = row ? snapshotInput.parse(row.snapshot) : undefined;
    const items = snapshot ? new Map(snapshot.items.map((item) => [item.id, item])) : undefined;
    return {
      id: attempt.id, competitionId: attempt.competitionId, status: attempt.status, expiresAt: attempt.expiresAt, timerEnabled: attempt.timerEnabled,
      serverTime: now, index: attempt.position, total,
      question: row && snapshot && items
        ? { id: row.questionId, type: snapshot.type, text: snapshot.text, ...(snapshot.imageUrl ? { imageUrl: snapshot.imageUrl } : {}), items: row.itemOrder.map((id) => items.get(id)!) }
        : null,
      savedAnswer: row?.answer?.itemIds ?? null,
      revision: row?.answer?.revision ?? 0,
    };
  }

  private async staffAttempt<T>(
    actor: StaffPrincipal,
    id: string,
    handle: (tx: Tx, attempt: Attempt, now: Date, competition: Competition) => Promise<T>,
    exclusive = false,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const basic = await tx.attempt.findUnique({ where: { id }, select: { competitionId: true, gradeId: true } });
      if (!basic) throw new NotFoundException('Attempt was not found');
      await requireGrade(tx, actor, basic.gradeId);
      const competition = await lockCompetition(tx, basic.competitionId, exclusive);
      if (competition.groupId !== groupOf(actor)) throw new NotFoundException('Attempt was not found');
      const attempt = await lockAttempt(tx, id);
      const now = await databaseTime(tx);
      return handle(tx, await this.reconcile(tx, attempt, now), now, competition);
    });
  }

  async detail(actor: StaffPrincipal, id: string) {
    return this.staffAttempt(actor, id, async (tx, attempt, now, competition) => {
      const canReplace = effectiveStatus(competition, now) === 'ACTIVE' && !attempt.replacesAttemptId &&
        Boolean(attempt.startedAt) && attempt.status !== 'INVALIDATED';
      const events = await tx.auditLog.findMany({
        where: { OR: [
          { metadataJson: { path: ['attemptId'], equals: id } },
          { metadataJson: { path: ['replacementId'], equals: id } },
        ] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, actorType: true, actorId: true, eventType: true, metadataJson: true, createdAt: true },
      });
      const { score, percentage, correctCount, incorrectCount, unansweredCount, ...metadata } = attempt;
      if (actor.role === 'SERVANT' && !competition.publishedAt) return { ...metadata, events, canReplace };
      return { ...metadata, score: Number(score), percentage: Number(percentage), correctCount, incorrectCount, unansweredCount, events, canReplace };
    });
  }

  async flag(actor: StaffPrincipal, id: string, reason: string) {
    return this.staffAttempt(actor, id, async (tx, attempt) => {
      const event = await audit(tx, actor, 'ATTEMPT_FLAGGED', { attemptId: id, competitionId: attempt.competitionId, reason });
      return { id: event.id };
    });
  }

  async replace(actor: StaffPrincipal, id: string, reason: string) {
    return this.staffAttempt(actor, id, async (tx, attempt, now, competition) => {
      if (attempt.replacesAttemptId) throw new ConflictException('A replacement cannot receive another replacement');
      const existing = await tx.attempt.findUnique({ where: { replacesAttemptId: id } });
      if (existing) return { id: existing.id, status: existing.status };
      if (effectiveStatus(competition, now) !== 'ACTIVE') throw new ConflictException('Competition is outside its entry window');
      if (attempt.status === 'INVALIDATED' || !attempt.startedAt) throw new ConflictException('Attempt cannot be replaced');
      await tx.attempt.update({ where: { id }, data: { status: 'INVALIDATED' } });
      const replacement = await tx.attempt.create({
        data: {
          competitionId: attempt.competitionId, studentId: attempt.studentId, gradeId: attempt.gradeId,
          replacesAttemptId: id, status: 'AWAITING_START',
        },
      });
      await audit(tx, actor, 'ATTEMPT_REPLACEMENT_AUTHORIZED', { attemptId: id, replacementId: replacement.id, reason });
      return { id: replacement.id, status: replacement.status };
    }, true);
  }
}

function equalOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
