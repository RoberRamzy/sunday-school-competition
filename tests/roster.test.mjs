import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {adminSession, browser} from './support.mjs';

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
  } finally {
    await engine.close();
  }
});
