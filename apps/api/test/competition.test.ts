import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/credentials';
import { shuffle } from '../src/competition/attempt.service';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const origin = 'http://localhost:3000';
const schema = `competition_test_${randomUUID().replaceAll('-', '')}`;
let app: INestApplication;
let db: PrismaClient;
let url: string;
let admin: string;
let servant: string;
let gradeId: string;
let otherGrade: string;
let students: { id: string; cookie: string }[];
const password = 'test-only admin password';
const pin = '012345';

type ResponseState = {
  id: string;
  status: string;
  expiresAt: string;
  index: number;
  total: number;
  revision: number;
  question: { id: string; type: string; text: string; items: { id: string; text: string }[] } | null;
  savedAnswer: string[] | null;
};

function authCookie(response: Response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header);
  return header.split(';')[0];
}

function request(path: string, cookie?: string, data?: unknown, method?: string) {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set('Cookie', cookie);
  if (data !== undefined) headers.set('Content-Type', 'application/json');
  return fetch(`${url}/api${path}`, {
    method: method ?? (data !== undefined ? 'POST' : 'GET'),
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

async function ok<T>(response: Promise<Response>): Promise<T> {
  const result = await response;
  const body = await result.json();
  assert.ok(result.ok, `${result.status}: ${JSON.stringify(body)}`);
  return body as T;
}

function minute(offset: number) {
  return new Date(Date.now() + offset * 60000).toISOString();
}

async function fixtures() {
  const items = ['A', 'B', 'C', 'D'].map((text) => ({ id: randomUUID(), text }));
  const mcq = await ok<{ id: string }>(request('/admin/questions', admin, {
    gradeId, type: 'MCQ', difficulty: 'EASY', points: 2, text: 'Multiple choice', items,
    correctOrder: [items[0].id], sortingMode: 'EXACT',
  }));
  const sorting = await ok<{ id: string }>(request('/admin/questions', admin, {
    gradeId, type: 'SORTING', difficulty: 'MEDIUM', points: 5, text: 'Sorting', items,
    correctOrder: items.map((item) => item.id), sortingMode: 'PARTIAL',
  }));
  const draft = {
    title: 'Pilot', instructions: 'Complete the quiz', opensAt: minute(-1), closesAt: minute(10),
    durationMinutes: 30,
    grades: [{
      gradeId, questionIds: [mcq.id, sorting.id],
      blueprint: [{ type: 'MCQ', difficulty: 'EASY', count: 1 }, { type: 'SORTING', difficulty: 'MEDIUM', count: 1 }],
    }],
  };
  return { draft, items, mcq, sorting };
}

async function makeCompetition(draft: Awaited<ReturnType<typeof fixtures>>['draft']) {
  const { id } = await ok<{ id: string }>(request('/admin/competitions', admin, draft));
  await ok(request(`/admin/competitions/${id}/activate`, admin, {}));
  return id;
}

async function forceDeadline(attemptId: string) {
  const deadline = new Date(Date.now() - 1000);
  await db.attempt.update({
    where: { id: attemptId },
    data: { startedAt: new Date(Date.now() - 2000), expiresAt: deadline },
  });
  return deadline;
}

function advance(attemptId: string, questionId: string, cookie: string, itemIds: string[], revision = 1) {
  return request(`/attempts/${attemptId}/answers`, cookie, { questionId, itemIds, revision, advance: true });
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
    db.grade.create({ data: { name: 'Quiz grade' } }),
    db.grade.create({ data: { name: 'Other grade' } }),
  ]);
  gradeId = first.id;
  otherGrade = second.id;
  const passwordHash = await hashPassword(password);
  await db.adminUser.create({ data: { username: 'quiz-admin', fullName: 'Quiz Admin', passwordHash, role: 'SUPER_ADMIN' } });
  await db.adminUser.create({
    data: { username: 'quiz-servant', fullName: 'Servant', passwordHash, grades: { create: { gradeId: otherGrade } } },
  });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  admin = authCookie(await request('/auth/staff-login', undefined, { username: 'quiz-admin', password }));
  servant = authCookie(await request('/auth/staff-login', undefined, { username: 'quiz-servant', password }));
  const pinHash = await hashPassword(pin);
  students = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const grade = index === 5 ? otherGrade : gradeId;
    const { id } = await db.student.create({
      data: { gradeId: grade, fullName: `Student ${index}`, displayLabel: `Student ${index}`, status: 'ACTIVE', pinHash, activationCodeUsedAt: new Date() },
    });
    const response = await request('/auth/login', undefined, { gradeId: grade, studentId: id, pin });
    return { id, cookie: authCookie(response) };
  }));
});

