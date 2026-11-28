import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
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

function request(path: string, cookie?: string, data?: unknown, method?: string, groupId?: string) {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set('Cookie', cookie);
  if (groupId) headers.set('x-competition-group', groupId);
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
  const mcq = await db.question.create({ data: {
    gradeId, type: 'MCQ', difficulty: 'EASY', points: 2, text: 'Multiple choice', items, tags: [],
    correctOrder: [items[0].id], sortingMode: 'EXACT',
  } });
  const sorting = await db.question.create({ data: {
    gradeId, type: 'SORTING', difficulty: 'MEDIUM', points: 5, text: 'Sorting', items, tags: [],
    correctOrder: items.map((item) => item.id), sortingMode: 'PARTIAL',
  } });
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

async function legacyDraft(draft: Awaited<ReturnType<typeof fixtures>>['draft']) {
  const { grades, opensAt, closesAt, ...fields } = draft;
  return db.competition.create({
    data: { ...fields, opensAt: new Date(opensAt), closesAt: new Date(closesAt), grades: {
      create: grades.map(({ gradeId, blueprint, questionIds }) => ({
        gradeId, blueprint, questions: { create: questionIds.map((questionId, position) => ({ questionId, position })) },
      })),
    } },
  });
}

async function makeCompetition(draft: Awaited<ReturnType<typeof fixtures>>['draft']) {
  const { id } = await legacyDraft(draft);
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
  const { id: badId } = await legacyDraft({
    ...draft, grades: [{ ...draft.grades[0], questionIds: [mcq.id] }],
  });
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

  await db.question.update({ where: { id: mcq.id }, data: { correctOrder: [items[1].id], text: 'Changed', points: 8 } });
  await db.question.update({ where: { id: sorting.id }, data: { archived: true } });
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
  await ok(request(`/admin/servants/${staff.id}`, admin, { gradeIds: [otherGrade] }, 'PATCH'));
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
  await db.question.update({ where: { id: sorting.id }, data: { sortingMode: 'EXACT' } });
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

type Standing = { rank: number; grade: string; score: number; maxScore: number; name: string };
type Board = { scope: string; rows: Standing[] };
type Leaderboard = { overallAvailable: boolean; boards: Board[]; scopes: string[]; published: boolean;
  revision: string; publication: { title: string; boards: Board[] } };

test('shared draft questions and dense overall and grade leaderboards use explicit publication', { skip: !databaseUrl }, async () => {
  const items = ['Blue', 'Red'].map(text => ({ id: randomUUID(), text }));
  const questions = [1, 2].map(points => ({
    id: randomUUID(), type: 'MCQ', difficulty: 'EASY', text: `Choose blue for ${points} points`,
    points, items, correctOrder: [items[0].id], sortingMode: 'PARTIAL',
  }));
  const draft = {
    title: 'Shared quiz', instructions: '', opensAt: minute(-1), closesAt: minute(10), durationMinutes: 8,
    gradeIds: [gradeId, otherGrade], questions,
  };
  const { id } = await ok<{ id: string }>(request('/admin/competitions', admin, draft));
  const independent = await ok<{ id: string }>(request('/admin/competitions', admin, {
    ...draft, questions: questions.map(q => ({ ...q, id: randomUUID(), points: 9 })),
  }));
  const staff = `/admin/competitions/${id}`;
  const boards = staff + '/leaderboard';
  const publicPath = `/leaderboards/${id}`;
  assert.notEqual(id, independent.id);
  const stored = await db.question.findMany({ where: { competitionId: id } });
  assert.deepEqual(stored.map(q => q.points).sort(), [1, 2]);
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await request(boards, servant)).status, 403);

  await ok(request(staff + '/activate', admin, {}));
  await ok(request(staff, admin, draft, 'PATCH'));
  assert.equal((await request('/admin/questions/' + questions[0].id, admin, { points: 100 }, 'PATCH')).status, 404);
  const attempts = await Promise.all(students.map(({ cookie }) =>
    ok<ResponseState>(request(`/competitions/${id}/start`, cookie, {}))));
  assert.equal((await request(staff, admin, draft, 'PATCH')).status, 409);
  for (const [index, attempt] of attempts.entries()) {
    const quiz = await db.attemptQuestion.findMany({ where: { attemptId: attempt.id }, select: { questionId: true } });
    assert.deepEqual(quiz.map(row => row.questionId).sort(), questions.map(q => q.id).sort());
    const resumed = await ok<ResponseState>(request(`/student/attempts/${attempt.id}`, students[index].cookie));
    assert.deepEqual(resumed.question, attempt.question);
  }
  await ok(request(boards, admin, { scopes: [gradeId], tiePolicy: 'SCORE_ONLY' }, 'PUT'));
  const early = await ok<Leaderboard>(request(boards, admin));
  await ok(request(boards + '/publish', admin, { revision: early.revision }));
  assert.equal((await ok<{ provisional: boolean }>(request(publicPath))).provisional, true);

  const points = [3, 2, 2, 1, 0, 3];
  for (const [index, attempt] of attempts.entries()) {
    const startedAt = new Date(Date.now() - 10000);
    const finishedAt = new Date(startedAt.getTime() + (index === 5 ? 1000 : 2000));
    await db.attempt.update({ where: { id: attempt.id }, data: {
      status: 'SUBMITTED', score: points[index], startedAt, finishedAt, submittedAt: finishedAt,
    } });
  }
  assert.equal((await ok<Leaderboard['publication']>(request(publicPath))).boards[0].rows.length, 5);
  await ok(request(boards + '/unpublish', admin, {}));
  await ok(request(staff + '/close', admin, {}));
  const first = await ok<Leaderboard>(request(boards, admin));
  assert.deepEqual(first.boards.find(board => board.scope === 'overall')?.rows.map(row => row.rank), [1, 1, 2, 2, 3, 4]);
  assert.deepEqual(first.boards.find(board => board.scope === otherGrade)?.rows.map(row => row.rank), [1]);
  await ok(request(boards + '/publish', admin, { revision: first.revision }));
  const gradePublic = await ok<Leaderboard['publication']>(request(publicPath));
  assert.deepEqual(gradePublic, first.publication);
  assert.deepEqual(gradePublic.boards.map(board => board.scope), [gradeId]);
  assert.ok(gradePublic.boards[0].rows.some(row => row.name === 'Student 0'));
  assert.equal((await request(boards, admin, { scopes: ['overall'], tiePolicy: 'SCORE_THEN_TIME' }, 'PUT')).status, 409);
  const result = await ok<{ result: unknown }>(request(`/student/competitions/${id}`, students[0].cookie));
  assert.equal(result.result, null);

  await ok(request(boards + '/unpublish', admin, {}));
  assert.equal((await request(publicPath)).status, 404);
  await db.student.update({ where: { id: students[5].id }, data: { fullName: 'Full Student Name 5' } });
  const withTime = await ok<Leaderboard>(request(boards, admin, { scopes: ['overall'], tiePolicy: 'SCORE_THEN_TIME' }, 'PUT'));
  assert.equal((await request(boards + '/publish', admin, { revision: first.revision })).status, 409);
  const rows = withTime.boards.find(board => board.scope === 'overall')!.rows;
  assert.equal(rows[0].name, 'Full Student Name 5');
  assert.deepEqual(rows.map(row => row.rank), [1, 2, 3, 3, 4, 5]);
  await ok(request(boards + '/publish', admin, { revision: withTime.revision }));
  const body = await ok<Leaderboard['publication']>(request(publicPath));
  assert.deepEqual(body, withTime.publication);
  const publicRows = body.boards[0].rows;
  assert.ok(publicRows.every(row => typeof row.name === 'string' && !('alias' in row) && !('studentId' in row)));
  assert.equal(publicRows[1].name, gradePublic.boards[0].rows[0].name);

  const { leaderboardAliasKey } = await db.competition.findUniqueOrThrow({ where: { id } });
  const { name: legacyName, ...legacyStats } = publicRows[0];
  const alias = 'Player ' + createHmac('sha256', leaderboardAliasKey).update(students[5].id).digest('hex').slice(0, 20).toUpperCase();
  await db.competition.update({ where: { id }, data: {
    publicLeaderboard: { title: body.title, boards: [{ ...body.boards[0], rows: [{ ...legacyStats, alias }] }] },
  } });
  const legacy = await ok<Leaderboard['publication']>(request(publicPath));
  assert.deepEqual(legacy.boards[0].rows, [{ ...legacyStats, name: legacyName }]);
  const preview = await ok<Leaderboard>(request(boards, admin));
  assert.deepEqual(preview.publication, legacy);
});

