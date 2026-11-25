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
    const {student,grade,pin,activationCode} = await studentFixture(admin);
    fixtureStudentId = student.id;
    const fullName = 'Full name ' + student.displayLabel;
    await success(await api(admin, '/admin/students/' + student.id, 'PATCH', {fullName}));
    const alice = await context(engine,{viewport:{width:390,height:844}});
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
    await page.goto(studentLink);
    await page.getByRole('combobox').first().selectOption(grade.id);
    await page.getByRole('combobox').nth(1).selectOption(student.id);
    await page.locator('input[name=pin]').fill(pin);
    await page.locator('form').getByRole('button',{name:'Sign in'}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    await page.getByRole('button',{name:'Confirm and start'}).waitFor();
    const unopened = await (await success(await api(alice,'/student/competitions/'+draft.id))).json();
    assert.equal(unopened.attemptId,null);
    const start = async()=> (await success(await api(alice,'/competitions/'+draft.id+'/start','POST',{}))).json();
    const [attempt,retry] = await Promise.all([start(),start()]);
    assert.equal(attempt.id,retry.id);
    assert.equal(attempt.expiresAt,retry.expiresAt);
    assert.deepEqual(attempt.question,retry.question);
    assert.ok(!('correctOrder' in attempt.question));

    const path='/attempts/'+attempt.id;
    const seasonalAssets = [];
    page.on('request', request => {
      if (/\/art\/(?:christmas-sleigh\.webp|jingle-bells\.mp3)$/.test(request.url())) {
        seasonalAssets.push(request.url());
      }
    });
    await page.reload();
    await page.getByText(title,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Continue attempt'}).click();
    await page.getByRole('heading',{name:'Select blue.'}).waitFor();
    assert.equal(await page.locator('.christmas-scene').count(),0);
    assert.deepEqual(seasonalAssets,[]);
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
      await success(await api(admin,'/admin/appearance','PUT',{theme:originalTheme.theme==='classic'?'christmas':'classic'}));
    } finally {
      release();
    }
    await page.getByText('Answer saved.',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Select blue.'}).waitFor();
    const resumed=await (await success(await api(alice,'/student'+path))).json();
    assert.equal(resumed.expiresAt,attempt.expiresAt);
    assert.deepEqual(resumed.savedAnswer,[blue]);
    await page.reload();
    await page.getByRole('button',{name:'Continue attempt'}).click();
    assert.ok(await page.getByRole('radio',{name:'Blue'}).isChecked());
    await page.getByRole('button',{name:'Submit attempt',exact:true}).click();
    await page.getByRole('button',{name:'Confirm submission'}).click();
    await page.getByRole('heading',{name:'Submitted',exact:true}).waitFor();
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
