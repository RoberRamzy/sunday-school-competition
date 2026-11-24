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
  assert.equal((await request(staff, admin, draft, 'PATCH')).status, 409);
  assert.equal((await request('/admin/questions/' + questions[0].id, admin, { points: 100 }, 'PATCH')).status, 404);
  const attempts = await Promise.all(students.map(({ cookie }) =>
    ok<ResponseState>(request(`/competitions/${id}/start`, cookie, {}))));
  for (const [index, attempt] of attempts.entries()) {
    const quiz = await db.attemptQuestion.findMany({ where: { attemptId: attempt.id }, select: { questionId: true } });
    assert.deepEqual(quiz.map(row => row.questionId).sort(), questions.map(q => q.id).sort());
    const resumed = await ok<ResponseState>(request(`/student/attempts/${attempt.id}`, students[index].cookie));
    assert.deepEqual(resumed.question, attempt.question);
  }
  await ok(request(boards, admin, { scopes: [gradeId], tiePolicy: 'SCORE_ONLY' }, 'PUT'));
  const early = await ok<Leaderboard>(request(boards, admin));
  assert.equal((await request(boards + '/publish', admin, { revision: early.revision })).status, 409);

  const points = [3, 2, 2, 1, 0, 3];
  for (const [index, attempt] of attempts.entries()) {
    const startedAt = new Date(Date.now() - 10000);
    const finishedAt = new Date(startedAt.getTime() + (index === 5 ? 1000 : 2000));
    await db.attempt.update({ where: { id: attempt.id }, data: {
      status: 'SUBMITTED', score: points[index], startedAt, finishedAt, submittedAt: finishedAt,
    } });
  }
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
