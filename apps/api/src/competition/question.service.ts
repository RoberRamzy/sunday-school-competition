import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { audit, lockStaff, StaffPrincipal } from '../auth/principal';
import { Database, isDatabaseError } from '../database/database.module';
import { snapshot, validateQuestion } from './competition-data';
import { questionFilters, questionInput, questionPatch } from './competition.input';

@Injectable()
export class QuestionService {
  constructor(private readonly db: Database) {}

  async list(input: z.infer<typeof questionFilters>) {
    const { tag, ...filters } = input;
    const questions = await this.db.question.findMany({
      where: { ...filters, tags: tag ? { has: tag } : undefined },
      orderBy: [{ archived: 'asc' }, { createdAt: 'desc' }],
    });
    return questions.map((question) => ({ ...snapshot(question), archived: question.archived }));
  }

  async create(actor: StaffPrincipal, input: z.infer<typeof questionInput>) {
    validateQuestion(input);
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        const question = await tx.question.create({ data: { ...input, tags: input.tags ?? [] } });
        await audit(tx, actor, 'QUESTION_CREATED', { questionId: question.id, gradeId: question.gradeId });
        return { ...snapshot(question), archived: question.archived };
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }

  async update(actor: StaffPrincipal, id: string, input: z.infer<typeof questionPatch>, archive = false) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        await tx.$queryRaw`SELECT id FROM "Question" WHERE id = ${id}::uuid FOR UPDATE`;
        const current = await tx.question.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Question was not found');
        validateQuestion({ ...snapshot(current), ...input });
        const question = await tx.question.update({ where: { id }, data: { ...input, ...(archive ? { archived: true } : {}) } });
        await audit(tx, actor, archive ? 'QUESTION_ARCHIVED' : 'QUESTION_UPDATED', { questionId: id, gradeId: question.gradeId });
        return { ...snapshot(question), archived: question.archived };
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }
}
