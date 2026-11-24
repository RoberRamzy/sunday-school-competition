import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import { z } from 'zod';
import { digest, randomToken } from '../auth/credentials';
import { audit, gradeScope, lockStaff, requireGrade, StaffPrincipal } from '../auth/principal';
import { Database, isDatabaseError } from '../database/database.module';
import { servantInput, servantPatch, studentImport, studentInput, studentPatch } from './roster.input';

const studentFields = { id: true, gradeId: true, fullName: true, displayLabel: true, status: true } as const;
const servantFields = {
  id: true, fullName: true, username: true, status: true, grades: { select: { gradeId: true } },
} as const;

function mapServant({ grades, ...staff }: Prisma.AdminUserGetPayload<{ select: typeof servantFields }>) {
  return { ...staff, gradeIds: grades.map((grade) => grade.gradeId).sort() };
}

function servantSetupCode() {
  const setupCode = randomToken(18);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { setupCode, expiresAt, data: { setupCodeHash: digest(setupCode), setupCodeExpiresAt: expiresAt } };
}

@Injectable()
export class RosterService {
  constructor(private readonly db: Database) {}

  async grades(actor: StaffPrincipal) {
    const ids = await gradeScope(this.db, actor);
    return this.db.grade.findMany({
      where: { id: ids ? { in: ids } : undefined },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async saveGrade(actor: StaffPrincipal, name: string, id?: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        const grade = id
          ? await tx.grade.update({ where: { id }, data: { name }, select: { id: true, name: true } })
          : await tx.grade.create({ data: { name }, select: { id: true, name: true } });
        await audit(tx, actor, id ? 'GRADE_UPDATED' : 'GRADE_CREATED', { gradeId: grade.id });
        return grade;
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('A grade already has this name');
      if (isDatabaseError(error, 'P2025')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }

  async students(actor: StaffPrincipal, gradeId?: string) {
    const scope = await gradeScope(this.db, actor);
    if (gradeId && scope && !scope.includes(gradeId)) throw new ForbiddenException();
    return this.db.student.findMany({
      where: { gradeId: gradeId || (scope ? { in: scope } : undefined) },
      select: studentFields,
      orderBy: [{ fullName: 'asc' }, { displayLabel: 'asc' }],
    });
  }

  private async lockStudents(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
  }

  async createStudent(actor: StaffPrincipal, data: z.infer<typeof studentInput>) {
    if (data.status === 'ACTIVE') throw new BadRequestException('Activate the student with an activation handout first');
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        await requireGrade(tx, actor, data.gradeId);
        const student = await tx.student.create({ data, select: studentFields });
        await audit(tx, actor, 'STUDENT_CREATED', { studentId: student.id, gradeId: student.gradeId });
        return student;
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('This display label already exists in the grade');
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }

  async updateStudent(actor: StaffPrincipal, id: string, input: z.infer<typeof studentPatch>) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        await this.lockStudents(tx, [id]);
        const original = await tx.student.findUnique({ where: { id } });
        if (!original) throw new NotFoundException('Student was not found');
        await requireGrade(tx, actor, original.gradeId);
        if (input.gradeId && input.gradeId !== original.gradeId) await requireGrade(tx, actor, input.gradeId);
        if (input.status === 'ACTIVE' && !original.pinHash) {
          throw new BadRequestException('Activate the student with an activation handout first');
        }
        const resets = input.status === 'PENDING_ACTIVATION';
        const moved = input.gradeId !== undefined && input.gradeId !== original.gradeId;
        const student = await tx.student.update({
          where: { id },
          data: {
            ...input,
            ...(resets ? { pinHash: null, activationCodeUsedAt: null } : {}),
            ...(resets || moved || input.status === 'SUSPENDED' ? { activationCodeHash: null } : {}),
          },
          select: studentFields,
        });
        if (resets || moved || input.status === 'SUSPENDED') {
          await tx.session.updateMany({ where: { studentId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await audit(tx, actor, 'STUDENT_UPDATED', { studentId: id, gradeId: student.gradeId, status: student.status });
        return student;
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('This display label already exists in the grade');
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }

  async import(actor: StaffPrincipal, input: z.infer<typeof studentImport>) {
    const { gradeId, students, dryRun } = input;
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        await requireGrade(tx, actor, gradeId);
        const grade = await tx.grade.findUnique({ where: { id: gradeId }, select: { id: true } });
        if (!grade) throw new NotFoundException('Grade was not found');
        const labels = students.map((row) => row.displayLabel);
        const duplicates = new Set(await tx.student.findMany({
          where: { gradeId, displayLabel: { in: labels } },
          select: { displayLabel: true },
        }).then((rows) => rows.map((row) => row.displayLabel)));
        const seen = new Set<string>();
        const errors: string[] = [];
        labels.forEach((label, index) => {
          if (seen.has(label) || duplicates.has(label)) errors.push(`Row ${index + 1}: duplicate display label "${label}"`);
          seen.add(label);
        });
        if (errors.length) throw new ConflictException(errors);
        if (dryRun) return { count: students.length };

        const imported = await tx.student.createMany({ data: students.map((student) => ({ ...student, gradeId })) });
        await audit(tx, actor, 'ROSTER_IMPORTED', { gradeId, count: imported.count });
        return imported;
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('A display label already exists in the grade');
      throw error;
    }
  }

  async reset(actor: StaffPrincipal, id: string) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      await this.lockStudents(tx, [id]);
      const student = await tx.student.findUnique({ where: { id }, select: studentFields });
      if (!student) throw new NotFoundException('Student was not found');
      await requireGrade(tx, actor, student.gradeId);
      if (student.status === 'SUSPENDED') throw new ConflictException('Resolve the suspension before resetting the PIN');
      const next = await tx.student.update({
        where: { id },
        data: { status: 'PENDING_ACTIVATION', pinHash: null, activationCodeHash: null, activationCodeUsedAt: null },
        select: studentFields,
      });
      await tx.session.updateMany({ where: { studentId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, actor, 'PIN_RESET', { studentId: id, gradeId: student.gradeId });
      return next;
    });
  }

  async handout(actor: StaffPrincipal, gradeId: string, studentIds: string[]) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      await requireGrade(tx, actor, gradeId);
      await this.lockStudents(tx, studentIds);
      const roster = await tx.student.findMany({ where: { id: { in: studentIds } }, select: studentFields });
      if (roster.length !== studentIds.length || roster.some((student) => student.gradeId !== gradeId)) {
        throw new ForbiddenException('Choose students in the selected grade');
      }
      if (roster.some((student) => student.status !== 'PENDING_ACTIVATION')) {
        throw new ConflictException('Choose students who are pending activation');
      }
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Activation');
      sheet.addRow(['Name', 'One-time password']);
      sheet.getColumn(1).width = 42;
      sheet.getColumn(2).width = 32;
      sheet.getRow(1).font = { bold: true };

      const credentials = roster.sort((a, b) => a.displayLabel.localeCompare(b.displayLabel)).map((student) => {
        const code = randomToken(12);
        sheet.addRow([student.displayLabel, code]);
        return Prisma.sql`(${student.id}::uuid, ${digest(code)})`;
      });
      const bytes = await workbook.xlsx.writeBuffer();
      await tx.$executeRaw`
        UPDATE "Student" AS student
        SET "activationCodeHash" = codes.hash, "updatedAt" = clock_timestamp()
        FROM (VALUES ${Prisma.join(credentials)}) AS codes(id, hash)
        WHERE student.id = codes.id
      `;
      await audit(tx, actor, 'ACTIVATION_HANDOUT_ISSUED', { gradeId, studentIds });
      return Buffer.from(bytes);
    });
  }

  async servants() {
    const users = await this.db.adminUser.findMany({
      where: { role: 'SERVANT' }, select: servantFields, orderBy: { username: 'asc' },
    });
    return users.map(mapServant);
  }

  async saveServant(actor: StaffPrincipal, input: z.infer<typeof servantInput> | z.infer<typeof servantPatch>, id?: string) {
    const { gradeIds, ...fields } = input;
    const assignments = gradeIds?.map((gradeId) => ({ gradeId }));
    const suspended = 'status' in fields && fields.status === 'SUSPENDED';
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        const setup = id ? undefined : servantSetupCode();
        const servant = id
          ? await tx.adminUser.update({
              where: { id, role: 'SERVANT' },
              data: {
                ...fields,
                ...(suspended ? { setupCodeHash: null, setupCodeExpiresAt: null } : {}),
                grades: assignments && { deleteMany: {}, create: assignments },
              },
              select: servantFields,
            })
          : await tx.adminUser.create({
              data: { fullName: fields.fullName!, username: fields.username!, ...setup!.data, grades: { create: assignments } },
              select: servantFields,
            });
        if (servant.status === 'SUSPENDED') {
          await tx.session.updateMany({ where: { staffId: servant.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await audit(tx, actor, id ? 'SERVANT_UPDATED' : 'SERVANT_CREATED', {
          servantId: servant.id, status: servant.status, gradeIds: servant.grades.map((grade) => grade.gradeId),
        });
        return { ...mapServant(servant), ...(setup && { setupCode: setup.setupCode, expiresAt: setup.expiresAt }) };
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2002')) throw new ConflictException('This username is already in use');
      if (isDatabaseError(error, 'P2025')) throw new NotFoundException('Servant was not found');
      if (isDatabaseError(error, 'P2003')) throw new NotFoundException('Grade was not found');
      throw error;
    }
  }

  async resetServantCredential(actor: StaffPrincipal, id: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        await lockStaff(tx, actor);
        const setup = servantSetupCode();
        const { username } = await tx.adminUser.update({
          where: { id, role: 'SERVANT', status: 'ACTIVE' },
          data: { ...setup.data, passwordHash: null },
          select: { username: true },
        });
        await tx.session.updateMany({ where: { staffId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        await audit(tx, actor, 'SERVANT_CREDENTIAL_RESET', { servantId: id });
        return { username, setupCode: setup.setupCode, expiresAt: setup.expiresAt };
      });
    } catch (error) {
      if (isDatabaseError(error, 'P2025')) throw new NotFoundException('Active servant was not found');
      throw error;
    }
  }
}
