import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSession, api, browser, context, success} from './support.mjs';

test('super admin previews and saves the site theme; guests receive it on first render in either language', async () => {
  const engine = await browser();
  const staff = await adminSession(engine);
  const original = await (await success(await api(staff,'/appearance'))).json();
  try {
    const admin = await staff.newPage();
    await admin.goto('/staff');
    await admin.getByRole('button',{name:'Appearance',exact:true}).click();
    for (const theme of ['christmas','classic']) {
      const current = await (await success(await api(staff,'/appearance'))).json();
      if (current.theme !== theme) {
        await admin.locator('input[value="'+theme+'"]').check();
        const saved = admin.waitForResponse(r=>r.url().endsWith('/api/admin/appearance'));
        await admin.getByRole('button',{name:'Save theme'}).click();
        assert.ok((await saved).ok());
      }
      for (const width of [390,1280]) {
        const guest = await context(engine,{viewport:{width,height:844}});
        const page = await guest.newPage();
        const first = await page.goto('/');
        assert.match(await first.text(),new RegExp('data-theme="'+theme+'"'));
        await page.getByRole('combobox').first().waitFor();
        await page.getByRole('button',{name:'العربية'}).click();
        assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
        await page.reload();
        await page.getByRole('button',{name:'English'}).waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'),'ar');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth));
        assert.equal((await api(guest,'/admin/appearance','PUT',{theme:'classic'})).status(),401);
        await guest.close();
      }
    }
  } finally {
    await api(staff,'/admin/appearance','PUT',original);
    await engine.close();
  }
});