after(async () => {
  await app?.close();
  if (db) {
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$disconnect();
  }
});

test('shuffle respects controlled draws without mutating original order', () => {
  const original = [1, 2, 3];
  const draws: number[] = [];
  assert.deepEqual(shuffle(original, (_min, range) => { draws.push(range); return 0; }), [2, 3, 1]);
  assert.deepEqual(original, [1, 2, 3]);
  assert.deepEqual(draws, [3, 2]);
});

test('windows, blueprint, concurrent start, reconnect, replay and frozen scores', { skip: !databaseUrl }, async () => {
  const { draft, items, mcq, sorting } = await fixtures();
  const { id: badId } = await ok<{ id: string }>(request('/admin/competitions', admin, {
    ...draft, grades: [{ ...draft.grades[0], questionIds: [mcq.id] }],
  }));
  assert.equal((await request(`/admin/competitions/${badId}/activate`, admin, {})).status, 400);
  await ok(request(`/admin/competitions/${badId}`, admin, { grades: draft.grades }, 'PATCH'));

  const scheduled = await makeCompetition({ ...draft, opensAt: minute(2) });
  assert.equal((await request(`/competitions/${scheduled}/start`, students[0].cookie, {})).status, 409);
  const closed = await makeCompetition(draft);
  await db.competition.update({ where: { id: closed }, data: { closesAt: new Date(minute(-0.5)) } });
  assert.equal((await request(`/competitions/${closed}/start`, students[0].cookie, {})).status, 409);

  const competitionId = await makeCompetition(draft);
  const start = `/competitions/${competitionId}/start`;
  const a = students[0];
  const b = students[1];
  assert.equal((await request(start, students[5].cookie, {})).status, 403);
  const started = await Promise.all([1, 2, 3].map(() => ok<ResponseState>(request(start, a.cookie, {}))));
  assert.equal(new Set(started.map(({ id }) => id)).size, 1);
  assert.equal(new Set(started.map(({ expiresAt }) => expiresAt)).size, 1);
  assert.equal(started[0].expiresAt, draft.closesAt);
  assert.deepEqual(started[0].question, started[1].question);
  assert.equal(started[0].total, 2);
  assert.equal(started[0].index, 0);
  assert.equal(started[0].revision, 0);
  assert.deepEqual(Object.keys(started[0].question!).sort(), ['id', 'items', 'text', 'type']);
  assert.equal((await request(`/student/attempts/${started[0].id}`, b.cookie)).status, 404);
  assert.equal((await request(`/admin/attempts/${started[0].id}`, servant)).status, 403);

  await ok(request(`/admin/questions/${mcq.id}`, admin, { correctOrder: [items[1].id], text: 'Changed', points: 8 }, 'PATCH'));
  await ok(request(`/admin/questions/${sorting.id}`, admin, {}, 'DELETE'));
  const other = await ok<ResponseState>(request(start, b.cookie, {}));
  const stored = await db.attemptQuestion.findMany({
    where: { attemptId: { in: [started[0].id, other.id] } },
    select: { questionId: true, snapshot: true },
  });
  assert.equal(stored.length, 4);
  for (const question of [mcq, sorting]) {
    const [first, second] = stored.filter((row) => row.questionId === question.id);
    assert.deepEqual(first.snapshot, second.snapshot);
  }

  let attempt = started[0];
  const answerFor = (state: ResponseState) => state.question!.type === 'MCQ'
    ? [items[0].id]
    : [items[0].id, items[1].id, items[3].id, items[2].id];
  const firstQuestion = attempt.question!;
  const selection = answerFor(attempt);
  const saveOnly = await ok<ResponseState>(request(`/attempts/${attempt.id}/answers`, a.cookie, {
    questionId: firstQuestion.id, itemIds: selection, revision: 1, advance: false,
  }));
  assert.equal(saveOnly.index, 0);
  const resumed = await ok<ResponseState>(request(`/student/attempts/${attempt.id}`, a.cookie));
  assert.deepEqual(resumed.savedAnswer, selection);
  assert.deepEqual(resumed.question, firstQuestion);
  assert.equal(resumed.revision, 1);
  assert.equal((await advance(attempt.id, firstQuestion.id, a.cookie, selection)).status, 409);
  attempt = await ok<ResponseState>(advance(attempt.id, firstQuestion.id, a.cookie, selection, 2));
  assert.equal(attempt.index, 1);
  assert.equal((await ok<ResponseState>(advance(attempt.id, firstQuestion.id, a.cookie, selection, 2))).index, 1);
  assert.equal((await advance(attempt.id, firstQuestion.id, a.cookie, selection, 3)).status, 409);
  assert.equal((await advance(attempt.id, attempt.question!.id, a.cookie, [randomUUID()])).status, 400);
  attempt = await ok<ResponseState>(advance(attempt.id, attempt.question!.id, a.cookie, answerFor(attempt)));
  assert.equal(attempt.question, null);
  assert.equal(attempt.index, 2);
  const submitted = await ok<ResponseState>(request(`/attempts/${attempt.id}/submit`, a.cookie, {}));
  assert.equal(submitted.status, 'SUBMITTED');
  const result = await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.equal(Number(result.score), 4.5);
  assert.equal(result.maxScore, 7);
  assert.equal(result.correctCount, 1);
  assert.equal(result.incorrectCount, 1);
  assert.equal(result.unansweredCount, 0);
  assert.equal((await ok<{ result: unknown }>(request(`/student/competitions/${competitionId}`, a.cookie))).result, null);
  assert.equal((await request(`/admin/competitions/${competitionId}/publish`, admin, {})).status, 409);

  const staff = await db.adminUser.findUniqueOrThrow({ where: { username: 'quiz-servant' } });
  await ok(request(`/admin/servants/${staff.id}`, admin, { gradeIds: [gradeId] }, 'PATCH'));
  const detailPath = `/admin/attempts/${attempt.id}`;
  const detail = await ok<Record<string, unknown>>(request(detailPath, servant));
  assert.equal(detail.status, 'SUBMITTED');
  assert.ok(Array.isArray(detail.events));
  for (const field of ['score', 'percentage', 'correctCount', 'incorrectCount', 'unansweredCount']) assert.ok(!(field in detail));
  assert.equal((await request(`/admin/competitions/${competitionId}/results`, servant)).status, 403);
  await ok(request(`/admin/competitions/${competitionId}/close`, admin, {}));
  await ok(request(`/admin/competitions/${competitionId}/publish`, admin, {}));
  assert.equal((await ok<{ score: number }>(request(detailPath, servant))).score, 4.5);
});