test('legacy grades require matching frozen questions for Overall and drafts can be copied to shared questions', { skip: !databaseUrl }, async () => {
  const { draft, mcq, sorting } = await fixtures();
  const { id: _id, gradeId: _grade, competitionId: _owner, createdAt: _created, updatedAt: _updated, ...fields } = mcq;
  const otherQuestion = await db.question.create({ data: {
    ...fields, items: mcq.items as { id: string; text: string }[], gradeId: otherGrade, points: mcq.points + 1,
  } });
  const oldDraft = {
    ...draft,
    grades: [...draft.grades, { gradeId: otherGrade, questionIds: [otherQuestion.id],
      blueprint: [{ type: 'MCQ', difficulty: 'EASY', count: 1 }] }],
  };
  const existing = await makeCompetition(oldDraft);
  const oldBoards = await ok<Leaderboard>(request(`/admin/competitions/${existing}/leaderboard`, admin));
  assert.equal(oldBoards.overallAvailable, false);
  assert.deepEqual(new Set(oldBoards.boards.map(board => board.scope)), new Set([gradeId, otherGrade]));

  const { id } = await legacyDraft(oldDraft);
  const path = `/admin/competitions/${id}`;
  const source = await ok<{ legacyDraftSets: { gradeId: string; questions: { id: string }[] }[] }>(request(path, admin));
  const selected = source.legacyDraftSets.find(grade => grade.gradeId === gradeId)!;
  assert.deepEqual(selected.questions.map(question => question.id), [mcq.id, sorting.id]);
  await ok(request(path, admin, {
    gradeIds: [gradeId, otherGrade], questions: selected.questions.map(question => ({ ...question, id: randomUUID() })),
  }, 'PATCH'));
  await ok(request(path + '/activate', admin, {}));
  const converted = await ok<Leaderboard>(request(path + '/leaderboard', admin));
  assert.equal(converted.overallAvailable, true);
  assert.ok(await db.question.findUnique({ where: { id: mcq.id } }));
});

