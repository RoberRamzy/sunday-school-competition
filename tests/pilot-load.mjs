import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000';
const count = Number(process.env.PILOT_STUDENTS ?? 30);
assert.ok(process.env.PILOT_DISPOSABLE_DB === 'yes', 'Use a freshly seeded disposable database');
assert.ok(Number.isInteger(count) && count >= 1 && count <= 150);
assert.ok(process.env.TEST_ADMIN_PASSWORD, 'Set TEST_ADMIN_PASSWORD');

function client() {
  let cookie = '';
  return async function request(path, data) {
    const response = await fetch(origin + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json'},
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(response.ok, path + ' returned ' + response.status);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';', 1)[0];
    if (response.headers.get('content-type')?.includes('spreadsheetml')) return Buffer.from(await response.arrayBuffer());
    return response.json();
  };
}

async function burst(label, operations) {
  const durations = [];
  const results = await Promise.all(operations.map(async operation => {
    const start = performance.now();
    const result = await operation();
    durations.push(performance.now() - start);
    return result;
  }));
  durations.sort((a, b) => a - b);
  const p95 = Math.round(durations[Math.ceil(durations.length * 0.95) - 1]);
  const max = Math.round(durations.at(-1));
  console.log(JSON.stringify({phase: label, requests: results.length, p95Ms: p95, maxMs: max}));
  return results;
}

const admin = client();
await admin('/auth/staff-login', {username: process.env.TEST_ADMIN_USERNAME ?? 'admin', password: process.env.TEST_ADMIN_PASSWORD});
const [grade] = await admin('/admin/grades');
const prefix = 'Pilot ' + crypto.randomUUID();
await admin('/admin/students/import', {
  gradeId: grade.id,
  students: Array.from({length: count}, (_, i) => {
    const name = prefix + ' ' + String(i + 1).padStart(3, '0');
    return {fullName: name, displayLabel: name};
  }),
  dryRun: false,
});
const students = (await admin('/admin/students?gradeId=' + grade.id)).filter(row => row.displayLabel.startsWith(prefix));
assert.equal(students.length, count);
const book = new ExcelJS.Workbook();
await book.xlsx.load(await admin('/admin/grades/' + grade.id + '/activation-handout', {studentIds: students.map(row => row.id)}));
const codes = new Map();
book.worksheets[0].eachRow((row, index) => {
  if (index > 1) codes.set(row.getCell(1).value, row.getCell(2).value);
});

const correct = crypto.randomUUID();
const question = {
  id: crypto.randomUUID(), type: 'MCQ', difficulty: 'EASY', text: 'Pick blue.', points: 2,
  items: [{id: correct, text: 'Blue'}, {id: crypto.randomUUID(), text: 'Red'}],
  correctOrder: [correct], sortingMode: 'PARTIAL',
};
const now = Date.now();
const competition = await admin('/admin/competitions', {
  title: prefix, instructions: 'Choose an answer.',
  opensAt: new Date(now - 1000).toISOString(), closesAt: new Date(now + 300000).toISOString(), durationMinutes: 3,
  gradeIds: [grade.id], questions: [question],
});
const staffPath = '/admin/competitions/' + competition.id;
await admin(staffPath + '/activate', {});
const learners = students.map(student => ({student, request: client()}));
await burst('activate', learners.map(({student, request}) => () => request('/auth/activate', {
  gradeId: grade.id, studentId: student.id, activationCode: codes.get(student.displayLabel), pin: '045612',
})));
const starts = await burst('start', learners.map(({request}) => () => request('/competitions/' + competition.id + '/start', {})));
assert.equal(new Set(starts.map(({id}) => id)).size, count);
const attemptPaths = starts.map(({id}) => '/attempts/' + id);
await burst('save', learners.map(({request}, index) => () => request(attemptPaths[index] + '/answers', {
  questionId: starts[index].question.id, itemIds: [correct], advance: false, revision: 1,
})));
const resumed = await burst('resume', learners.map(({request}, index) => () => request('/student' + attemptPaths[index])));
for (const [index, attempt] of resumed.entries()) {
  assert.equal(attempt.expiresAt, starts[index].expiresAt);
  assert.deepEqual(attempt.savedAnswer, [correct]);
}
await burst('submit', learners.map(({request}, index) => () => request(attemptPaths[index] + '/submit', {})));
await admin(staffPath + '/close', {});
await admin(staffPath + '/publish', {});
const results = await admin(staffPath + '/results');
assert.equal(results.counts.completed, count);
assert.equal(results.students.filter(row => row.score === 2 && row.rank >= 1).length, count);
console.log('Verified ' + count + ' preserved answers, deadlines, and published scores.');
