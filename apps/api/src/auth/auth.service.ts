import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Database } from '../database/database.module';
import { checkPassword, digest, hashPassword, randomToken } from './credentials';
import { audit, Principal } from './principal';

export const cookieName = 'sid';

export function sessionToken(req: Request) {
  const values = req.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const token = values.find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

type StudentLogin = { gradeId: string; studentId: string; pin: string; activationCode?: string };
type StaffLogin = { username: string; password: string };

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
    const where = { id: input.studentId, gradeId: input.gradeId };
    const student = await this.db.student.findFirst({ where });
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
        const principal = this.studentPrincipal(await tx.student.findUniqueOrThrow({ where }));
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
      const current = await tx.student.findFirst({ where });
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
      return this.rotate(tx, { id: current.id, role: current.role, displayName: current.fullName });
    });
  }

  private studentPrincipal(student: { id: string; gradeId: string; fullName: string }) {
    return { id: student.id, gradeId: student.gradeId, displayName: student.fullName, role: 'STUDENT' as const };
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
        student: { select: { id: true, fullName: true, status: true, gradeId: true } },
        staff: { select: { id: true, fullName: true, status: true, role: true } },
      },
    });
    if (session?.student?.status === 'ACTIVE') return this.studentPrincipal(session.student);
    if (session?.staff?.status === 'ACTIVE') {
      return { id: session.staff.id, role: session.staff.role, displayName: session.staff.fullName };
    }
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.db.session.updateMany({ where: { tokenHash: digest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async grades(ip: string) {
    await this.throttle('roster', ip, 240, 60);
    return this.db.grade.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async roster(gradeId: string, ip: string) {
    await this.throttle('roster', ip, 240, 60);
    return this.db.student.findMany({
      where: { gradeId, status: { not: 'SUSPENDED' } },
      select: { id: true, displayLabel: true },
      orderBy: { displayLabel: 'asc' },
    });
  }
}
