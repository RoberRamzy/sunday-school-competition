import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

export const baseURL = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000';
export async function browser() {
  return chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, headless: true});
}
export async function context(browser, options = {}) {
  return browser.newContext({baseURL, ...options});
}
export async function api(session, path, method = 'GET', data) {
  return session.request.fetch('/api' + path, {method, data, headers: {Origin: baseURL}});
}
export async function success(response) {
  assert.ok(response.ok(), response.url() + ' returned ' + response.status());
  return response;
}
export async function adminSession(browser) {
  const session = await context(browser);
  const password = process.env.TEST_ADMIN_PASSWORD;
  assert.ok(password, 'Set TEST_ADMIN_PASSWORD to an administrator password in the isolated test database');
  await success(await api(session, '/auth/staff-login', 'POST', {username:process.env.TEST_ADMIN_USERNAME || 'admin',password}));
  return session;
}
export async function studentFixture(admin) {
  const [grade] = await (await success(await api(admin, '/admin/grades'))).json();
  const name = 'QA ' + crypto.randomUUID();
  await success(await api(admin, '/admin/students','POST',{gradeId:grade.id,fullName:name,displayLabel:name}));
  const roster = await (await success(await api(admin,'/admin/students?gradeId='+grade.id))).json();
  const student = roster.find(row=>row.displayLabel===name);
  assert.ok(student);
  const handout = await success(await api(admin,'/admin/grades/'+grade.id+'/activation-handout','POST',{studentIds:[student.id]}));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await handout.body());
  const row = book.worksheets[0].getRow(2);
  assert.equal(row.getCell(1).value,name);
  assert.equal(typeof row.getCell(2).value, 'string');
  return {grade, student, activationCode:row.getCell(2).value, pin:'012345'};
}
