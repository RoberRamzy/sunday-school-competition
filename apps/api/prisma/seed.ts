import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/credentials';
import { name, newPassword, username } from '../src/system/input';

const db = new PrismaClient();

async function seed() {
  const config = {
    username: username.parse(process.env.ADMIN_USERNAME),
    password: newPassword.parse(process.env.ADMIN_PASSWORD),
    fullName: name.parse(process.env.ADMIN_DISPLAY_NAME || 'Administrator'),
  };
  const passwordHash = await hashPassword(config.password);
  await db.$transaction(async (tx) => {
    // Prevent competing bootstrap commands from creating multiple initial administrators.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712113)`;
    const prior = await tx.adminUser.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    if (!prior) {
      await tx.adminUser.create({
        data: { username: config.username, fullName: config.fullName, role: 'SUPER_ADMIN', passwordHash },
      });
    }
    if (!await tx.grade.count()) {
      await tx.grade.createMany({ data: ['Grade 1', 'Grade 2', 'Grade 3'].map((name) => ({ name })) });
    }
  });
}

seed().catch(() => {
  process.stderr.write('Seed failed. Check the database migrations and the ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_DISPLAY_NAME settings.\n');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
