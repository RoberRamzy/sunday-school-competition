import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSession, api, browser, context, studentFixture, success} from './support.mjs';

test('Excel handout → first activation → fresh-browser PIN login → session replacement and logout', async () => {
  const engine = await browser();
  try {
    const staff = await adminSession(engine);
    const {grade,student,activationCode,pin} = await studentFixture(staff);
    const first = await context(engine);
    const page = await first.newPage();
    await page.goto('/');
    await page.getByRole('button',{name:'First time?'}).click();
    await page.getByRole('combobox').nth(0).selectOption(grade.id);
    await page.getByRole('combobox').nth(1).selectOption(student.id);
    await page.getByLabel('One-time password',{exact:true}).fill(activationCode);
    const pinField = page.getByLabel('Choose a 6-digit PIN',{exact:true});
    await pinField.fill('123');
    await pinField.press('Tab');
    await page.getByText('Enter exactly six digits.',{exact:true}).waitFor();
    await page.getByLabel('Choose a 6-digit PIN',{exact:true}).fill(pin);
    const confirmation = page.getByLabel('Confirm PIN',{exact:true});
    await confirmation.fill('123456');
    await confirmation.press('Tab');
    await page.getByText('The two entries don’t match.',{exact:true}).waitFor();
    await confirmation.fill(pin);
    const activated = page.waitForResponse(resp=>resp.url().endsWith('/api/auth/activate'));
    await page.getByRole('button',{name:'Activate account'}).click();
    assert.ok((await activated).ok());
    await page.reload();
    assert.equal((await (await success(await api(first,'/auth/me'))).json()).id,student.id);
    const second = await context(engine,{viewport:{width:390,height:844}});
    const mobile = await second.newPage();
    await mobile.goto('/');
    await mobile.getByRole('combobox').first().selectOption(grade.id);
    await mobile.getByRole('combobox').nth(1).selectOption(student.id);
    await mobile.locator('input[name=pin]').fill(pin);
    const login = mobile.waitForResponse(resp=>resp.url().endsWith('/api/auth/login'));
    await mobile.locator('form').getByRole('button',{name:'Sign in'}).click();
    assert.ok((await login).ok());
    assert.equal((await api(first,'/auth/me')).status(),401);
    assert.equal((await (await success(await api(second,'/auth/me'))).json()).id,student.id);
    assert.equal((await api(second,'/admin/appearance','PUT',{theme:'christmas'})).status(),403);
    await success(await api(second,'/auth/logout','POST',{}));
    assert.equal((await api(second,'/auth/me')).status(),401);
    assert.equal((await api(first,'/auth/activate','POST',{gradeId:grade.id,studentId:student.id,activationCode,pin})).status(),401);
  } finally {
    await engine.close();
  }
});