test('overall leaderboard totals published results, shares ranks and removes deleted scores', { skip: !databaseUrl }, async () => {
  const staffPath = '/admin/leaderboards/all';
  const publicPath = '/leaderboards/all';
  const makeCompetition = (title: string, published: boolean) => db.competition.create({ data: {
    title, instructions: '', status: 'CLOSED', opensAt: new Date(minute(-5)),
    closesAt: new Date(minute(-1)), durationMinutes: 5, publishedAt: published ? new Date() : null,
  } });
  const [first, second, unpublished] = await Promise.all([
    makeCompetition('Overall fixture 1', true), makeCompetition('Overall fixture 2', true),
    makeCompetition('Overall fixture unpublished', false),
  ]);
  const names = ['Overall A', 'Overall B', 'Overall C'];
  const roster = await Promise.all(names.map(fullName => db.student.create({ data: {
    fullName, displayLabel: fullName, gradeId,
  } })));
  const startedAt = new Date(minute(-4));
  const expiresAt = new Date(minute(-1));
  const attempt = (competitionId: string, index: number, score: number, status: 'SUBMITTED' | 'TIMED_OUT' | 'INVALIDATED' = 'SUBMITTED') =>
    ({ competitionId, studentId: roster[index].id, gradeId, score, maxScore: 200, status, startedAt, expiresAt,
      finishedAt: expiresAt, submittedAt: status === 'SUBMITTED' ? expiresAt : null });
  await db.attempt.createMany({ data: [
    attempt(first.id, 0, 80), attempt(second.id, 0, 40), attempt(first.id, 1, 120, 'TIMED_OUT'),
    attempt(second.id, 2, 90), attempt(unpublished.id, 2, 180), attempt(second.id, 1, 170, 'INVALIDATED'),
  ] });

  const rows = (board: Leaderboard['publication']) => board.boards[0].rows.filter(row => names.includes(row.name));
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await request(staffPath, students[0].cookie)).status, 403);
  assert.equal((await request(staffPath, students[0].cookie, { published: true }, 'PUT')).status, 403);
  const preview = await ok<Leaderboard['publication'] & { published: boolean }>(request(staffPath, servant));
  assert.equal(preview.published, false);
  assert.deepEqual(rows(preview).map(({ name, rank, score }) => [name, rank, score]),
    [['Overall B', 1, 120], ['Overall A', 2, 120], ['Overall C', 3, 90]]);
  await ok(request(staffPath, servant, { published: true }, 'PUT'));
  assert.deepEqual(rows(await ok<Leaderboard['publication']>(request(publicPath))), rows(preview));
  assert.equal((await request('/admin/competitions/' + second.id, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 204);
  const adjusted = await ok<Leaderboard['publication']>(request(publicPath));
  assert.deepEqual(rows(adjusted).map(({ name, rank, score }) => [name, rank, score]),
    [['Overall B', 1, 120], ['Overall A', 2, 80]]);
  await ok(request(staffPath, servant, { published: false }, 'PUT'));
  assert.equal((await request(publicPath)).status, 404);
});

