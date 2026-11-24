import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { audit, gradeScope, lockStaff, StaffPrincipal } from '../auth/principal';
import { Database, isDatabaseError } from '../database/database.module';
import { AttemptService, lockCompetition } from './attempt.service';
import {
  category, competitionInfo, CompetitionInput, databaseTime, effectiveStatus, gradeSelections, snapshot, validateQuestion, validateSetup,
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
      const info = competitionInfo(row, await databaseTime(tx));
      if (actor.role !== 'SUPER_ADMIN' || row.status !== 'DRAFT') return info;
      const ids = row.grades.flatMap(({ questions }) => questions.map(({ questionId }) => questionId));
      const questions = new Map((await tx.question.findMany({ where: { id: { in: ids } } }))
        .map(question => [question.id, snapshot(question)]));
      const sets = row.grades.map(({ gradeId, questions: links }) => ({
        gradeId, questions: links.flatMap(({ questionId }) => {
          const question = questions.get(questionId);
          if (!question) return [];
          const { gradeId: _grade, ...fields } = question;
          return [fields];
        }),
      }));
      return row.sharedQuestions ? { ...info, questions: sets[0]?.questions ?? [] } : { ...info, legacyDraftSets: sets };
    });
  }

  async save(actor: StaffPrincipal, input: z.infer<typeof competitionPatch>, id?: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        let data = input as CompetitionInput;
        let sharedDraft = false;
        if (id) {
          const current = await lockCompetition(tx, id, true);
          sharedDraft = current.sharedQuestions;
          if (current.status !== 'DRAFT') throw new ConflictException('Only a draft can be edited');
          const row = await tx.competition.findUniqueOrThrow({ where: { id }, include: { grades: gradeSelections } });
          const prior = competitionInfo(row, await databaseTime(tx));
          data = { ...prior, opensAt: prior.opensAt.toISOString(), closesAt: prior.closesAt.toISOString(), grades: prior.grades as CompetitionInput['grades'], ...input };
        }
        if (data.gradeIds || data.questions) {
          return this.saveShared(tx, actor, data, id);
        }
        if (!id || !data.grades || sharedDraft) {
          throw new BadRequestException('Supply eligible grades and shared questions');
        }
        validateSetup({ ...data, grades: data.grades });
        const { title, description, tiePolicy, instructions, opensAt, closesAt, durationMinutes } = data;
        const grades = data.grades;
        await this.validateSelections(tx, grades);
        const scalar = { title, description, tiePolicy, instructions, opensAt: new Date(opensAt), closesAt: new Date(closesAt), durationMinutes };
        const gradeRecords = grades.map((grade) => ({
          gradeId: grade.gradeId, blueprint: grade.blueprint,
          questions: { create: grade.questionIds.map((questionId, position) => ({ questionId, position })) },
        }));
        const row = await tx.competition.update({
          where: { id }, data: { ...scalar, grades: { deleteMany: {}, create: gradeRecords } }, include: { grades: gradeSelections },
        });
        await audit(tx, actor, 'COMPETITION_UPDATED', { competitionId: row.id });
        return competitionInfo(row, await databaseTime(tx));
      }, { timeout: 15000 });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('A question ID is already in use');
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Selected grade or question was not found');
      throw error;
    }
  }

  private async saveShared(tx: Prisma.TransactionClient, actor: StaffPrincipal, data: CompetitionInput, id?: string) {
    const { gradeIds, questions, title, description, instructions, opensAt, closesAt, durationMinutes, tiePolicy } = data;
    if (!gradeIds || !questions || new Set(gradeIds).size !== gradeIds.length ||
        new Set(questions.map(question => question.id)).size !== questions.length) {
      throw new BadRequestException('Supply unique grade IDs and a shared question list');
    }
    if (new Date(opensAt) >= new Date(closesAt)) throw new BadRequestException('Closing time must follow opening time');
    if (await tx.grade.count({ where: { id: { in: gradeIds } } }) !== gradeIds.length) throw new BadRequestException('Unknown grade');
    questions.forEach(validateQuestion);
    const scalar = { title, description, instructions, opensAt: new Date(opensAt), closesAt: new Date(closesAt),
      durationMinutes, tiePolicy, sharedQuestions: true };
    const competition = id
      ? await tx.competition.update({ where: { id }, data: scalar })
      : await tx.competition.create({ data: scalar });
    await tx.competitionGrade.deleteMany({ where: { competitionId: competition.id } });
    await tx.question.deleteMany({ where: { competitionId: competition.id } });
    await tx.question.createMany({
      data: questions.map(question => ({ ...question, competitionId: competition.id, tags: question.tags ?? [] })),
    });
    const row = await tx.competition.update({
      where: { id: competition.id },
      data: { leaderboardScopes: competition.leaderboardScopes.filter(scope => scope === 'overall' || gradeIds.includes(scope)),
        grades: { create: gradeIds.map(gradeId => ({
        gradeId, blueprint: [], questions: { create: questions.map(({ id: questionId }, position) => ({ questionId, position })) },
      })) } },
      include: { grades: gradeSelections },
    });
    await audit(tx, actor, id ? 'COMPETITION_UPDATED' : 'COMPETITION_CREATED', { competitionId: row.id });
    return { ...competitionInfo(row, await databaseTime(tx)), questions };
  }

  private async validateSelections(tx: Prisma.TransactionClient, grades: NonNullable<CompetitionInput['grades']>) {
    const gradeIds = grades.map((grade) => grade.gradeId);
    const questionIds = [...new Set(grades.flatMap((grade) => grade.questionIds))];
    const gradeCount = await tx.grade.count({ where: { id: { in: gradeIds } } });
    if (gradeCount !== gradeIds.length) throw new BadRequestException('Selected grade was not found');
    const questions = await tx.question.findMany({ where: { id: { in: questionIds } } });
    const byId = new Map(questions.map((question) => [question.id, question]));
    for (const grade of grades) {
      for (const questionId of grade.questionIds) {
        const question = byId.get(questionId);
        if (!question || question.competitionId || question.gradeId !== grade.gradeId || question.archived) {
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
      const grades = competitionInfo(row, now).grades as NonNullable<CompetitionInput['grades']>;
      const ids = [...new Set(grades.flatMap((grade) => grade.questionIds))];
      if (ids.length) {
        await tx.$queryRaw`
          SELECT id FROM "Question" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR SHARE
        `;
      }
      if (row.sharedQuestions && (!grades.length || !ids.length)) throw new BadRequestException('Add at least one question');
      const byId = row.sharedQuestions
        ? new Map((await tx.question.findMany({ where: { id: { in: ids }, competitionId: id } })).map(question => [question.id, question]))
        : await this.validateSelections(tx, grades);
      if (byId.size !== ids.length) throw new BadRequestException('Invalid shared question selection');
      const errors: string[] = [];
      for (const grade of row.sharedQuestions ? [] : grades) {
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
