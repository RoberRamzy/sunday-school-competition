import { BadRequestException, ConflictException, Controller, Get, Injectable, NotFoundException, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Competition } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { Actor, audit, DEFAULT_GROUP_ID, groupOf, lockStaff, Public, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { Database } from '../database/database.module';
import { body, bodyDocs, param } from '../system/input';
import { AttemptService, lockCompetition } from './attempt.service';
import { databaseTime, effectiveStatus, gradeSelections, requireCompetitionManagement } from './competition-data';
import { snapshotInput } from './competition.input';
import { denseRanking } from './ranking';

const settings = z.strictObject({
  tiePolicy: z.enum(['SCORE_THEN_TIME', 'SCORE_ONLY']),
  scopes: z.array(z.union([z.literal('overall'), z.uuid()])).max(51),
});
const revisionInput = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/) });
const overallVisibility = z.strictObject({ published: z.boolean() });
type Settings = z.infer<typeof settings>;

const standing = z.object({ rank: z.number(), grade: z.string(), score: z.number(), maxScore: z.number() });
const savedPublication = z.object({
  title: z.string(),
  boards: z.array(z.object({
    scope: z.string(), name: z.string().nullable(),
    rows: z.array(z.union([standing.extend({ name: z.string() }), standing.extend({ alias: z.string() })])),
  })),
});

function legacyAlias(key: string, studentId: string) {
  return 'Player ' + createHmac('sha256', key).update(studentId).digest('hex').slice(0, 20).toUpperCase();
}

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
        student: { select: { fullName: true } } },
    });
    const tiePolicy = competition.leaderboardTiePolicy ?? competition.tiePolicy;
    const rows = attempts.sort((a, b) => a.student.fullName.localeCompare(b.student.fullName) ||
      a.studentId.localeCompare(b.studentId));
    const scopes = [...(overallAvailable ? [{ scope: 'overall', name: null }] : []),
      ...grades.map(g => ({ scope: g.gradeId, name: g.grade.name }))];
    const boards = scopes.map(board => ({
      ...board,
      rows: denseRanking(board.scope === 'overall' ? rows : rows.filter(row => row.gradeId === board.scope), tiePolicy)
        .map(({ attempt, rank }) => ({
          rank, grade: gradeNames.get(attempt.gradeId) ?? '',
          score: Number(attempt.score), maxScore: attempt.maxScore, name: attempt.student.fullName,
        })),
    }));
    const publicBoards = boards.filter(board => competition.leaderboardScopes.includes(board.scope));
    const publication = { title: competition.title, boards: publicBoards, provisional: !competition.publishedAt };
    const config = [competition.id, competition.title, tiePolicy, competition.leaderboardScopes, overallAvailable];
    const revision = createHash('sha256').update(JSON.stringify([
      config, effectiveStatus(competition, now) === 'ACTIVE' ? null : publication,
    ])).digest('hex');
    return { overallAvailable, tiePolicy, boards, scopes: competition.leaderboardScopes,
      publication, revision,
      published: competition.publicLeaderboard !== null, status: effectiveStatus(competition, now) };
  }

  private transaction<T>(actor: StaffPrincipal, id: string,
    operation: (tx: Prisma.TransactionClient, competition: Competition, now: Date) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      await requireCompetitionManagement(tx, actor, id);
      const now = await databaseTime(tx);
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      return operation(tx, competition, now);
    }, { timeout: 30000 });
  }

  preview(actor: StaffPrincipal, id: string) {
    return this.transaction(actor, id, async (tx, competition, now) => {
      const standings = await this.view(tx, competition, now);
      const legacy = await this.readPublication(tx, competition);
      return legacy ? { ...standings, publication: { ...legacy, provisional: standings.publication.provisional } } : standings;
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
      if (!['ACTIVE', 'CLOSED', 'ARCHIVED'].includes(view.status)) throw new ConflictException('Open or close the competition before publishing');
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

  private async readPublication(tx: Prisma.TransactionClient,
    competition: Pick<Competition, 'id' | 'publicLeaderboard' | 'leaderboardAliasKey'>) {
    const parsed = savedPublication.safeParse(competition.publicLeaderboard);
    if (!parsed.success || !parsed.data.boards.some(board => board.rows.some(row => 'alias' in row))) return null;
    const publication = parsed.data;
    const names = new Map<string, string>();
    // Resolve historical aliases until a score-changing operation refreshes the snapshot.
    const attempts = await tx.attempt.findMany({
      where: { competitionId: competition.id },
      distinct: ['studentId'],
      select: { studentId: true, student: { select: { fullName: true } } },
    });
    for (const { studentId, student } of attempts) {
      names.set(legacyAlias(competition.leaderboardAliasKey, studentId), student.fullName);
    }
    return {
      ...publication,
      boards: publication.boards.map(board => ({
        ...board,
        rows: board.rows.flatMap(row => {
          if ('name' in row) return [row];
          const { alias, ...stats } = row;
          const name = names.get(alias);
          return name === undefined ? [] : [{ ...stats, name }];
        }),
      })),
    };
  }

  publicBoard(id: string) {
    return this.db.$transaction(async tx => {
      const competition = await lockCompetition(tx, id);
      if (!competition.publicLeaderboard) throw new NotFoundException('Leaderboard is not published');
      const now = await databaseTime(tx);
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      const legacy = await this.readPublication(tx, competition);
      if (legacy) return { ...legacy, provisional: !competition.publishedAt };
      return (await this.view(tx, competition, now)).publication;
    }, { timeout: 30000 });
  }

  private async overallStandings(tx: Prisma.TransactionClient, groupId: string) {
    const now = await databaseTime(tx);
    const overdue = await tx.attempt.findMany({
      where: {
        status: 'IN_PROGRESS', expiresAt: { lte: now }, competition: { groupId,
          OR: [{ publishedAt: { not: null } }, { publicLeaderboard: { not: Prisma.DbNull } }],
        },
      },
      select: { competitionId: true }, orderBy: { competitionId: 'asc' }, distinct: ['competitionId'],
    });
    for (const { competitionId } of overdue) {
      await tx.$queryRaw`SELECT id FROM "Competition" WHERE id = ${competitionId}::uuid FOR SHARE`;
      await this.attempts.reconcileScope(tx, { competitionId }, now);
    }
    const rows = await tx.$queryRaw<{
      rank: number; name: string; grade: string; score: number; maxScore: number; competitions: number; provisional: boolean;
    }[]>`
      WITH totals AS (
        SELECT a."studentId", SUM(a."score") AS score, SUM(a."maxScore") AS maximum,
               SUM(EXTRACT(EPOCH FROM (a."finishedAt" - a."startedAt"))) AS elapsed,
               COUNT(DISTINCT a."competitionId") AS competitions,
               BOOL_OR(c."publishedAt" IS NULL) AS provisional
        FROM "Attempt" a
        JOIN "Competition" c ON c.id = a."competitionId" AND c."groupId" = ${groupId}::uuid
        WHERE a.status IN ('SUBMITTED', 'TIMED_OUT')
          AND (c."publishedAt" IS NOT NULL OR c."publicLeaderboard" IS NOT NULL)
        GROUP BY a."studentId"
      )
      SELECT DENSE_RANK() OVER (ORDER BY t.score DESC, t.elapsed ASC NULLS LAST)::integer AS rank,
             s."fullName" AS name, g.name AS grade, t.score::double precision AS score,
             t.maximum::double precision AS "maxScore", t.competitions::integer AS competitions, t.provisional
      FROM totals t
      JOIN "Student" s ON s.id = t."studentId"
      JOIN "Grade" g ON g.id = s."gradeId" AND g."groupId" = ${groupId}::uuid
      ORDER BY t.score DESC, t.elapsed ASC NULLS LAST, s."fullName", s.id
    `;
    return {
      title: 'Across-competition leaderboard', groupId, provisional: rows.some(row => row.provisional),
      boards: [{ scope: 'overall', name: null, rows: rows.map(({ provisional: _provisional, ...row }) => row) }],
    };
  }

  async overallPublished(groupId: string, tx: Prisma.TransactionClient = this.db) {
    const setting = await tx.overallLeaderboard.findUnique({ where: { groupId } });
    return { published: setting?.published ?? false };
  }

  overallPreview(actor: StaffPrincipal) {
    return this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      const groupId = groupOf(actor);
      return { ...await this.overallPublished(groupId, tx), ...await this.overallStandings(tx, groupId) };
    }, { timeout: 30000 });
  }

  setOverallVisibility(actor: StaffPrincipal, published: boolean) {
    return this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      const groupId = groupOf(actor);
      await tx.overallLeaderboard.upsert({
        where: { groupId }, create: { groupId, published }, update: { published },
      });
      await audit(tx, actor, published ? 'OVERALL_LEADERBOARD_PUBLISHED' : 'OVERALL_LEADERBOARD_UNPUBLISHED', {});
      return { published, ...await this.overallStandings(tx, groupId) };
    }, { timeout: 30000 });
  }

  overallPublic(groupId: string) {
    return this.db.$transaction(async tx => {
      const { published } = await this.overallPublished(groupId, tx);
      if (!published) throw new NotFoundException('Leaderboard is not published');
      return this.overallStandings(tx, groupId);
    }, { timeout: 30000 });
  }

}