test('servants manage competitions only when assigned every eligible grade', { skip: !databaseUrl }, async () => {
  const items = ['Blue', 'Red'].map(text => ({ id: randomUUID(), text }));
  const draft = {
    title: 'Scoped competition', instructions: '', opensAt: minute(-1), closesAt: minute(10), durationMinutes: 8,
    gradeIds: [otherGrade],
    questions: [{ id: randomUUID(), type: 'MCQ', difficulty: 'EASY', text: 'Blue?', points: 2,
      items, correctOrder: [items[0].id], sortingMode: 'PARTIAL' }],
  };
  assert.equal((await request('/admin/competitions', servant, { ...draft, gradeIds: [gradeId] })).status, 403);
  const { id } = await ok<{ id: string }>(request('/admin/competitions', servant, draft));
  const path = '/admin/competitions/' + id;
  const info = await ok<{ canManage: boolean; questions: unknown[] }>(request(path, servant));
  assert.equal(info.canManage, true);
  assert.equal(info.questions.length, 1);
  assert.equal((await request(path, servant, { ...draft, gradeIds: [gradeId] }, 'PATCH')).status, 403);
  await ok(request(path, servant, { ...draft, title: 'Edited scoped competition' }, 'PATCH'));
  for (const action of ['activate', 'close', 'publish', 'archive']) await ok(request(path + '/' + action, servant, {}));
  await ok(request(path + '/leaderboard', servant));
  assert.equal((await request(path, servant, { confirmation: 'DELETE' }, 'DELETE')).status, 204);

  const shared = await ok<{ id: string }>(request('/admin/competitions', admin, { ...draft, gradeIds: [gradeId, otherGrade] }));
  const sharedPath = '/admin/competitions/' + shared.id;
  assert.equal((await request(sharedPath, servant)).status, 403);
  assert.equal((await request(sharedPath, servant, draft, 'PATCH')).status, 403);
  assert.equal((await request(sharedPath + '/activate', servant, {})).status, 403);
  await ok(request(sharedPath + '/activate', admin, {}));
  assert.equal((await ok<{ canManage: boolean }>(request(sharedPath, servant))).canManage, false);
  assert.equal((await request(sharedPath + '/close', servant, {})).status, 403);
  assert.equal((await request(sharedPath, servant, { confirmation: 'DELETE' }, 'DELETE')).status, 403);
  await ok(request(sharedPath + '/close', admin, {}));
  assert.equal((await request(sharedPath + '/publish', servant, {})).status, 403);
  assert.equal((await request(sharedPath + '/archive', servant, {})).status, 403);
  assert.equal((await request(sharedPath, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 204);
});

test('permanent deletion removes only the selected competition and student results, including published snapshots', { skip: !databaseUrl }, async () => {
  const fixture = async (index: number) => {
    const displayLabel = `Delete fixture ${index}`;
    const student = await db.student.create({
      data: { gradeId, fullName: displayLabel, displayLabel, status: 'ACTIVE',
        pinHash: await hashPassword(pin), activationCodeUsedAt: new Date() },
    });
    const cookie = authCookie(await request('/auth/login', undefined, { gradeId, studentId: student.id, pin }));
    return { student, cookie };
  };
  const [first, second] = await Promise.all([fixture(1), fixture(2)]);
  const items = ['Blue', 'Red'].map(text => ({ id: randomUUID(), text }));
  const { id } = await ok<{ id: string }>(request('/admin/competitions', admin, {
    title: 'Deletion fixture', instructions: '', opensAt: minute(-1), closesAt: minute(10), durationMinutes: 8,
    gradeIds: [gradeId], questions: [{ id: randomUUID(), type: 'MCQ', difficulty: 'EASY', text: 'Blue',
      points: 2, items, correctOrder: [items[0].id], sortingMode: 'PARTIAL' }],
  }));
  const path = `/admin/competitions/${id}`;
  await ok(request(path + '/activate', admin, {}));
  const start = (cookie: string) => ok<ResponseState>(request(`/competitions/${id}/start`, cookie, {}));
  const original = await start(second.cookie);
  await ok(request(`/admin/attempts/${original.id}/authorize-replacement`, admin, { reason: 'Synthetic recovery' }));
  const attempts = [await start(first.cookie), await start(second.cookie)];
  const cookies = [first.cookie, second.cookie];
  for (const [index, attempt] of attempts.entries()) {
    await ok(advance(attempt.id, attempt.question!.id, cookies[index], [items[index].id]));
    await ok(request(`/attempts/${attempt.id}/submit`, cookies[index], {}));
  }
  await ok(request(path + '/close', admin, {}));
  await ok(request(path + '/publish', admin, {}));
  const boards = path + '/leaderboard';
  const view = await ok<Leaderboard>(request(boards, admin, { scopes: ['overall', gradeId], tiePolicy: 'SCORE_ONLY' }, 'PUT'));
  await ok(request(boards + '/publish', admin, { revision: view.revision }));
  const publicPath = `/leaderboards/${id}`;

  const deleteStudent = `/admin/students/${first.student.id}`;
  assert.equal((await request(deleteStudent, servant, { confirmation: 'DELETE' }, 'DELETE')).status, 403);
  assert.equal((await request(deleteStudent, admin, {}, 'DELETE')).status, 400);
  assert.equal((await request(deleteStudent, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 204);
  assert.equal(await db.student.count({ where: { id: first.student.id } }), 0);
  assert.equal(await db.session.count({ where: { studentId: first.student.id } }), 0);
  assert.equal(await db.attempt.count({ where: { studentId: first.student.id } }), 0);
  assert.equal((await request('/auth/me', first.cookie)).status, 401);
  const after = await ok<Leaderboard['publication']>(request(publicPath));
  assert.ok(after.boards.every(board => board.rows.length === 1 &&
    board.rows[0].rank === 1 && board.rows[0].name === second.student.fullName));

  assert.equal((await request(path, servant, { confirmation: 'DELETE' }, 'DELETE')).status, 403);
  assert.equal((await request(path, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 204);
  assert.equal(await db.competition.count({ where: { id } }), 0);
  assert.equal(await db.attempt.count({ where: { competitionId: id } }), 0);
  assert.equal(await db.question.count({ where: { competitionId: id } }), 0);
  assert.equal(await db.auditLog.count({ where: { metadataJson: { path: ['competitionId'], equals: id } } }), 0);
  assert.equal(await db.student.count({ where: { id: second.student.id } }), 1);
  assert.equal((await request(publicPath)).status, 404);
  assert.equal((await request(`/student/competitions/${id}`, second.cookie)).status, 404);
  assert.equal((await request(`/attempts/${attempts[1].id}/status`, second.cookie)).status, 404);
});

test('only a super admin can delete another staff account and its sessions', { skip: !databaseUrl }, async () => {
  const me = await ok<{ id: string }>(request('/auth/me', admin));
  const credentials = { username: 'delete-admin-fixture', password };
  const other = await db.adminUser.create({
    data: { username: credentials.username, passwordHash: await hashPassword(password), fullName: 'Delete admin', role: 'SUPER_ADMIN' },
  });
  const cookie = authCookie(await request('/auth/staff-login', undefined, credentials));
  const path = `/admin/staff/${other.id}`;
  assert.equal((await request('/admin/staff', servant)).status, 403);
  assert.equal((await request(path, servant, { confirmation: 'DELETE' }, 'DELETE')).status, 403);
  assert.equal((await request(`/admin/staff/${me.id}`, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 403);
  const list = await ok<Array<{ id: string; role: string }>>(request('/admin/staff', admin));
  assert.ok(list.some(row => row.id === other.id && row.role === 'SUPER_ADMIN' && !('passwordHash' in row)));
  assert.equal((await request(path, admin, { confirmation: 'DELETE' }, 'DELETE')).status, 204);
  assert.equal((await request('/auth/me', cookie)).status, 401);
  assert.equal(await db.session.count({ where: { staffId: other.id } }), 0);
  assert.equal((await request('/auth/me', admin)).status, 200);
});

test('isolated group staff can publish live boards, replace attempts, and safely correct quizzes', { skip: !databaseUrl }, async () => {
  const { id: groupId } = await ok<{ id: string }>(request('/admin/groups', admin, { name: 'Separate competition group' }));
  const staffRoute = (path: string, data?: unknown, method?: string) => request(path, admin, data, method, groupId);
  const { id: fourth } = await ok<{ id: string }>(staffRoute('/admin/grades', { name: 'Grade 4' }));
  const { id: fifth } = await ok<{ id: string }>(staffRoute('/admin/grades', { name: 'Grade 5' }));
  const gradeList = (path: string, cookie?: string) => ok<{ id: string }[]>(request(path, cookie));
  assert.deepEqual((await gradeList('/auth/grades?groupId=' + groupId)).map(grade => grade.id), [fourth, fifth]);
  assert.ok(!(await gradeList('/auth/grades')).some(grade => grade.id === fourth));
  assert.ok(!(await gradeList('/admin/grades', admin)).some(grade => grade.id === fifth));
  assert.equal((await request('/admin/groups', servant)).status, 403);

  await db.adminUser.create({ data: {
    groupId, username: 'group-four-servant', fullName: 'Group four servant',
    passwordHash: await hashPassword(password), grades: { create: { gradeId: fourth } },
  } });
  const groupServant = authCookie(await request('/auth/staff-login', undefined, { username: 'group-four-servant', password }));
  assert.deepEqual((await gradeList('/admin/grades', groupServant)).map(grade => grade.id), [fourth]);
  assert.equal((await request('/admin/grades', servant, undefined, undefined, groupId)).status, 403);

  const items = ['Before correction', 'After correction'].map(text => ({ id: randomUUID(), text }));
  const question = {
    id: randomUUID(), text: 'Question to correct', type: 'MCQ', difficulty: 'EASY', points: 3,
    items, correctOrder: [items[0].id], sortingMode: 'PARTIAL',
  };
  const opensAt = minute(-1);
  const closesAt = minute(15);
  const draft = { title: 'Group-four competition', instructions: '', durationMinutes: 5, opensAt, closesAt, questions: [question] };
  assert.equal((await staffRoute('/admin/competitions', { ...draft, gradeIds: [fourth, gradeId] })).status, 400);
  const { id } = await ok<{ id: string }>(staffRoute('/admin/competitions', { ...draft, gradeIds: [fourth, fifth] }));
  const path = '/admin/competitions/' + id;
  const leaderboard = path + '/leaderboard';
  const publicPath = '/leaderboards/' + id;
  assert.equal((await request(path, groupServant)).status, 403); // A partly assigned servant cannot see the draft.
  await ok(staffRoute(path + '/activate', {}));
  assert.equal((await request(path, groupServant, { title: 'No' }, 'PATCH')).status, 403);
  assert.equal((await request(leaderboard, groupServant)).status, 403);
  await ok(staffRoute(path, { gradeIds: [fourth] }, 'PATCH'));
  assert.equal((await request(path, servant)).status, 404);
  assert.equal((await request(path + '/results/export?format=csv', servant)).status, 404);
  assert.equal((await request('/student/competitions/' + id, students[0].cookie)).status, 404);
  assert.deepEqual(await ok(request('/auth/competition-entry/' + id)), { groupId });

  const actor = await db.student.create({ data: {
    gradeId: fourth, fullName: 'Grade four student A', displayLabel: 'A',
    status: 'ACTIVE', pinHash: await hashPassword(pin), activationCodeUsedAt: new Date(),
  } });
  const next = await db.student.create({ data: {
    gradeId: fourth, fullName: 'Grade four student B', displayLabel: 'B',
    status: 'ACTIVE', pinHash: await hashPassword(pin), activationCodeUsedAt: new Date(),
  } });
  const login = async (studentId: string) => authCookie(await request('/auth/login', undefined, { groupId, gradeId: fourth, studentId, pin }));
  assert.equal((await request('/auth/login', undefined, { gradeId: fourth, studentId: actor.id, pin })).status, 401);
  assert.deepEqual(await ok(request('/auth/grades/' + fourth + '/students')), []);
  const [firstCookie, nextCookie] = await Promise.all([login(actor.id), login(next.id)]);
  assert.equal((await request('/admin/students/' + actor.id, groupServant, { gradeId }, 'PATCH')).status, 403);

  const first = await ok<ResponseState & { timerEnabled: boolean }>(request('/competitions/' + id + '/start', firstCookie, {}));
  assert.equal(first.timerEnabled, true);
  await ok(request('/attempts/' + first.id + '/answers', firstCookie, {
    questionId: question.id, itemIds: [items[0].id], advance: false, revision: 1,
  }));
  await ok(request(path, groupServant, { timerEnabled: false }, 'PATCH'));
  const resumed = await ok<ResponseState & { timerEnabled: boolean }>(request('/student/attempts/' + first.id, firstCookie));
  assert.equal(resumed.timerEnabled, true);
  assert.equal(resumed.expiresAt, first.expiresAt);
  assert.deepEqual(resumed.question, first.question);
  assert.deepEqual(resumed.savedAnswer, [items[0].id]);
  const future = await ok<ResponseState & { timerEnabled: boolean }>(request('/competitions/' + id + '/start', nextCookie, {}));
  assert.equal(future.timerEnabled, false);
  assert.equal(future.expiresAt, closesAt);
  assert.equal((await request(path, groupServant, { closesAt: minute(2) }, 'PATCH')).status, 409);
  assert.equal((await request(path, groupServant, { questions: [question] }, 'PATCH')).status, 409);

  await ok(advance(first.id, question.id, firstCookie, [items[0].id], 2));
  await ok(advance(future.id, question.id, nextCookie, [items[1].id]));
  await ok(request(leaderboard, groupServant, { scopes: ['overall', fourth], tiePolicy: 'SCORE_THEN_TIME' }, 'PUT'));
  const { revision } = await ok<Leaderboard>(request(leaderboard, groupServant));
  await ok(request(leaderboard + '/publish', groupServant, { revision }));
  await ok(request('/admin/leaderboards/all', groupServant, { published: true }, 'PUT'));
  const groupOverall = '/leaderboards/all/' + groupId;
  assert.equal((await ok<Leaderboard['publication']>(request(publicPath))).boards[0].rows.length, 0);

  await ok(request('/attempts/' + first.id + '/submit', firstCookie, {}));
  const ended = await db.attempt.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal((await ok<Leaderboard['publication']>(request(publicPath))).boards[0].rows[0].score, 3);
  assert.equal((await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows[0].score, 3);
  assert.ok(!(await ok<Leaderboard>(request('/admin/leaderboards/all', servant))).boards[0].rows.some(row => row.name === actor.fullName));
  assert.equal((await ok<{ result: unknown }>(request('/student/competitions/' + id, firstCookie))).result, null);

  const [correction, submitted] = await Promise.all([
    request(path, groupServant, { answerKeys: [{ questionId: question.id, correctOrder: [items[1].id] }] }, 'PATCH'),
    request('/attempts/' + future.id + '/submit', nextCookie, {}),
  ]);
  await ok(Promise.resolve(correction));
  await ok(Promise.resolve(submitted));
  const rescored = await db.attempt.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(rescored.finishedAt!.getTime(), ended.finishedAt!.getTime());
  assert.equal(Number(rescored.score), 0);
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: future.id } })).expiresAt!.toISOString(), future.expiresAt);
  assert.deepEqual((await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows.map(row => row.score), [3, 0]);

  assert.equal((await request('/admin/attempts/' + first.id + '/authorize-replacement', servant, { reason: 'Wrong group' })).status, 403);
  const { id: replacement } = await ok<{ id: string }>(request('/admin/attempts/' + first.id + '/authorize-replacement', groupServant, { reason: 'Connectivity issue' }));
  assert.equal((await ok<Leaderboard['publication']>(request(publicPath))).boards[0].rows.length, 1);
  const retry = await ok<ResponseState>(request('/competitions/' + id + '/start', firstCookie, {}));
  assert.equal(retry.id, replacement);
  await ok(advance(retry.id, question.id, firstCookie, [items[1].id]));
  const deadline = await forceDeadline(retry.id);
  const startedAt = new Date(deadline.getTime() - 1_002);
  await db.attempt.update({ where: { id: retry.id }, data: { startedAt } });
  await db.attempt.update({ where: { id: future.id }, data: { startedAt, finishedAt: new Date(deadline.getTime() - 1) } });
  let finalRows = (await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows;
  assert.deepEqual(finalRows.map(({ rank, name }) => [rank, name]), [[1, next.fullName], [2, actor.fullName]]);
  await db.attempt.update({ where: { id: future.id }, data: { finishedAt: deadline } });
  finalRows = (await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows;
  assert.deepEqual(finalRows.map(row => row.rank), [1, 1]);
  await db.attempt.update({ where: { id: future.id }, data: { finishedAt: new Date(deadline.getTime() + 1000) } });
  finalRows = (await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows;
  assert.deepEqual(finalRows.map(({ rank, name }) => [rank, name]), [[1, actor.fullName], [2, next.fullName]]);
  await ok(request(path + '/close', groupServant, {}));
  assert.equal((await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows.length, 2);
  await ok(request(leaderboard + '/unpublish', groupServant, {}));
  assert.equal((await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows.length, 0);
  await ok(request(path + '/publish', groupServant, {}));
  assert.equal((await ok<Leaderboard['publication']>(request(groupOverall))).boards[0].rows.length, 2);
  await ok(request('/admin/leaderboards/all', groupServant, { published: false }, 'PUT'));
  assert.equal((await request(groupOverall)).status, 404);
});
