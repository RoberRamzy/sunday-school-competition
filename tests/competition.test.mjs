import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSession, api, browser, context, studentFixture, success} from './support.mjs';

test('fixed grade quiz resumes, saves through a theme change, and ranks only after publication', async () => {
  const engine = await browser();
  const admin = await adminSession(engine);
  const originalTheme = await (await success(await api(admin,'/appearance'))).json();
  try {
    const {student,grade,pin,activationCode} = await studentFixture(admin);
    const alice = await context(engine,{viewport:{width:390,height:844}});
    await success(await api(alice,'/auth/activate','POST',{gradeId:grade.id,studentId:student.id,pin,activationCode}));
    const create = async (route,data) => (await success(await api(admin,route,'POST',data))).json();
    const red = crypto.randomUUID();
    const blue = crypto.randomUUID();
    const question = await create('/admin/questions',{
      gradeId:grade.id,type:'MCQ',difficulty:'EASY',text:'Select blue.',points:2,
      items:[{id:red,text:'Red'},{id:blue,text:'Blue'}],correctOrder:[blue],sortingMode:'PARTIAL'
    });
    const title = 'QA competition '+crypto.randomUUID();
    const draft = await create('/admin/competitions',{
      title,instructions:'Select the matching answer.',opensAt:new Date(Date.now()-60_000).toISOString(),
      closesAt:new Date(Date.now()+600_000).toISOString(),durationMinutes:5,
      grades:[{gradeId:grade.id,questionIds:[question.id],blueprint:[{type:'MCQ',difficulty:'EASY',count:1}]}]
    });
    const competition = '/admin/competitions/'+draft.id;
    await create(competition+'/activate',{});
    const start = async()=> (await success(await api(alice,'/competitions/'+draft.id+'/start','POST',{}))).json();
    const [attempt,retry] = await Promise.all([start(),start()]);
    assert.equal(attempt.id,retry.id);
    assert.equal(attempt.expiresAt,retry.expiresAt);
    assert.deepEqual(attempt.question,retry.question);
    assert.ok(!('correctOrder' in attempt.question));

    const path='/attempts/'+attempt.id;
    const page=await alice.newPage();
    await page.goto('/');
    await page.getByText(title,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Continue attempt'}).click();
    await page.getByRole('heading',{name:'Select blue.'}).waitFor();
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
  } finally {
    await api(admin,'/admin/appearance','PUT',originalTheme);
    await engine.close();
  }
});
