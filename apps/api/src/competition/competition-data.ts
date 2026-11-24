import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Competition, Prisma, Question } from '@prisma/client';
import { z } from 'zod';
import { gradeScope, StaffPrincipal } from '../auth/principal';
import { competitionInput, ownedQuestionInput, snapshotInput, Snapshot } from './competition.input';

export function validateQuestion(input: Pick<z.infer<typeof ownedQuestionInput>, 'type' | 'items' | 'correctOrder'>) {
  const ids = new Set(input.items.map((item) => item.id));
  const keys = new Set(input.correctOrder);
  if (ids.size !== input.items.length || keys.size !== input.correctOrder.length ||
      input.correctOrder.length !== (input.type === 'MCQ' ? 1 : input.items.length) ||
      input.correctOrder.some((id) => !ids.has(id))) {
    throw new BadRequestException('Answer key must match the question items');
  }
}

export function snapshot(question: Question): Snapshot {
  const { id, gradeId, type, difficulty, text, points, items, correctOrder, sortingMode, explanation, imageUrl, tags } = question;
  return snapshotInput.parse({ id, gradeId, type, difficulty, text, points, items, correctOrder, sortingMode, explanation, imageUrl, tags });
}

export const gradeSelections = {
  orderBy: { gradeId: 'asc' },
  include: { questions: { orderBy: { position: 'asc' }, select: { questionId: true, snapshot: true } } },
} satisfies Prisma.Competition$gradesArgs;

// Call with the competition locked so its eligible grades cannot change during authorization.
export async function requireCompetitionManagement(tx: Prisma.TransactionClient, actor: StaffPrincipal, id: string) {
  const scope = await gradeScope(tx, actor);
  if (!scope) return;
  const grades = await tx.competitionGrade.findMany({ where: { competitionId: id }, select: { gradeId: true } });
  if (!grades.length || grades.some(({ gradeId }) => !scope.includes(gradeId))) throw new ForbiddenException();
}

export function competitionInfo(competition: Competition & {
  grades: Prisma.CompetitionGradeGetPayload<{ include: typeof gradeSelections.include }>[];
}, now: Date) {
  const { id, title, description, instructions, opensAt, closesAt, durationMinutes, publishedAt, tiePolicy, sharedQuestions } = competition;
  return {
    id, title, description, instructions, opensAt, closesAt, durationMinutes, publishedAt, tiePolicy, sharedQuestions,
    status: effectiveStatus(competition, now),
    grades: competition.grades.map((grade) => ({
      gradeId: grade.gradeId, blueprint: grade.blueprint, questionIds: grade.questions.map((row) => row.questionId),
    })),
  };
}

export function effectiveStatus(competition: Pick<Competition, 'status' | 'opensAt' | 'closesAt'>, now: Date) {
  if (competition.status === 'DRAFT' || competition.status === 'ARCHIVED') return competition.status;
  if (competition.status === 'CLOSED' || now >= competition.closesAt) return 'CLOSED';
  return now < competition.opensAt ? 'SCHEDULED' : 'ACTIVE';
}

export type CompetitionInput = z.infer<typeof competitionInput>;

export function validateSetup(input: CompetitionInput & { grades: NonNullable<CompetitionInput['grades']> }) {
  if (new Date(input.opensAt) >= new Date(input.closesAt)) throw new BadRequestException('Closing time must follow opening time');
  const grades = new Set(input.grades.map((grade) => grade.gradeId));
  if (grades.size !== input.grades.length) throw new BadRequestException('Configure each grade only once');
  for (const grade of input.grades) {
    const keys = new Set(grade.blueprint.map((rule) => category(rule)));
    if (keys.size !== grade.blueprint.length) throw new BadRequestException('Define each blueprint category only once');
    if (new Set(grade.questionIds).size !== grade.questionIds.length) throw new BadRequestException('Select each question only once per grade');
  }
}

export function category(row: Pick<Snapshot, 'type' | 'difficulty'>) {
  return `${row.type}/${row.difficulty}`;
}

export async function databaseTime(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
  return row.now;
}
