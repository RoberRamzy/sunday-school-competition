import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Workbook } from 'exceljs';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/credentials';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const origin = 'http://localhost:3000';
const schema = `identity_test_${randomUUID().replaceAll('-', '')}`;
let app: INestApplication;
let db: PrismaClient;
let url: string;
let adminCookie: string;
let grade1: string;
let grade2: string;
const staffPassword = 'test only staff password';

function getCookie(response: Response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.includes('HttpOnly'));
  assert.ok(cookie?.includes('SameSite=Lax'));
  return cookie!.split(';')[0];
}

function request(path: string, options: { method?: string; body?: unknown; cookie?: string; requestOrigin?: string } = {}) {
  const headers = new Headers({ Origin: options.requestOrigin ?? origin });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  return fetch(`${url}/api${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function createStudent(gradeId: string, displayLabel: string) {
  const response = await request('/admin/students', {
    cookie: adminCookie, body: { fullName: 'Shared Name', displayLabel, gradeId },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return await response.json() as { id: string; gradeId: string; displayLabel: string };
}

async function handout(gradeId: string, studentIds: string[], cookie = adminCookie) {
  const response = await request(`/admin/grades/${gradeId}/activation-handout`, { cookie, body: { studentIds } });
  assert.equal(response.status, 200, response.headers.get('content-type')?.includes('json') ? await response.clone().text() : '');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const sheet = (await new Workbook().xlsx.load(await response.arrayBuffer())).getWorksheet('Activation')!;
  assert.deepEqual(sheet.getRow(1).values, [, 'Name', 'One-time password']);
  const codes: Record<string, string> = {};
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const label = row.getCell(1).value;
    const code = row.getCell(2).value;
    assert.equal(typeof label, 'string');
    assert.equal(typeof code, 'string');
    codes[label as string] = code as string;
  });
  return codes;
}

before(async () => {
  if (!databaseUrl) return;
  const testUrl = new URL(databaseUrl);
  testUrl.searchParams.set('schema', schema);
  process.env.DATABASE_URL = testUrl.href;
  process.env.PUBLIC_ORIGIN = origin;
  process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  db = new PrismaClient();
  const [first, second] = await Promise.all([
    db.grade.create({ data: { name: 'First grade' } }),
    db.grade.create({ data: { name: 'Second grade' } }),
  ]);
  grade1 = first.id;
  grade2 = second.id;
  await db.adminUser.create({
    data: { username: 'test-admin', fullName: 'Test Admin', passwordHash: await hashPassword(staffPassword), role: 'SUPER_ADMIN' },
  });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  const login = await request('/auth/staff-login', { body: { username: 'test-admin', password: staffPassword } });
  assert.equal(login.status, 200);
  adminCookie = getCookie(login);
});

after(async () => {
  await app?.close();
  if (db) {
    // Schema name uses only a fixed prefix and a UUID's hexadecimal characters.
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
});

test('staff scope, CSRF and input validation protect roster and appearance', { skip: !databaseUrl }, async () => {
  const conflict = await request('/admin/students/import', {
    cookie: adminCookie,
    body: { gradeId: grade1, students: [1, 2].map(() => ({ fullName: 'Import', displayLabel: 'Import' })), dryRun: true },
  });
  assert.equal(conflict.status, 409);
  const rows = [{ fullName: 'Import', displayLabel: 'Import' }];
  for (const dryRun of [true, false]) {
    const imported = await request('/admin/students/import', { cookie: adminCookie, body: { gradeId: grade1, students: rows, dryRun } });
    assert.equal(imported.status, 200);
    assert.deepEqual(await imported.json(), { count: 1 });
  }
  const other = await createStudent(grade2, 'Other grade');
  const patch = await request('/admin/appearance', { cookie: adminCookie, method: 'PUT', body: { theme: 'christmas' }, requestOrigin: 'https://example.com' });
  assert.equal(patch.status, 403);
  assert.equal((await request('/admin/appearance', { cookie: adminCookie, method: 'PUT', body: { theme: 'christmas' } })).status, 200);
  assert.deepEqual(await (await request('/appearance')).json(), { theme: 'christmas' });

  const servant = await request('/admin/servants', {
    cookie: adminCookie, body: { fullName: 'Test Servant', username: 'test-servant', gradeIds: [grade1] },
  });
  assert.equal(servant.status, 201, await servant.clone().text());
  const account = await servant.json() as { id: string; setupCode: string };
  const login = await request('/auth/staff-setup', { body: { username: 'test-servant', password: '123456', setupCode: account.setupCode } });
  assert.equal(login.status, 200);
  const cookie = getCookie(login);
  assert.equal((await (await request('/admin/grades', { cookie })).json() as unknown[]).length, 1);
  assert.equal((await request(`/admin/students?gradeId=${grade2}`, { cookie })).status, 403);
  assert.equal((await request(`/admin/students/${other.id}/reset-pin`, { cookie, body: {} })).status, 403);
  assert.equal((await request(`/admin/grades/${grade2}/activation-handout`, { cookie, body: { studentIds: [other.id] } })).status, 403);
  assert.equal((await request('/admin/servants', { cookie })).status, 403);
  const scopedStudent = { fullName: 'Scoped Student', displayLabel: 'Scoped Student', gradeId: grade1 };
  assert.equal((await request('/admin/students', { cookie, body: { ...scopedStudent, gradeId: grade2 } })).status, 403);
  const added = await request('/admin/students', { cookie, body: scopedStudent });
  assert.equal(added.status, 201, await added.clone().text());
  const { id } = await added.json() as { id: string };
  const studentPath = '/admin/students/' + id;
  assert.equal((await request(studentPath, { cookie, method: 'PATCH', body: { gradeId: grade2 } })).status, 403);
  assert.equal((await request('/admin/students/' + other.id, { cookie, method: 'PATCH', body: { gradeId: grade1 } })).status, 403);
  assert.equal((await request('/admin/students/' + other.id, { cookie, method: 'DELETE', body: { confirmation: 'DELETE' } })).status, 403);
  const moveGrade = await request('/admin/grades', { cookie: adminCookie, body: { name: 'Servant move grade' } });
  assert.equal(moveGrade.status, 201);
  const destination = (await moveGrade.json() as { id: string }).id;
  assert.equal((await request('/admin/servants/' + account.id, {
    cookie: adminCookie, method: 'PATCH', body: { gradeIds: [grade1, destination] },
  })).status, 200);
  const changed = await request(studentPath, { cookie, method: 'PATCH', body: { gradeId: destination, fullName: 'Updated name', status: 'SUSPENDED' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { ...scopedStudent, id, gradeId: destination, fullName: 'Updated name', status: 'SUSPENDED' });
  assert.equal((await request(studentPath, { cookie, method: 'DELETE', body: { confirmation: 'DELETE' } })).status, 204);
  const payload = { students: [{ fullName: 'Scoped import', displayLabel: 'Scoped import' }], dryRun: false };
  assert.equal((await request('/admin/students/import', { cookie, body: { ...payload, gradeId: grade2 } })).status, 403);
  assert.equal((await request('/admin/students/import', { cookie, body: { ...payload, gradeId: grade1 } })).status, 200);
  assert.equal((await request('/admin/appearance', { cookie, method: 'PUT', body: { theme: 'classic' } })).status, 403);
});

test('one-time servant setup and recovery reject expired, replaced and reused codes', { skip: !databaseUrl }, async () => {
  const username = 'خادم الإعداد';
  const created = await request('/admin/servants', {
    cookie: adminCookie, body: { fullName: 'Setup Servant', username: '  خادم  الا\u0655عداد  ', gradeIds: [grade1] },
  });
  assert.equal(created.status, 201);
  const { id, setupCode, expiresAt } = await created.json() as { id: string; setupCode: string; expiresAt: string };
  assert.equal((await db.adminUser.findUniqueOrThrow({ where: { id } })).username, username);
  const duplicate = await request('/admin/servants', {
    cookie: adminCookie, body: { fullName: 'Duplicate Servant', username, gradeIds: [grade1] },
  });
  assert.equal(duplicate.status, 409);
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.equal((await db.adminUser.findUniqueOrThrow({ where: { id } })).passwordHash, null);
  const setup = (code: string, password = '004201') =>
    request('/auth/staff-setup', { body: { username, setupCode: code, password } });
  const signIn = (password: string) => request('/auth/staff-login', { body: { username, password } });
  const resetPath = '/admin/servants/' + id + '/reset-credential';
  async function reset() {
    const response = await request(resetPath, { cookie: adminCookie, body: {} });
    assert.equal(response.status, 200);
    return (await response.json() as { setupCode: string }).setupCode;
  }
  assert.equal((await signIn(setupCode)).status, 401);
  assert.equal((await setup(setupCode, '12345')).status, 400);
  assert.equal((await setup(setupCode, '1234567')).status, 400);
  await db.adminUser.update({ where: { id }, data: { setupCodeExpiresAt: new Date(0) } });
  assert.equal((await setup(setupCode)).status, 401);
  const fresh = await reset();
  assert.equal((await setup(setupCode)).status, 401);
  const parallel = await Promise.all([setup(fresh), setup(fresh)]);
  assert.deepEqual(parallel.map(response => response.status).sort(), [200, 401]);
  assert.equal((await setup(fresh)).status, 401);
  const signedIn = await signIn('004201');
  assert.equal(signedIn.status, 200);
  const cookie = getCookie(signedIn);
  assert.equal((await request(resetPath, { cookie, body: {} })).status, 403);
  const replacement = await reset();
  assert.equal((await request('/auth/me', { cookie })).status, 401);
  assert.equal((await signIn('004201')).status, 401);
  assert.equal((await setup(replacement, 'aB2cD4')).status, 200);
  assert.equal((await signIn('aB2cD4')).status, 200);
  const stored = await db.adminUser.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.setupCodeHash, null);
  assert.equal(stored.setupCodeExpiresAt, null);
  assert.ok(stored.passwordHash && stored.passwordHash !== 'aB2cD4');
});

test('handout reissue, credential selection, parallel activation and session rotation', { skip: !databaseUrl }, async () => {
  const a = await createStudent(grade1, 'Shared Name A');
  const b = await createStudent(grade1, 'Shared Name B');
  const once = await handout(grade1, [a.id, b.id]);
  const twice = await handout(grade1, [a.id]);
  assert.notEqual(once[a.displayLabel], twice[a.displayLabel]);
  assert.deepEqual(Object.keys(once).sort(), [a.displayLabel, b.displayLabel]);
  assert.deepEqual(Object.keys(twice), [a.displayLabel]);

  const pin = '004201';
  const selectA = { gradeId: grade1, studentId: a.id, pin };
  const activateA = { ...selectA, activationCode: twice[a.displayLabel] };
  assert.equal((await request('/auth/activate', { body: { ...activateA, activationCode: once[a.displayLabel] } })).status, 401);
  assert.equal((await request('/auth/activate', { body: { ...activateA, gradeId: grade2 } })).status, 401);
  assert.equal((await request('/auth/activate', { body: { ...activateA, pin: 4201 } })).status, 400);
  const parallel = await Promise.all([1, 2].map(() => request('/auth/activate', { body: activateA })));
  assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 401]);
  const cookieA = getCookie(parallel.find((r) => r.ok)!);
  assert.equal((await request('/auth/activate', { body: activateA })).status, 401);
  const selectB = { gradeId: grade1, studentId: b.id, pin };
  const other = await request('/auth/activate', { body: { ...selectB, activationCode: once[b.displayLabel] } });
  assert.equal(other.status, 200);
  assert.equal((await other.json() as { id: string }).id, b.id);

  const roster = await (await request(`/auth/grades/${grade1}/students`)).json() as Record<string, unknown>[];
  assert.ok(roster.some((row) => row.id === a.id));
  assert.ok(roster.every((row) => JSON.stringify(Object.keys(row).sort()) === '["displayLabel","id"]'));
  assert.equal((await request(`/admin/grades/${grade1}/activation-handout`, { cookie: adminCookie, body: { studentIds: [a.id] } })).status, 409);
  assert.equal((await request('/auth/login', { body: { ...selectA, pin: '000000' } })).status, 401);
  assert.equal((await request('/auth/login', { body: { ...selectA, gradeId: grade2 } })).status, 401);
  const relog = await request('/auth/login', { body: selectA });
  assert.equal((await relog.clone().json() as { id: string }).id, a.id);
  const newCookieA = getCookie(relog);
  assert.equal((await request('/auth/me', { cookie: cookieA })).status, 401);
  assert.equal((await request('/auth/me', { cookie: newCookieA })).status, 200);
  await db.session.updateMany({ where: { studentId: a.id, revokedAt: null }, data: { expiresAt: new Date(0) } });
  assert.equal((await request('/auth/me', { cookie: newCookieA })).status, 401);

  const cookieB = getCookie(await request('/auth/login', { body: selectB }));
  assert.equal((await request(`/admin/students/${b.id}/reset-pin`, { cookie: adminCookie, body: {} })).status, 200);
  assert.equal((await request('/auth/me', { cookie: cookieB })).status, 401);
  assert.equal((await request('/auth/login', { body: selectB })).status, 401);

  const inFlight = await Promise.all([1, 2].map(() => request('/auth/login', { body: selectA })));
  assert.deepEqual(inFlight.map((r) => r.status), [200, 200]);
  const available = await Promise.all(inFlight.map((r) => request('/auth/me', { cookie: getCookie(r) })));
  assert.deepEqual(available.map((r) => r.status).sort(), [200, 401]);
  const live = inFlight[available.findIndex((r) => r.ok)];
  assert.equal((await request('/auth/logout', { cookie: getCookie(live), body: {} })).status, 204);
  assert.equal((await request('/auth/me', { cookie: getCookie(live) })).status, 401);
});

test('wrong PIN locks the account temporarily and suspension blocks authentication', { skip: !databaseUrl }, async () => {
  const student = await createStudent(grade1, 'PIN lockout');
  const codes = await handout(grade1, [student.id]);
  const select = { gradeId: grade1, studentId: student.id, pin: '000001' };
  const activated = await request('/auth/activate', { body: { ...select, activationCode: codes[student.displayLabel] } });
  assert.equal(activated.status, 200);
  const attempts = await Promise.all(Array.from({ length: 8 }, () =>
    request('/auth/login', { body: { ...select, pin: '000002' } }),
  ));
  assert.deepEqual(attempts.map((r) => r.status), Array(8).fill(401));
  assert.equal((await request('/auth/login', { body: select })).status, 429);
  const suspend = await request(`/admin/students/${student.id}`, { cookie: adminCookie, method: 'PATCH', body: { status: 'SUSPENDED' } });
  assert.equal(suspend.status, 200);
  assert.equal((await request('/auth/me', { cookie: getCookie(activated) })).status, 401);
  assert.equal((await request('/auth/login', { body: { ...select, gradeId: grade2 } })).status, 429);
});
