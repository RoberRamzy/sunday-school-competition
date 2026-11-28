import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Database } from '../database/database.module';
import { checkPassword, digest, hashPassword, randomToken } from './credentials';
import { audit, DEFAULT_GROUP_ID, Principal } from './principal';

export const cookieName = 'sid';

export function sessionToken(req: Request) {
  const values = req.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const token = values.find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

type StudentLogin = { gradeId: string; groupId?: string; studentId: string; pin: string; activationCode?: string };
type StaffLogin = { username: string; password: string };
type StaffSetup = StaffLogin & { setupCode: string };

@Injectable()
export class AuthService {
  constructor(private readonly db: Database) {}

  async throttle(scope: string, subject: string, limit: number, seconds: number) {
    const key = digest(`${scope}:${subject}`);
    const [row] = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthLimit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, clock_timestamp() + ${seconds} * INTERVAL '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthLimit"."expiresAt" <= clock_timestamp()
                       THEN 1 ELSE LEAST("AuthLimit"."count" + 1, ${limit + 1}) END,
        "expiresAt" = CASE WHEN "AuthLimit"."expiresAt" <= clock_timestamp()
                       THEN clock_timestamp() + ${seconds} * INTERVAL '1 second' ELSE "AuthLimit"."expiresAt" END
      RETURNING "count"
    `;
    if (row.count > limit) throw new HttpException('Too many attempts. Please try again later.', 429);
  }

  async studentSignIn(input: StudentLogin, ip: string) {
    await this.throttle('student-ip', ip, 180, 60);
    const throttleScope = input.activationCode === undefined ? 'student-login' : 'student-activation';
    await this.throttle(throttleScope, input.studentId, 8, 600);
    const where = { id: input.studentId, gradeId: input.gradeId, grade: { groupId: input.groupId ?? DEFAULT_GROUP_ID } };
    const student = await this.db.student.findFirst({ where, include: { grade: { select: { groupId: true } } } });
    const invalid = () => new UnauthorizedException('Invalid credentials');
    if (input.activationCode !== undefined) {
      if (student?.status !== 'PENDING_ACTIVATION' ||
          student.activationCodeHash !== digest(input.activationCode)) throw invalid();
      const pinHash = await hashPassword(input.pin);

      return this.db.$transaction(async (tx) => {
        const consumed = await tx.student.updateMany({
          where: { ...where, status: 'PENDING_ACTIVATION', activationCodeHash: student.activationCodeHash },
          data: { status: 'ACTIVE', pinHash, activationCodeHash: null, activationCodeUsedAt: new Date() },
        });
        if (consumed.count !== 1) throw invalid();
        const principal = this.studentPrincipal(await tx.student.findUniqueOrThrow({ where, include: { grade: { select: { groupId: true } } } }));
        const session = await this.rotate(tx, principal);
        await audit(tx, principal, 'STUDENT_ACTIVATED', { gradeId: principal.gradeId });
        return session;
      });
    }

    if (!await checkPassword(input.pin, student?.status === 'ACTIVE' ? student.pinHash : undefined)) {
      throw invalid();
    }
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${input.studentId}::uuid FOR UPDATE`;
      const current = await tx.student.findFirst({ where, include: { grade: { select: { groupId: true } } } });
      if (current?.status !== 'ACTIVE' || current.pinHash !== student?.pinHash) throw invalid();
      return this.rotate(tx, this.studentPrincipal(current));
    });
  }

  async staffSignIn(input: StaffLogin, ip: string) {
    await this.throttle('staff-ip', ip, 90, 60);
    await this.throttle('staff-login', input.username, 8, 600);
    const where = { username: input.username };
    const staff = await this.db.adminUser.findUnique({ where });
    const invalid = () => new UnauthorizedException('Invalid credentials');
    if (!await checkPassword(input.password, staff?.status === 'ACTIVE' ? staff.passwordHash : undefined)) {
      throw invalid();
    }
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdminUser" WHERE username = ${input.username} FOR UPDATE`;
      const current = await tx.adminUser.findUnique({ where });
      if (current?.status !== 'ACTIVE' || current.passwordHash !== staff?.passwordHash) throw invalid();
      return this.rotate(tx, { id: current.id, role: current.role, displayName: current.fullName, groupId: current.groupId });
    });
  }

  async setupServant(input: StaffSetup, ip: string) {
    await this.throttle('staff-ip', ip, 90, 60);
    await this.throttle('staff-setup', input.username, 8, 600);
    const where = {
      username: input.username, role: 'SERVANT' as const, status: 'ACTIVE' as const,
      passwordHash: null, setupCodeHash: digest(input.setupCode),
    };
    const invalid = () => new UnauthorizedException('Invalid credentials');
    const eligible = await this.db.adminUser.findUnique({
      where: { ...where, setupCodeExpiresAt: { gt: new Date() } }, select: { id: true },
    });
    if (!eligible) throw invalid();
    const passwordHash = await hashPassword(input.password);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AdminUser" WHERE id = ${eligible.id}::uuid FOR UPDATE`;
      const consumed = await tx.adminUser.updateMany({
        where: { ...where, id: eligible.id, setupCodeExpiresAt: { gt: new Date() } },
        data: { passwordHash, setupCodeHash: null, setupCodeExpiresAt: null },
      });
      if (consumed.count !== 1) throw invalid();
      const staff = await tx.adminUser.findUniqueOrThrow({ where: { id: eligible.id } });
      const principal = { id: staff.id, role: staff.role, displayName: staff.fullName, groupId: staff.groupId };
      const session = await this.rotate(tx, principal);
      await audit(tx, principal, 'SERVANT_CREDENTIAL_SET', {});
      return session;
    });
  }

  private studentPrincipal(student: { id: string; gradeId: string; fullName: string; grade: { groupId: string } }) {
    return { id: student.id, gradeId: student.gradeId, groupId: student.grade.groupId, displayName: student.fullName, role: 'STUDENT' as const };
  }

  private async rotate(tx: Prisma.TransactionClient, principal: Principal) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const token = randomToken();
    const owner = principal.role === 'STUDENT' ? { studentId: principal.id } : { staffId: principal.id };
    await tx.session.updateMany({ where: { ...owner, revokedAt: null }, data: { revokedAt: now } });
    await tx.session.create({ data: { ...owner, expiresAt, tokenHash: digest(token) } });
    return { principal, expiresAt, token };
  }

  async authenticate(token: string | undefined): Promise<Principal | undefined> {
    if (!token) return;
    const session = await this.db.session.findUnique({
      where: { tokenHash: digest(token), expiresAt: { gt: new Date() }, revokedAt: null },
      select: {
        student: { select: { id: true, fullName: true, status: true, gradeId: true, grade: { select: { groupId: true } } } },
        staff: { select: { id: true, fullName: true, status: true, role: true, groupId: true } },
      },
    });
    if (session?.student?.status === 'ACTIVE') return this.studentPrincipal(session.student);
    if (session?.staff?.status === 'ACTIVE') {
      return { id: session.staff.id, role: session.staff.role, displayName: session.staff.fullName, groupId: session.staff.groupId };
    }
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.db.session.updateMany({ where: { tokenHash: digest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  groupExists(id: string) {
    return this.db.competitionGroup.count({ where: { id } });
  }

  async grades(ip: string, groupId = DEFAULT_GROUP_ID) {
    await this.throttle('roster', ip, 240, 60);
    return this.db.grade.findMany({ where: { groupId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async competitionEntry(id: string) {
    const competition = await this.db.competition.findFirst({
      where: { id, status: { not: 'DRAFT' } }, select: { groupId: true },
    });
    return { groupId: competition?.groupId ?? null };
  }

  async roster(gradeId: string, ip: string, groupId = DEFAULT_GROUP_ID) {
    await this.throttle('roster', ip, 240, 60);
    return this.db.student.findMany({
      where: { gradeId, grade: { groupId }, status: { not: 'SUSPENDED' } },
      select: { id: true, displayLabel: true },
      orderBy: { displayLabel: 'asc' },
    });
  }
}