test('monitoring, publication and export each reconcile pending deadlines', { skip: !databaseUrl }, async () => {
  const { draft, items } = await fixtures();
  for (const mode of ['monitoring', 'publish', 'results/export?format=csv']) {
    const competitionId = await makeCompetition(draft);
    const actor = students[2];
    const attempt = await ok<ResponseState>(request(`/competitions/${competitionId}/start`, actor.cookie, {}));
    const itemIds = attempt.question!.type === 'MCQ' ? [items[0].id] : items.map(({ id }) => id);
    const expected = attempt.question!.type === 'MCQ' ? 2 : 5;
    await ok(request(`/attempts/${attempt.id}/answers`, actor.cookie, {
      questionId: attempt.question!.id, itemIds, advance: false, revision: 1,
    }));
    const deadline = await forceDeadline(attempt.id);
    if (mode === 'publish') {
      await db.competition.update({ where: { id: competitionId }, data: { closesAt: deadline } });
      await ok(request(`/admin/competitions/${competitionId}/publish`, admin, {}));
    } else if (mode === 'monitoring') {
      const report = await ok<{ counts: { timedOut: number } }>(request(`/admin/competitions/${competitionId}/monitoring`, admin));
      assert.equal(report.counts.timedOut, 1);
    } else {
      const exportFile = await request(`/admin/competitions/${competitionId}/${mode}`, admin);
      assert.equal(exportFile.status, 200);
      assert.match(await exportFile.text(), /TIMED_OUT/);
    }
    const stored = await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(stored.status, 'TIMED_OUT');
    assert.equal(stored.finishedAt?.toISOString(), deadline.toISOString());
    assert.equal(stored.unansweredCount, 1);
    assert.equal(Number(stored.score), expected);
    if (mode === 'publish') {
      const student = await ok<{ result: { score: number; rank: number } }>(request(`/student/competitions/${competitionId}`, actor.cookie));
      assert.equal(student.result.score, expected);
      assert.equal(student.result.rank, 1);
    }
  }
});

