import { createParamDecorator, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';

export const DEFAULT_GROUP_ID = '00000000-0000-4000-8000-000000000001';

export type Principal = {
  id: string;
  displayName: string;
  groupId?: string;
} & ({
  role: 'STUDENT';
  gradeId: string;
} | {
  role: 'SUPER_ADMIN' | 'SERVANT';
});

export type AuthRequest = Request & { principal?: Principal };
export type StaffPrincipal = Exclude<Principal, { role: 'STUDENT' }>;

export const PUBLIC = Symbol('PUBLIC');
export const ROLES = Symbol('ROLES');
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Principal['role'][]) => SetMetadata(ROLES, roles);
export const Actor = createParamDecorator((_: unknown, context: ExecutionContext): Principal =>
  context.switchToHttp().getRequest<AuthRequest>().principal!
);

export function groupOf(actor: Principal) {
  return actor.groupId ?? DEFAULT_GROUP_ID;
}

export async function gradeScope(db: Prisma.TransactionClient, actor: StaffPrincipal) {
  if (actor.role === 'SUPER_ADMIN') return undefined;
  const grades = await db.servantGrade.findMany({ where: { servantId: actor.id, grade: { groupId: groupOf(actor) } }, select: { gradeId: true } });
  return grades.map(({ gradeId }) => gradeId);
}

export async function requireGrade(db: Prisma.TransactionClient, actor: StaffPrincipal, gradeId: string) {
  const scope = await gradeScope(db, actor);
  if (scope ? !scope.includes(gradeId) : !await db.grade.count({ where: { id: gradeId, groupId: groupOf(actor) } })) {
    throw new ForbiddenException();
  }
}

export async function lockStaff(db: Prisma.TransactionClient, actor: StaffPrincipal) {
  const active = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AdminUser"
    WHERE id = ${actor.id}::uuid AND status = 'ACTIVE' AND role::text = ${actor.role}
      AND (role = 'SUPER_ADMIN' OR "groupId" = ${groupOf(actor)}::uuid)
    FOR UPDATE
  `;
  if (!active.length) throw new ForbiddenException();
}

export function audit(
  db: Prisma.TransactionClient,
  actor: Principal,
  eventType: string,
  metadataJson: Prisma.InputJsonObject,
) {
  return db.auditLog.create({ data: { actorType: actor.role, actorId: actor.id, eventType, metadataJson: { groupId: groupOf(actor), ...metadataJson } } });
}
