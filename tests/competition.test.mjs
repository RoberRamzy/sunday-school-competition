import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSession, api, browser, context, studentFixture, success} from './support.mjs';

test('fixed grade quiz resumes, saves through a theme change, and ranks only after publication', async () => {
  const engine = await browser();
  const admin = await adminSession(engine);
  const originalTheme = await (await success(await api(admin,'/appearance'))).json();
  let fixtureStudentId;
  let fixtureCompetition;
  let overallPublished = false;
  try {
    await success(await api(admin,'/admin/appearance','PUT',{theme:'christmas'}));
    const {student,grade,pin,activationCode} = await studentFixture(admin);
    fixtureStudentId = student.id;
    const fullName = 'Full name ' + student.displayLabel;
    await success(await api(admin, '/admin/students/' + student.id, 'PATCH', {fullName}));
    const alice = await context(engine,{viewport:{width:390,height:844}});
    await alice.addInitScript(() => {
      const BrowserAudio = window.Audio;
      window.Audio = function (...args) {
        const player = new BrowserAudio(...args);
        const play = player.play.bind(player);
        player.play = () => window.seasonalPlaybackAllowed ? play() : Promise.reject(new DOMException('Blocked','NotAllowedError'));
        window.seasonalAudio = player;
        return player;
      };
      document.addEventListener('pointerdown', event => {
        if (event.target instanceof Element && event.target.closest('[data-needs-play="true"]')) window.seasonalPlaybackAllowed = true;
      });
    });
    await success(await api(alice,'/auth/activate','POST',{gradeId:grade.id,studentId:student.id,pin,activationCode}));
    await success(await api(alice,'/auth/logout','POST',{}));
    const create = async (route,data) => (await success(await api(admin,route,'POST',data))).json();
    const title = 'QA competition '+crypto.randomUUID();
    const staffPage = await admin.newPage();
    await staffPage.goto('/staff');
    await staffPage.getByRole('button',{name:'Competitions',exact:true}).click();
    await staffPage.getByRole('button',{name:'Create competition'}).click();
    await staffPage.getByLabel('Title',{exact:true}).fill(title);
    const localTime = offset => {
      const date = new Date(Date.now() + offset);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    };
    await staffPage.getByLabel('Opening time').fill(localTime(-60000));
    await staffPage.getByLabel('Closing time').fill(localTime(600000));
    await staffPage.getByRole('checkbox',{name:grade.name,exact:true}).check();
    await staffPage.getByRole('button',{name:'Add question',exact:true}).click();
    await staffPage.getByLabel('Question text').fill('Select blue.');
    await staffPage.getByLabel('Points',{exact:true}).fill('2');
    await staffPage.getByLabel('Answer item 1').fill('Red');
    await staffPage.getByLabel('Answer item 2').fill('Blue');
    await staffPage.getByLabel('Choice 2 is correct').check();
    await staffPage.getByRole('button',{name:'Save question'}).click();
    const created = staffPage.waitForResponse(response => response.url().endsWith('/api/admin/competitions') && response.request().method()==='POST');
    await staffPage.getByRole('button',{name:'Save draft'}).click();
    const draft = await (await success(await created)).json();
    const competition = '/admin/competitions/'+draft.id;
    fixtureCompetition = competition;
    const blue = draft.questions[0].correctOrder[0];
    await create(competition+'/activate',{});
    await staffPage.reload();
    await staffPage.getByRole('button',{name:'Competitions',exact:true}).click();
    await staffPage.getByRole('article').filter({hasText:title}).getByRole('button',{name:'Open competition'}).click();
    const studentLink = await staffPage.getByRole('link',{name:'Student competition link'}).getAttribute('href');
    const page = await alice.newPage();
    const enableMusic = async () => {
      await page.getByRole('button',{name:'Music Tap to play',exact:true}).click();
      await page.waitForFunction(() => window.seasonalAudio && !window.seasonalAudio.paused && window.seasonalAudio.currentTime > 0);
    };
    const verifyQuietQuiz = async () => {
      await page.waitForFunction(() => window.seasonalAudio.paused && document.querySelector('.christmas-scene')?.dataset.running === 'false');
      assert.equal(await page.locator('.christmas-scene').getAttribute('data-animation'),'off');
      assert.equal(await page.getByRole('button',{name:'Music',exact:true}).count(),0);
    };
    await page.goto(studentLink);
    await page.getByRole('combobox').first().selectOption(grade.id);
    await page.getByRole('combobox').nth(1).selectOption(student.id);
    await page.locator('input[name=pin]').fill(pin);
    await page.locator('form').getByRole('button',{name:'Sign in'}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    await page.getByRole('button',{name:'Confirm and start'}).waitFor();
    const unopened = await (await success(await api(alice,'/student/competitions/'+draft.id))).json();
    assert.equal(unopened.attemptId,null);
    await enableMusic();
    await page.getByRole('button',{name:'Confirm and start'}).click();
    await page.getByRole('heading',{name:'Select blue.'}).waitFor();
    await verifyQuietQuiz();
    const start = async()=> (await success(await api(alice,'/competitions/'+draft.id+'/start','POST',{}))).json();
    const [attempt,retry] = await Promise.all([start(),start()]);
    assert.equal(attempt.id,retry.id);
    assert.equal(attempt.expiresAt,retry.expiresAt);
    assert.deepEqual(attempt.question,retry.question);
    assert.ok(!('correctOrder' in attempt.question));

    const path='/attempts/'+attempt.id;
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let intercepted;
    const sent = new Promise(resolve => { intercepted = resolve; });
    await page.route('**/api'+path+'/answers',async route=>{
      intercepted();
      await hold;
      await route.continue();
    },{times:1});
    await page.getByRole('radio',{name:'Blue'}).check();
    await sent;
    try {
      await success(await api(admin,'/admin/appearance','PUT',{theme:'classic'}));
    } finally {
      release();
    }
    await page.getByText('Answer saved.',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Select blue.'}).waitFor();
    const resumed=await (await success(await api(alice,'/student'+path))).json();
    assert.equal(resumed.expiresAt,attempt.expiresAt);
    assert.deepEqual(resumed.savedAnswer,[blue]);
    await verifyQuietQuiz();
    await success(await api(admin,'/admin/appearance','PUT',{theme:'christmas'}));
    await page.reload();
    await enableMusic();
    await page.getByRole('button',{name:'Continue attempt'}).click();
    await verifyQuietQuiz();
    const pausedAt = await page.evaluate(() => {
      window.pausedSeasonalAudio = window.seasonalAudio;
      return window.seasonalAudio.currentTime;
    });
    assert.ok(await page.getByRole('radio',{name:'Blue'}).isChecked());
    await page.getByRole('button',{name:'Submit attempt',exact:true}).click();
    await page.getByRole('button',{name:'Confirm submission'}).click();
    await page.getByRole('heading',{name:'Submitted',exact:true}).waitFor();
    await page.waitForFunction(time => window.seasonalAudio === window.pausedSeasonalAudio &&
      !window.seasonalAudio.paused && window.seasonalAudio.currentTime > time, pausedAt);
    const before=await (await success(await api(alice,'/student/competitions/'+draft.id))).json();
    assert.equal(before.result,null);
    await create(competition+'/close',{});
    await create(competition+'/publish',{});
    const after=await (await success(await api(alice,'/student/competitions/'+draft.id))).json();
    assert.deepEqual(after.result,{score:2,maxScore:2,rank:1});
    await staffPage.reload();
    await staffPage.getByRole('button',{name:'Competitions',exact:true}).click();
    await staffPage.getByRole('article').filter({hasText:title}).getByRole('button',{name:'Open competition'}).click();
    await staffPage.getByRole('button',{name:'Leaderboards',exact:true}).click();
    await staffPage.getByRole('checkbox',{name:'Publish Overall'}).check();
    await staffPage.getByRole('button',{name:'Save leaderboard settings'}).click();
    await staffPage.getByRole('button',{name:'Publish leaderboard',exact:true}).click();
    const publicLink = staffPage.getByRole('link',{name:'Open public leaderboard'});
    await publicLink.waitFor();
    const visitor = await context(engine,{viewport:{width:390,height:844}});
    const publicPage = await visitor.newPage();
    const publicPath = await publicLink.getAttribute('href');
    await publicPage.goto(publicPath);
    await publicPage.getByRole('heading',{name:title}).waitFor();
    const publicTable = publicPage.getByRole('table');
    await publicTable.getByRole('columnheader',{name:'Full name',exact:true}).waitFor();
    await publicTable.getByRole('cell',{name:fullName,exact:true}).waitFor();
    assert.equal(await publicTable.getByRole('cell',{name:student.displayLabel,exact:true}).count(),0);
    await page.reload();
    await page.getByRole('link',{name:'Competition leaderboard',exact:true}).waitFor();
    await staffPage.getByRole('button',{name:'Unpublish leaderboard'}).click();
    await publicLink.waitFor({state:'hidden'});
    await publicPage.reload();
    await publicPage.getByText('This leaderboard is unavailable.').waitFor();
    const overallPath = '/leaderboards/all';
    assert.equal((await api(visitor,overallPath)).status(),404);
    await staffPage.getByRole('button',{name:'Overall leaderboard',exact:true}).click();
    await staffPage.getByRole('cell',{name:fullName,exact:true}).waitFor();
    overallPublished = true;
    await staffPage.getByRole('button',{name:'Publish overall leaderboard',exact:true}).click();
    await staffPage.getByRole('link',{name:'Open public leaderboard'}).waitFor();
    await publicPage.goto(overallPath);
    await publicPage.getByRole('heading',{name:'Across-competition leaderboard'}).waitFor();
    await publicPage.getByRole('cell',{name:fullName,exact:true}).waitFor();
    await staffPage.getByRole('button',{name:'Unpublish overall leaderboard',exact:true}).click();
    await staffPage.getByText('Leaderboard unpublished.',{exact:true}).waitFor();
    assert.equal((await api(visitor,overallPath)).status(),404);
    overallPublished = false;
    await staffPage.getByRole('button',{name:'Competitions',exact:true}).click();
    await staffPage.getByRole('article').filter({hasText:title}).getByRole('button',{name:'Open competition'}).click();
    await staffPage.getByRole('button',{name:'Delete competition',exact:true}).click();
    const prompt = staffPage.getByRole('dialog',{name:'Delete competition'});
    assert.equal(await prompt.getByRole('button',{name:'Delete permanently'}).isEnabled(),false);
    await prompt.getByRole('button',{name:'Cancel'}).click();
    await staffPage.getByRole('button',{name:'Delete competition',exact:true}).click();
    await prompt.getByLabel('Type DELETE to confirm').fill('DELETE');
    await prompt.getByRole('button',{name:'Delete permanently'}).click();
    await staffPage.getByText('Competition deleted.',{exact:true}).waitFor();
    assert.equal((await api(alice,'/student/competitions/'+draft.id)).status(),404);
    fixtureCompetition = undefined;

  } finally {
    try {
      if (overallPublished) await api(admin,'/admin/leaderboards/all','PUT',{published:false});
      if (fixtureCompetition) {
        await api(admin,fixtureCompetition+'/leaderboard/unpublish','POST',{});
        await api(admin,fixtureCompetition+'/close','POST',{});
        await api(admin,fixtureCompetition+'/archive','POST',{});
      }
      if (fixtureStudentId) await api(admin,'/admin/students/'+fixtureStudentId,'PATCH',{status:'SUSPENDED'});
      await api(admin,'/admin/appearance','PUT',originalTheme);
    } finally {
      await engine.close();
    }
  }
});

test('group workspace, Arabic entry, and signed-out live standings follow the same competition', async () => {
  const engine = await browser();
  try {
    const admin = await adminSession(engine);
    const staffPage = await admin.newPage();
    await staffPage.goto('/staff');
    await staffPage.getByRole('button', { name: 'Competition groups', exact: true }).click();
    const groupName = 'QA group ' + crypto.randomUUID();
    await staffPage.getByLabel('Group name').fill(groupName);
    await staffPage.getByRole('button', { name: 'Create group', exact: true }).click();
    await staffPage.waitForURL(url => url.pathname === '/staff' && url.searchParams.has('group'));
    const group = { id: new URL(staffPage.url()).searchParams.get('group') };
    assert.equal(await staffPage.getByLabel('Current group').locator('option:checked').innerText(), groupName);
    await staffPage.getByRole('button', { name: 'Competition groups', exact: true }).click();
    assert.equal(await staffPage.getByRole('link', { name: 'Open student link' }).getAttribute('href'), '/groups/' + group.id);

    const groupApi = (path, method, data) => admin.request.fetch('/api' + path, {
      method, data, headers: { Origin: new URL(staffPage.url()).origin, 'x-competition-group': group.id },
    });
    const createGrade = async name => (await success(await groupApi('/admin/grades', 'POST', { name }))).json();
    const fourth = await createGrade('Grade 4');
    await createGrade('Grade 5');
    const student = await (await success(await groupApi('/admin/students', 'POST', {
      gradeId: fourth.id, fullName: 'QA Grade Four Student', displayLabel: 'QA Grade Four Student',
    }))).json();
    const handout = await success(await groupApi('/admin/grades/' + fourth.id + '/activation-handout', 'POST', { studentIds: [student.id] }));
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await handout.body());
    const activationCode = workbook.worksheets[0].getRow(2).getCell(2).value;
    const title = 'QA group competition';
    const items = ['Correct choice', 'Other choice'].map(text => ({ id: crypto.randomUUID(), text }));
    const question = {
      id: crypto.randomUUID(), type: 'MCQ', difficulty: 'EASY', text: 'Group quiz question', points: 2,
      items, correctOrder: [items[0].id], sortingMode: 'PARTIAL',
    };
    const closesAt = new Date(Date.now() + 600000).toISOString();
    const { id } = await (await success(await groupApi('/admin/competitions', 'POST', {
      title, instructions: '', opensAt: new Date(Date.now() - 60000).toISOString(), closesAt,
      durationMinutes: 5, gradeIds: [fourth.id], questions: [question],
    }))).json();
    const competitionPath = '/admin/competitions/' + id;
    const boardAdmin = competitionPath + '/leaderboard';
    await success(await groupApi(competitionPath + '/activate', 'POST', {}));

    await staffPage.getByRole('button', { name: 'Competitions', exact: true }).click();
    await staffPage.getByRole('article').filter({ hasText: title }).getByRole('button', { name: 'Open competition' }).click();
    await staffPage.getByRole('button', { name: 'Edit competition', exact: true }).click();
    await staffPage.getByRole('checkbox', { name: 'Attempt timer' }).uncheck();
    await staffPage.getByRole('button', { name: 'Save competition' }).click();
    await staffPage.getByRole('button', { name: 'Leaderboards', exact: true }).click();
    await staffPage.getByRole('checkbox', { name: 'Publish Overall', exact: true }).check();
    await staffPage.getByRole('button', { name: 'Save leaderboard settings' }).click();
    await staffPage.getByRole('button', { name: 'Publish leaderboard', exact: true }).click();
    await staffPage.getByRole('link', { name: 'Open public leaderboard' }).waitFor();

    const visitor = await context(engine, { viewport: { width: 390, height: 815 } });
    const landing = await visitor.newPage();
    await landing.goto('/');
    await landing.getByRole('option', { name: 'Grade 1', exact: true }).waitFor({ state: 'attached' });
    assert.equal(await landing.getByRole('option', { name: 'Grade 4', exact: true }).count(), 0);
    await visitor.addCookies([{ url: new URL(staffPage.url()).origin, name: 'sunday-school-language', value: 'ar' }]);
    await landing.goto('/competitions/' + id);
    await landing.getByRole('option', { name: 'Grade 4', exact: true }).waitFor({ state: 'attached' });
    await landing.getByRole('option', { name: 'Grade 5', exact: true }).waitFor({ state: 'attached' });
    assert.equal(await landing.getByRole('option', { name: 'Grade 1', exact: true }).count(), 0);
    assert.equal(await landing.locator('.site').getAttribute('dir'), 'rtl');

    await success(await api(visitor, '/auth/activate', 'POST', { groupId: group.id, gradeId: fourth.id, studentId: student.id, pin: '012345', activationCode }));
    await landing.reload();
    await landing.getByRole('link', { name: 'لوحة ترتيب المسابقة' }).waitFor();
    await landing.getByRole('button', { name: 'تأكيد وبدء' }).click();
    await landing.getByRole('heading', { name: question.text, exact: true }).waitFor();
    assert.equal(await landing.getByLabel('الوقت المتبقي').count(), 0);
    assert.match(await landing.locator('.quiz-clock').innerText(), /تنتهي/);

    const publicSession = await context(engine);
    const board = await publicSession.newPage();
    await board.goto('/leaderboards/' + id);
    await board.getByText('Provisional', { exact: true }).waitFor();
    await board.getByText('No completed attempts yet.', { exact: true }).waitFor();
    const attempt = (await (await success(await api(visitor, '/student/competitions/' + id))).json()).attemptId;
    await success(await api(visitor, '/attempts/' + attempt + '/answers', 'POST', { questionId: question.id, itemIds: [items[0].id], advance: true, revision: 1 }));
    await success(await api(visitor, '/attempts/' + attempt + '/submit', 'POST', {}));
    await board.getByText(student.fullName, { exact: true }).waitFor({ timeout: 20000 });

    await staffPage.getByRole('button', { name: 'Edit competition', exact: true }).click();
    await staffPage.getByText(question.text, { exact: true }).click();
    await staffPage.getByRole('radio', { name: items[1].text }).check();
    await staffPage.getByRole('button', { name: 'Save competition', exact: true }).click();
    await staffPage.getByText(/rescore 1 completed attempts/).waitFor();
    await staffPage.getByRole('button', { name: 'Confirm and rescore', exact: true }).click();
    await staffPage.getByRole('button', { name: 'Edit competition', exact: true }).waitFor();
    const corrected = await (await success(await api(publicSession, '/leaderboards/' + id))).json();
    assert.equal(corrected.boards[0].rows[0].score, 0);

    await success(await groupApi('/admin/leaderboards/all', 'PUT', { published: true }));
    await board.goto('/leaderboards/all/' + group.id);
    await board.getByText(student.fullName, { exact: true }).waitFor();
    assert.equal(await board.getByRole('link', { name: 'Back to the competition site' }).getAttribute('href'), '/groups/' + group.id);
    await success(await groupApi(boardAdmin + '/unpublish', 'POST', {}));
    await board.getByText('No completed attempts yet.', { exact: true }).waitFor({ timeout: 20000 });
  } finally {
    await engine.close();
  }
});