test('deadline race finalizes once and returns the same immutable result', { skip: !databaseUrl }, async () => {
  const { draft, items } = await fixtures();
  const competitionId = await makeCompetition(draft);
  const actor = students[3];
  const attempt = await ok<ResponseState>(request(`/competitions/${competitionId}/start`, actor.cookie, {}));
  const { promise: locked, resolve: markLocked, reject: failLock } = Promise.withResolvers<Date>();
  const hold = db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ expiresAt: Date }[]>`
      UPDATE "Attempt" SET "expiresAt" = date_trunc('milliseconds', clock_timestamp() + INTERVAL '200 milliseconds')
      WHERE id = ${attempt.id}::uuid RETURNING "expiresAt"
    `;
    markLocked(row.expiresAt);
    await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.3)`;
  });
  void hold.catch(failLock);
  const deadline = await locked;
  const itemIds = attempt.question!.type === 'MCQ' ? [items[0].id] : items.map(({ id }) => id);
  const replies = await Promise.all([
    ok<ResponseState>(advance(attempt.id, attempt.question!.id, actor.cookie, itemIds)),
    ok<ResponseState>(request(`/attempts/${attempt.id}/submit`, actor.cookie, {})),
    ok<ResponseState>(request(`/attempts/${attempt.id}/status`, actor.cookie)),
    ok<ResponseState>(request(`/attempts/${attempt.id}/status`, actor.cookie)),
  ]);
  await hold;
  assert.ok(replies.every((reply) => reply.status === 'TIMED_OUT' && reply.question === null));
  const persisted = await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.equal(persisted.finishedAt?.toISOString(), deadline.toISOString());
  assert.equal(Number(persisted.score), 0);
  assert.equal(await db.auditLog.count({ where: { eventType: 'ATTEMPT_TIMED_OUT', metadataJson: { path: ['attemptId'], equals: attempt.id } } }), 1);
});

test('replacement transaction rolls back and a retried authorization starts exactly one replacement', { skip: !databaseUrl }, async () => {
  const { draft } = await fixtures();
  const competitionId = await makeCompetition(draft);
  const actor = students[4];
  const start = `/competitions/${competitionId}/start`;
  const original = await ok<ResponseState>(request(start, actor.cookie, {}));
  const authorize = `/admin/attempts/${original.id}/authorize-replacement`;

  // Force the third write to fail after the original has been invalidated and the replacement inserted.
  await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT "reject_replacement_test" CHECK ("eventType" <> 'ATTEMPT_REPLACEMENT_AUTHORIZED')`);
  assert.equal((await request(authorize, admin, { reason: 'Network interruption' })).status, 500);
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: original.id } })).status, 'IN_PROGRESS');
  assert.equal(await db.attempt.count({ where: { competitionId } }), 1);
  await db.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT "reject_replacement_test"`);

  const copies = await Promise.all([1, 2].map(() => ok<{ id: string; status: string }>(request(authorize, admin, { reason: 'Network interruption' }))));
  assert.deepEqual(copies[0], copies[1]);
  const replacement = await db.attempt.findUniqueOrThrow({ where: { id: copies[0].id } });
  assert.equal(replacement.replacesAttemptId, original.id);
  assert.equal(replacement.status, 'AWAITING_START');
  assert.equal(replacement.startedAt, null);
  const replacements = await Promise.all([1, 2].map(() => ok<ResponseState>(request(start, actor.cookie, {}))));
  assert.ok(replacements.every((attempt) => attempt.id === replacement.id && attempt.expiresAt === replacements[0].expiresAt));
  const auditCount = await db.auditLog.count({
    where: { eventType: 'ATTEMPT_REPLACEMENT_AUTHORIZED', metadataJson: { path: ['attemptId'], equals: original.id } },
  });
  assert.equal(auditCount, 1);
  const report = await ok<{ counts: { inProgress: number } }>(request(`/admin/competitions/${competitionId}/monitoring`, admin));
  assert.equal(report.counts.inProgress, 1);
  assert.equal((await request(`/admin/attempts/${replacement.id}/authorize-replacement`, admin, { reason: 'Again' })).status, 409);
});

test('exact sorting awards zero for a partial order, and skipped questions stay unanswered', { skip: !databaseUrl }, async () => {
  const { draft, sorting, items } = await fixtures();
  await ok(request(`/admin/questions/${sorting.id}`, admin, { sortingMode: 'EXACT' }, 'PATCH'));
  const competitionId = await makeCompetition(draft);
  const { cookie } = students[0];
  let state = await ok<ResponseState>(request(`/competitions/${competitionId}/start`, cookie, {}));
  for (let count = 0; count < 2; count++) {
    const { id, type } = state.question!;
    const chosen = type === 'MCQ' ? [] : [items[0].id, items[1].id, items[3].id, items[2].id];
    state = await ok<ResponseState>(advance(state.id, id, cookie, chosen));
  }
  await ok(request(`/attempts/${state.id}/submit`, cookie, {}));
  const result = await db.attempt.findUniqueOrThrow({ where: { id: state.id } });
  assert.equal(Number(result.score), 0);
  assert.equal(result.incorrectCount, 1);
  assert.equal(result.unansweredCount, 1);
});
