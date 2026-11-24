import { z } from 'zod';
import { name, username } from '../system/input';

export const gradeInput = z.strictObject({ name });
export const studentFields = z.strictObject({ fullName: name, displayLabel: name });
const status = z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED']);
export const studentInput = studentFields.extend({ gradeId: z.uuid(), status: status.optional() });
export const studentPatch = studentInput.partial();
export const studentFilter = z.strictObject({ gradeId: z.uuid().optional() });
export const studentImport = z.strictObject({
  gradeId: z.uuid(),
  students: z.array(studentFields).min(1).max(1000),
  dryRun: z.boolean(),
});
export const handoutInput = z.strictObject({
  studentIds: z.array(z.uuid()).min(1).max(400)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each student only once'),
});
export const servantInput = z.strictObject({
  username,
  fullName: name,
  gradeIds: z.array(z.uuid()).max(100).refine((ids) => new Set(ids).size === ids.length, 'Assign each grade only once'),
});
export const servantPatch = servantInput.partial().extend({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional() });
