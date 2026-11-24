import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {adminSession, api, browser, success} from './support.mjs';

test('staff previews a CSV, imports the roster and downloads an Excel activation handout', async () => {
  const engine=await browser();
  try {
    const staff = await adminSession(engine);
    const page=await staff.newPage();
    const name='QA roster '+crypto.randomUUID();
    await page.goto('/staff');
    await page.getByRole('button',{name:'Import roster',exact:true}).click();
    await page.getByLabel('Roster file').setInputFiles({
      name:'roster.csv',mimeType:'text/csv',buffer:Buffer.from('fullName,displayLabel\n'+name+','+name+'\n')
    });
    await page.getByRole('button',{name:'Validate and preview'}).click();
    await page.getByRole('region',{name:'Roster preview'}).getByText(name,{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Import students'}).click();
    await page.getByRole('checkbox',{name:'Select '+name,exact:true}).check();
    await page.getByRole('button',{name:'Activation handout'}).click();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download XLSX'}).click();
    const file=await download;
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await file.path());
    const sheet=workbook.worksheets[0];
    assert.equal(sheet.getCell('A2').value,name);
    assert.equal(typeof sheet.getCell('B2').value,'string');
    await file.delete();
    await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'Delete student'}).click();
    const confirmation = page.getByRole('dialog',{name:'Delete student'});
    await confirmation.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirmation.getByRole('button',{name:'Delete permanently'}).click();
    await page.getByText('Student deleted.',{exact:true}).waitFor();
    await page.getByRole('row').filter({hasText:name}).waitFor({state:'hidden'});
  } finally {
    await engine.close();
  }
});

test('super admin can delete a staff account from the staff dashboard', async () => {
  const engine = await browser();
  try {
    const staff = await adminSession(engine);
    const username = 'qa-' + crypto.randomUUID();
    const name = 'QA Staff ' + username;
    await success(await api(staff, '/admin/servants', 'POST', {
      fullName: name, username, password: crypto.randomUUID(), gradeIds: [],
    }));
    const page = await staff.newPage();
    await page.goto('/staff');
    await page.getByRole('button', {name:'Staff and grades'}).click();
    const accounts = page.getByRole('region', {name:'Staff accounts'});
    const row = accounts.getByRole('row').filter({hasText:name});
    await row.getByRole('button', {name:'Delete staff account'}).click();
    const dialog = page.getByRole('dialog', {name:'Delete staff account'});
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', {name:'Delete permanently'}).click();
    await page.getByText('Staff account deleted.', {exact:true}).waitFor();
    await row.waitFor({state:'hidden'});
  } finally {
    await engine.close();
  }
});
