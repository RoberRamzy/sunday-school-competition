import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, gradeScope, lockStaff, StaffPrincipal } from '../auth/principal';
import { Database, isDatabaseError } from '../database/database.module';
import { AttemptService, lockCompetition } from './attempt.service';
import {
  category, competitionInfo, CompetitionInput, databaseTime, effectiveStatus, gradeSelections, snapshot, validateSetup,
} from './competition-data';
import { competitionPatch } from './competition.input';

@Injectable()
export class CompetitionService {
  constructor(private readonly db: Database, private readonly attempts: AttemptService) {}

  async list(actor: StaffPrincipal) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const scope = await gradeScope(tx, actor);
      const gradeFilter = scope ? { gradeId: { in: scope } } : undefined;
      const rows = await tx.competition.findMany({
        where: gradeFilter ? { grades: { some: gradeFilter }, status: { not: 'DRAFT' } } : undefined,
        include: { grades: { ...gradeSelections, where: gradeFilter } },
        orderBy: { opensAt: 'desc' },
      });
      const now = await databaseTime(tx);
      return rows.map((row) => competitionInfo(row, now));
    });
  }

  async detail(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const scope = await gradeScope(tx, actor);
      const row = await tx.competition.findUnique({
        where: { id },
        include: { grades: { ...gradeSelections, where: scope ? { gradeId: { in: scope } } : undefined } },
      });
      if (!row) throw new NotFoundException('Competition was not found');
      if (scope && (!row.grades.length || row.status === 'DRAFT')) throw new ForbiddenException();
      return competitionInfo(row, await databaseTime(tx));
    });
  }

  async save(actor: StaffPrincipal, input: z.infer<typeof competitionPatch>, id?: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        let data = input as CompetitionInput;
        if (id) {
          const current = await lockCompetition(tx, id, true);
          if (current.status !== 'DRAFT') throw new ConflictException('Only a draft can be edited');
          const row = await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } });
          const prior = competitionInfo(row, await databaseTime(tx));
          data = { ...prior, opensAt: prior.opensAt.toISOString(), closesAt: prior.closesAt.toISOString(), grades: prior.grades as CompetitionInput['grades'], ...input };
        }
        validateSetup(data);
        const { title, description, tiePolicy, instructions, opensAt, closesAt, durationMinutes, grades } = data;
        await this.validateSelections(tx, grades);
        const scalar = { title, description, tiePolicy, instructions, opensAt: new Date(opensAt), closesAt: new Date(closesAt), durationMinutes };
        const gradeRecords = grades.map((grade) => ({
          gradeId: grade.gradeId, blueprint: grade.blueprint,
          questions: { create: grade.questionIds.map((questionId, position) => ({ questionId, position })) },
        }));
        const row = id
          ? await tx.competition.update({
              where: { id }, data: { ...scalar, grades: { deleteMany: {}, create: gradeRecords } }, include: { grades: gradeSelections },
            })
          : await tx.competition.create({
              data: { ...scalar, grades: { create: gradeRecords } }, include: { grades: gradeSelections },
            });
        await audit(tx, actor, id ? 'COMPETITION_UPDATED' : 'COMPETITION_CREATED', { competitionId: row.id });
        return competitionInfo(row, await databaseTime(tx));
      }, { timeout: 15000 });
    } catch (error) {
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Selected grade or question was not found');
      throw error;
    }
  }

  private async validateSelections(tx: Prisma.TransactionClient, grades: CompetitionInput['grades']) {
    const gradeIds = grades.map((grade) => grade.gradeId);
    const questionIds = [...new Set(grades.flatMap((grade) => grade.questionIds))];
    const gradeCount = await tx.grade.count({ where: { id: { in: gradeIds } } });
    if (gradeCount !== gradeIds.length) throw new BadRequestException('Selected grade was not found');
    const questions = await tx.question.findMany({ where: { id: { in: questionIds } } });
    const byId = new Map(questions.map((question) => [question.id, question]));
    for (const grade of grades) {
      for (const questionId of grade.questionIds) {
        const question = byId.get(questionId);
        if (!question || question.gradeId !== grade.gradeId || question.archived) {
          throw new BadRequestException('Select active questions from the corresponding grade');
        }
      }
    }
    return byId;
  }

  async activate(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      const now = await databaseTime(tx);
      if (competition.status !== 'DRAFT' || now >= competition.closesAt) {
        throw new ConflictException('Only a draft with a future closing time can be activated');
      }
      const row = await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } });
      const grades = competitionInfo(row, now).grades as CompetitionInput['grades'];
      const ids = [...new Set(grades.flatMap((grade) => grade.questionIds))];
      if (ids.length) {
        await tx.$queryRaw`
          SELECT id FROM "Question" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR SHARE
        `;
      }
      const byId = await this.validateSelections(tx, grades);
      const errors: string[] = [];
      for (const grade of grades) {
        const expected = new Map(grade.blueprint.map((rule) => [category(rule), rule.count]));
        const actual = new Map<string, number>();
        for (const questionId of grade.questionIds) {
          const key = category(byId.get(questionId)!);
          actual.set(key, (actual.get(key) ?? 0) + 1);
        }
        if (!expected.size || !actual.size) errors.push(`Grade ${grade.gradeId} requires a blueprint and questions`);
        for (const key of new Set([...expected.keys(), ...actual.keys()])) {
          const required = expected.get(key) ?? 0;
          const selected = actual.get(key) ?? 0;
          if (required !== selected) errors.push(`Grade ${grade.gradeId} ${key}: expected ${required}, selected ${selected}`);
        }
      }
      if (errors.length) throw new BadRequestException(errors);

      const frozen = row.grades.flatMap((grade) => grade.questions.map(({ questionId }) => Prisma.sql
        `(${grade.id}::uuid, ${questionId}::uuid, ${JSON.stringify(snapshot(byId.get(questionId)!))}::jsonb)`));
      await tx.$executeRaw`
        UPDATE "CompetitionQuestion" AS question SET snapshot = frozen.snapshot
        FROM (VALUES ${Prisma.join(frozen)}) AS frozen(grade, question, snapshot)
        WHERE question."competitionGradeId" = frozen.grade AND question."questionId" = frozen.question
      `;
      const active = await tx.competition.update({
        where: { id }, data: { status: now < row.opensAt ? 'SCHEDULED' : 'ACTIVE' }, include: { grades: gradeSelections },
      });
      await audit(tx, actor, 'COMPETITION_ACTIVATED', { competitionId: id });
      return competitionInfo(active, now);
    }, { timeout: 15000 });
  }

  async close(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      const now = await databaseTime(tx);
      if (competition.status === 'DRAFT' || competition.status === 'ARCHIVED') {
        throw new ConflictException('Activate the competition before closing it');
      }
      const wasClosed = competition.status === 'CLOSED';
      if (!wasClosed && now < competition.closesAt) {
        await tx.attempt.updateMany({
          where: { competitionId: id, status: 'IN_PROGRESS', expiresAt: { gt: now } }, data: { expiresAt: now },
        });
      }
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      const row = wasClosed
        ? await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } })
        : await tx.competition.update({
            where: { id },
            data: { status: 'CLOSED', closesAt: now < competition.closesAt && now > competition.opensAt ? now : undefined },
            include: { grades: gradeSelections },
          });
      if (!wasClosed) await audit(tx, actor, 'COMPETITION_CLOSED', { competitionId: id });
      return competitionInfo(row, now);
    }, { timeout: 30000 });
  }

  async archive(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      const now = await databaseTime(tx);
      if (!['CLOSED', 'ARCHIVED'].includes(effectiveStatus(competition, now))) {
        throw new ConflictException('Close the competition before archiving');
      }
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      const row = competition.status === 'ARCHIVED'
        ? await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } })
        : await tx.competition.update({ where: { id }, data: { status: 'ARCHIVED' }, include: { grades: gradeSelections } });
      if (competition.status !== 'ARCHIVED') await audit(tx, actor, 'COMPETITION_ARCHIVED', { competitionId: id });
      return competitionInfo(row, now);
    }, { timeout: 30000 });
  }

  async publish(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const competition = await lockCompetition(tx, id, true);
      const now = await databaseTime(tx);
      if (!['CLOSED', 'ARCHIVED'].includes(effectiveStatus(competition, now))) throw new ConflictException('Close the competition before publishing');
      await this.attempts.reconcileScope(tx, { competitionId: id }, now);
      const row = competition.publishedAt
        ? await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } })
        : await tx.competition.update({
            where: { id }, data: { publishedAt: now, status: competition.status === 'ARCHIVED' ? 'ARCHIVED' : 'CLOSED' }, include: { grades: gradeSelections },
          });
      if (!competition.publishedAt) await audit(tx, actor, 'RESULTS_PUBLISHED', { competitionId: id });
      return competitionInfo(row, now);
    }, { timeout: 30000 });
  }
}
