import { z } from 'zod';

export const questionType = z.enum(['MCQ', 'SORTING']);
export const difficulty = z.enum(['EASY', 'MEDIUM', 'HARD']);
const copy = z.string().trim().min(1).max(4000);
const item = z.strictObject({ id: z.uuid(), text: copy });
export const questionInput = z.strictObject({
  gradeId: z.uuid(), type: questionType, difficulty, text: copy, points: z.number().int().min(1).max(1000),
  items: z.array(item).min(2).max(30), correctOrder: z.array(z.uuid()).min(1).max(30),
  explanation: z.string().trim().max(4000).optional(),
  imageUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  sortingMode: z.enum(['EXACT', 'PARTIAL']),
});
export const questionPatch = questionInput.partial();
export const snapshotInput = questionInput.extend({ id: z.uuid() });
export type Snapshot = z.infer<typeof snapshotInput>;
export const questionFilters = z.object({
  tag: z.string().trim().min(1).optional(),
  gradeId: z.uuid().optional(), type: questionType.optional(), difficulty: difficulty.optional(),
});
const blueprint = z.strictObject({ type: questionType, difficulty, count: z.number().int().min(1).max(100) });
const gradeSetup = z.strictObject({
  gradeId: z.uuid(),
  questionIds: z.array(z.uuid()).max(100),
  blueprint: z.array(blueprint).max(6),
});
export const competitionInput = z.strictObject({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  tiePolicy: z.enum(['SCORE_THEN_TIME', 'SCORE_ONLY']).optional(),
  instructions: z.string().trim().max(8000),
  opensAt: z.iso.datetime(), closesAt: z.iso.datetime(),
  durationMinutes: z.number().int().min(1).max(1440),
  grades: z.array(gradeSetup).min(1).max(50),
});
export const competitionPatch = competitionInput.partial();
export const answerInput = z.strictObject({
  questionId: z.uuid(), itemIds: z.array(z.uuid()).max(30), advance: z.boolean(), revision: z.number().int().min(1).max(2147483647),
});
export const reasonInput = z.strictObject({ reason: z.string().trim().min(1).max(1000) });
export const exportFilter = z.strictObject({ format: z.enum(['csv', 'xlsx']) });
