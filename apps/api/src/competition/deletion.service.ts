import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { audit, groupOf, lockStaff, requireGrade } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { Database } from '../database/database.module';
import { lockCompetition } from './attempt.service';
import { requireCompetitionManagement } from './competition-data';
import { LeaderboardService } from './leaderboard';

type Tx = Prisma.TransactionClient;

function reference(field: string, id: string): Prisma.AuditLogWhereInput {
  return { metadataJson: { path: [field], equals: id } };
}

async function purgeAttempts(tx: Tx, where: Prisma.AttemptWhereInput, auditScope: Prisma.AuditLogWhereInput[]) {
  const attempts = await tx.attempt.findMany({ where, select: { id: true } });
  const ids = attempts.map(row => row.id);
  if (ids.length) {
    await tx.$executeRaw`
      DELETE FROM "AuditLog"
      WHERE "metadataJson"->>'attemptId' IN (${Prisma.join(ids)})
        OR "metadataJson"->>'replacementId' IN (${Prisma.join(ids)})
    `;
  }
  await tx.auditLog.deleteMany({ where: { OR: auditScope } });
  await tx.attemptAnswer.deleteMany({ where: { attemptQuestion: { attempt: where } } });
  await tx.attemptQuestion.deleteMany({ where: { attempt: where } });
  return tx.attempt.deleteMany({ where });
}

@Injectable()
export class DeletionService {
  constructor(private readonly db: Database, private readonly leaderboards: LeaderboardService) {}

  async competition(actor: StaffPrincipal, id: string) {
    await this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      await lockCompetition(tx, id, true);
      await requireCompetitionManagement(tx, actor, id);
      const attempts = await purgeAttempts(tx, { competitionId: id }, [reference('competitionId', id)]);
      await tx.competitionGrade.deleteMany({ where: { competitionId: id } });
      await tx.question.deleteMany({ where: { competitionId: id } });
      await tx.competition.delete({ where: { id } });
      await audit(tx, actor, 'COMPETITION_DELETED', { attemptCount: attempts.count });
    }, { timeout: 30000 });
  }

  async student(actor: StaffPrincipal, id: string) {
    await this.db.$transaction(async tx => {
      await lockStaff(tx, actor);
      const [student] = await tx.$queryRaw<{ gradeId: string }[]>`SELECT "gradeId" FROM "Student" WHERE id = ${id}::uuid FOR UPDATE`;
      if (!student) throw new NotFoundException('Student was not found');
      await requireGrade(tx, actor, student.gradeId);

      // Attempt creation also takes the student lock first. The competition locks
      // serialize this deletion against finalization and publication.
      const competitions = await tx.competition.findMany({
        where: { attempts: { some: { studentId: id } } },
        select: { id: true }, orderBy: { id: 'asc' },
      });
      const locked = [];
      for (const competition of competitions) {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Competition" WHERE id = ${competition.id}::uuid FOR UPDATE
        `;
        if (rows.length) locked.push(competition.id);
      }
      const attempts = await purgeAttempts(tx, { studentId: id }, [
        { actorId: id, actorType: { in: ['STUDENT', 'SYSTEM'] } }, reference('studentId', id),
      ]);
      await tx.$executeRaw`
        UPDATE "AuditLog"
        SET "metadataJson" = jsonb_set("metadataJson", '{studentIds}', ("metadataJson"->'studentIds') - ${id}::text)
        WHERE "eventType" = 'ACTIVATION_HANDOUT_ISSUED'
          AND ("metadataJson"->'studentIds') ? ${id}::text
      `;
      await tx.student.delete({ where: { id } });
      for (const competitionId of locked) await this.leaderboards.refreshPublished(tx, competitionId);
      await audit(tx, actor, 'STUDENT_DELETED', { attemptCount: attempts.count });
    }, { timeout: 30000 });
  }

  staffList(actor: StaffPrincipal) {
    return this.db.adminUser.findMany({
      where: { OR: [{ role: 'SUPER_ADMIN' }, { groupId: groupOf(actor) }] },
      select: { id: true, fullName: true, username: true, role: true, status: true },
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
    });
  }

  async staff(actor: StaffPrincipal, id: string) {
    if (actor.id === id) throw new ForbiddenException('You cannot delete your own account');
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT id FROM "AdminUser" WHERE id IN (${actor.id}::uuid, ${id}::uuid) ORDER BY id FOR UPDATE
      `;
      await lockStaff(tx, actor);
      const target = await tx.adminUser.findUnique({ where: { id }, select: { role: true, groupId: true } });
      if (!target || (target.role !== 'SUPER_ADMIN' && target.groupId !== groupOf(actor))) throw new NotFoundException('Staff account was not found');
      if (target.role === 'SUPER_ADMIN' && !(await tx.adminUser.count({
        where: { id: { not: id }, role: 'SUPER_ADMIN', status: 'ACTIVE' },
      }))) throw new ConflictException('Keep at least one active super admin');
      await tx.auditLog.deleteMany({ where: reference('servantId', id) });
      await tx.adminUser.delete({ where: { id } });
      await audit(tx, actor, 'STAFF_ACCOUNT_DELETED', { role: target.role });
    });
  }
}
