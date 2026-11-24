import { BadRequestException, ConflictException, Controller, Get, Injectable, NotFoundException, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Competition } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { Actor, audit, lockStaff, Public, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { Database } from '../database/database.module';
import { body, bodyDocs, param } from '../system/input';
import { AttemptService, lockCompetition } from './attempt.service';
import { databaseTime, effectiveStatus, gradeSelections } from './competition-data';
import { snapshotInput } from './competition.input';
import { denseRanking } from './ranking';

const settings = z.strictObject({
  tiePolicy: z.enum(['SCORE_THEN_TIME', 'SCORE_ONLY']),
  scopes: z.array(z.union([z.literal('overall'), z.uuid()])).max(51),
});
const revisionInput = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/) });
type Settings = z.infer<typeof settings>;

function legacySignature(questions: { snapshot: Prisma.JsonValue }[]) {
  if (!questions.length) return null;
  const signatures = questions.map(({ snapshot }) => {
    const parsed = snapshotInput.safeParse(snapshot);
    if (!parsed.success) return null;
    const q = parsed.data;
    const key = new Set(q.correctOrder);
    const items = q.type === 'MCQ'
      ? q.items.map(({ id, text }) => JSON.stringify([text, key.has(id)])).sort()
      : q.correctOrder.map(id => q.items.find(item => item.id === id)?.text);
    return JSON.stringify([q.text, q.imageUrl ?? null, q.type, q.points, q.type === 'SORTING' ? q.sortingMode : null, items]);
  });
  return signatures.includes(null) ? null : JSON.stringify(signatures.sort());
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly db: Database, private readonly attempts: AttemptService) {}

  private async view(tx: Prisma.TransactionClient, competition: Competition, now: Date) {
    const grades = await tx.competitionGrade.findMany({
      where: { competitionId: competition.id },
      include: { grade: { select: { name: true } }, questions: gradeSelections.include.questions },
      orderBy: { gradeId: 'asc' },
    });
    const signatures = competition.sharedQuestions ? [] : grades.map(g => legacySignature(g.questions));
    const overallAvailable = grades.length > 0 && (competition.sharedQuestions ||
      (signatures[0] !== null && signatures.every(signature => signature === signatures[0])));
    const gradeNames = new Map(grades.map(g => [g.gradeId, g.grade.name]));
    const attempts = await tx.attempt.findMany({
      where: { competitionId: competition.id, status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
      select: { studentId: true, gradeId: true, score: true, maxScore: true, startedAt: true, finishedAt: true,
        student: { select: { displayLabel: true } } },
    });
    const tiePolicy = competition.leaderboardTiePolicy ?? competition.tiePolicy;
    const rows = attempts.map(attempt => ({
      ...attempt,
      alias: 'Player ' + createHmac('sha256', competition.leaderboardAliasKey).update(attempt.studentId).digest('hex').slice(0, 20).toUpperCase(),
    })).sort((a, b) => a.alias.localeCompare(b.alias));
    const scopes = [...(overallAvailable ? [{ scope: 'overall', name: null }] : []),
      ...grades.map(g => ({ scope: g.gradeId, name: g.grade.name }))];
    const boards = scopes.map(board => ({
      ...board,
      rows: denseRanking(board.scope === 'overall' ? rows : rows.filter(row => row.gradeId === board.scope), tiePolicy)
        .map(({ attempt, rank }) => ({
          rank, alias: attempt.alias, grade: gradeNames.get(attempt.gradeId) ?? '',
          score: Number(attempt.score), maxScore: attempt.maxScore, name: attempt.student.displayLabel,
        })),
    }));
    const publicBoards = boards.filter(board => competition.leaderboardScopes.includes(board.scope))
      .map(board => ({ ...board, rows: board.rows.map(({ name: _name, ...row }) => row) }));
    const publication = { title: competition.title, boards: publicBoards };
    const revision = createHash('sha256').update(JSON.stringify([tiePolicy, publication])).digest('hex');
    return { overallAvailable, tiePolicy, boards, scopes: competition.leaderboardScopes,
      publication, revision,
      published: competition.publicLeaderboard !== null, status: effectiveStatus(competition, now) };
  }

  private transaction<T>(actor: StaffPrincipal, id: string,
    operation: (tx: Prisma.TransactionClient, competition: Competition, now: Date) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      const now = await databaseTime(tx);
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      return operation(tx, competition, now);
    }, { timeout: 30000 });
  }

  preview(actor: StaffPrincipal, id: string) {
    return this.transaction(actor, id, async (tx, competition, now) => {
      const view = await this.view(tx, competition, now);
      return { ...view, publication: competition.publicLeaderboard ?? view.publication };
    });
  }

  configure(actor: StaffPrincipal, id: string, input: Settings) {
    return this.transaction(actor, id, async (tx, competition, now) => {
      if (competition.publicLeaderboard) throw new ConflictException('Unpublish the leaderboard before changing its settings');
      const view = await this.view(tx, competition, now);
      const allowed = new Set(view.boards.map(board => board.scope));
      if (new Set(input.scopes).size !== input.scopes.length || input.scopes.some(scope => !allowed.has(scope))) {
        throw new BadRequestException('Select valid, distinct boards');
      }
      const updated = await tx.competition.update({
        where: { id }, data: { leaderboardTiePolicy: input.tiePolicy, leaderboardScopes: input.scopes },
      });
      await audit(tx, actor, 'LEADERBOARD_CONFIGURED', { competitionId: id, ...input });
      return this.view(tx, updated, now);
    });
  }

  publish(actor: StaffPrincipal, id: string, revision: string) {
    return this.transaction(actor, id, async (tx, competition, now) => {
      const view = await this.view(tx, competition, now);
      if (view.published) throw new ConflictException('Unpublish before replacing published boards');
      if (!['CLOSED', 'ARCHIVED'].includes(view.status)) throw new ConflictException('Close the competition first');
      if (!view.publication.boards.length) throw new BadRequestException('Choose at least one board to publish');
      if (view.revision !== revision) throw new ConflictException('Standings changed. Refresh and review the public preview');
      await tx.competition.update({ where: { id }, data: { publicLeaderboard: view.publication } });
      await audit(tx, actor, 'LEADERBOARD_PUBLISHED', { competitionId: id, scopes: view.scopes });
      return { ...view, published: true };
    });
  }

  unpublish(actor: StaffPrincipal, id: string) {
    return this.transaction(actor, id, async (tx, competition, now) => {
      if (competition.publicLeaderboard) {
        await tx.competition.update({ where: { id }, data: { publicLeaderboard: Prisma.DbNull } });
        await audit(tx, actor, 'LEADERBOARD_UNPUBLISHED', { competitionId: id });
      }
      return { ...await this.view(tx, competition, now), published: false };
    });
  }

  async refreshPublished(tx: Prisma.TransactionClient, id: string) {
    const competition = await tx.competition.findUniqueOrThrow({ where: { id } });
    if (!competition.publicLeaderboard) return;
    const { publication } = await this.view(tx, competition, await databaseTime(tx));
    await tx.competition.update({ where: { id }, data: { publicLeaderboard: publication } });
  }

  async publicBoard(id: string) {
    const competition = await this.db.competition.findUnique({
      where: { id }, select: { publicLeaderboard: true },
    });
    if (!competition?.publicLeaderboard) throw new NotFoundException('Leaderboard is not published');
    return competition.publicLeaderboard;
  }
}

@ApiTags('Leaderboards')
@Controller()
export class LeaderboardController {
  constructor(private readonly boards: LeaderboardService) {}

  @Roles('SUPER_ADMIN')
  @Get('admin/competitions/:id/leaderboard')
  preview(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.boards.preview(actor, id);
  }

  @Roles('SUPER_ADMIN')
  @Put('admin/competitions/:id/leaderboard')
  @bodyDocs(settings)
  configure(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(settings) input: Settings) {
    return this.boards.configure(actor, id, input);
  }

  @Roles('SUPER_ADMIN')
  @Post('admin/competitions/:id/leaderboard/publish')
  @bodyDocs(revisionInput)
  publish(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(revisionInput) input: z.infer<typeof revisionInput>) {
    return this.boards.publish(actor, id, input.revision);
  }

  @Roles('SUPER_ADMIN')
  @Post('admin/competitions/:id/leaderboard/unpublish')
  unpublish(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.boards.unpublish(actor, id);
  }

  @Public()
  @Get('leaderboards/:id')
  publicBoard(@param('id') id: string) {
    return this.boards.publicBoard(id);
  }
}