@ApiTags('Leaderboards')
@Controller()
export class LeaderboardController {
  constructor(private readonly boards: LeaderboardService) {}

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Get('admin/leaderboards/all')
  overallPreview(@Actor() actor: StaffPrincipal) {
    return this.boards.overallPreview(actor);
  }

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Put('admin/leaderboards/all')
  @bodyDocs(overallVisibility)
  setOverallVisibility(@Actor() actor: StaffPrincipal, @body(overallVisibility) input: z.infer<typeof overallVisibility>) {
    return this.boards.setOverallVisibility(actor, input.published);
  }

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Get('admin/competitions/:id/leaderboard')
  preview(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.boards.preview(actor, id);
  }

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Put('admin/competitions/:id/leaderboard')
  @bodyDocs(settings)
  configure(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(settings) input: Settings) {
    return this.boards.configure(actor, id, input);
  }

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Post('admin/competitions/:id/leaderboard/publish')
  @bodyDocs(revisionInput)
  publish(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(revisionInput) input: z.infer<typeof revisionInput>) {
    return this.boards.publish(actor, id, input.revision);
  }

  @Roles('SUPER_ADMIN', 'SERVANT')
  @Post('admin/competitions/:id/leaderboard/unpublish')
  unpublish(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.boards.unpublish(actor, id);
  }

  @Public()
  @Get('leaderboards/all/visibility')
  overallVisibility() {
    return this.boards.overallPublished(DEFAULT_GROUP_ID);
  }

  @Public()
  @Get('leaderboards/all')
  overallPublic() {
    return this.boards.overallPublic(DEFAULT_GROUP_ID);
  }

  @Public()
  @Get('leaderboards/all/:groupId/visibility')
  groupOverallVisibility(@param('groupId') groupId: string) {
    return this.boards.overallPublished(groupId);
  }

  @Public()
  @Get('leaderboards/all/:groupId')
  groupOverallPublic(@param('groupId') groupId: string) {
    return this.boards.overallPublic(groupId);
  }

  @Public()
  @Get('leaderboards/:id')
  publicBoard(@param('id') id: string) {
    return this.boards.publicBoard(id);
  }
}
