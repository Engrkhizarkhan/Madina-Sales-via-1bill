// Run as the deployment operator against disposable tables, never production rows.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const schema = process.env.TEST_SCHEMA_DATABASE;
assert.match(schema || '', /^[a-zA-Z0-9_]+$/, 'Set TEST_SCHEMA_DATABASE to a schema-only source');
const dbName = 'madina_cloud_qa_' + randomBytes(5).toString('hex');
const dbUser = 'cloud_qa_' + randomBytes(5).toString('hex');
const password = randomBytes(24).toString('hex');
const admin = await mysql.createConnection({ socketPath: process.env.TEST_ADMIN_SOCKET || '/var/run/mysqld/mysqld.sock', user: 'root', multipleStatements: true });
const directory = await mkdtemp(join(tmpdir(), 'madina-cloud-auth-'));
const otpKey = randomBytes(20), adminPassword = 'Qa!StrongPassword2026', pin = '983741';
let server, output = '', cookie = '', csrf;
function otp(stepOffset = 0) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + stepOffset));
  const digest = createHmac('sha1', otpKey).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function request(method, path, body, token = csrf, extraHeaders = {}) {
  const response = await fetch('http://127.0.0.1:43191' + path, { method, headers: { Cookie: cookie, ...extraHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-CSRF-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  return { status: response.status, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
try {
  await admin.query('CREATE DATABASE `' + dbName + '`');
  const [tables] = await admin.query('SHOW TABLES FROM `' + schema + '`');
  await admin.query('USE `' + dbName + '`; SET FOREIGN_KEY_CHECKS=0');
  for (const row of tables) {
    const table = Object.values(row)[0]; assert.match(table, /^[a-zA-Z0-9_]+$/);
    const [[definition]] = await admin.query('SHOW CREATE TABLE `' + schema + '`.`' + table + '`');
    await admin.query(definition['Create Table']);
  }
  await admin.query('SET FOREIGN_KEY_CHECKS=1');
  await admin.query(await readFile('backend/database/migrations/012_account_access.sql','utf8'));
  await admin.query('INSERT INTO users (name, username, role, password_hash, force_password_change,is_owner,remote_allowed) VALUES (?,?,?,?,0,1,1)', ['QA admin', 'admin', 'admin', await bcrypt.hash(adminPassword, 4)]);
  await admin.query("INSERT INTO settings (setting_key, setting_value) VALUES ('finance_pin_hash',?)", [JSON.stringify(await bcrypt.hash(pin, 4))]);
  await admin.query("CREATE USER '" + dbUser + "'@'127.0.0.1' IDENTIFIED BY ?", [password]);
  await admin.query("GRANT SELECT,INSERT,UPDATE,DELETE ON `" + dbName + "`.* TO '" + dbUser + "'@'127.0.0.1'");
} catch (error) {
  // Setup errors use the same cleanup as the test body.
  output = error.message;
}
try {
  if (output) throw new Error(output);
  await mkdir(join(directory, 'state'));
  await writeFile(join(directory, 'state/state.json'), JSON.stringify({ phase: 'standalone' }));
  server = spawn(process.execPath, ['backend/node/server.js'], { env: { ...process.env, DB_NAME: dbName, DB_USER: dbUser, DB_PASSWORD: password, DB_HOST: '127.0.0.1', DB_PORT: '3306', TERMINAL_ROLE: 'cloud', TERMINAL_DIRECTORY: join(directory, 'state'), CLOUD_SESSION_DIRECTORY: join(directory, 'sessions'), ADMIN_TOTP_HEX: otpKey.toString('hex'), ADMIN_TOTP_PAUSED: 'false', RESTRICT_STAFF_DEVICES: 'true', NODE_API_HOST: '127.0.0.1', NODE_API_PORT: '43191', SESSION_SECURE: 'true', PUBLIC_SITE_ENABLED:'true', ALLOWED_ORIGINS: 'https://qa.invalid,https://public.example.invalid,http://127.0.0.1:43191' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  let ready = false;
  for (let i = 0; i < 60; i++) { try { ready = (await request('GET', '/health')).status === 200; if (ready) break; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'QA server startup: ' + output);
  const firstLogin=await request('POST','/auth/login',{identity:'admin',password:adminPassword,otp:otp(-1)});
  assert.equal(firstLogin.status,200,JSON.stringify(firstLogin.payload));
  cookie=firstLogin.cookie;csrf=firstLogin.payload.csrfToken;
  const ownerCookie=cookie,ownerCsrf=csrf;
  assert.equal((await request('GET','/auth/me',undefined,undefined,{Origin:'https://public.example.invalid'})).status,403);
  assert.equal((await request('GET','/auth/me',undefined,undefined,{Origin:'http://127.0.0.1:43191'})).status,200);

  const staffPassword='StaffAccess!2026Only';
  const staff=await request('POST','/users',{name:'Counter operator',username:'counter-two',role:'counter',password:staffPassword,terminals:[2],remoteAllowed:false});
  assert.equal(staff.status,201,JSON.stringify(staff.payload));
  cookie='';csrf=undefined;
  assert.equal((await request('POST','/auth/login',{identity:'counter-two',password:staffPassword})).status,403);
  assert.equal((await request('POST','/auth/login',{identity:'counter-two',password:staffPassword},undefined,{'X-Madina-Device':'terminal-1'})).status,403);
  const counterLogin=await request('POST','/auth/login',{identity:'counter-two',password:staffPassword},undefined,{'X-Madina-Device':'terminal-2'});
  assert.equal(counterLogin.status,200,JSON.stringify(counterLogin.payload));
  cookie=counterLogin.cookie;csrf=counterLogin.payload.csrfToken;
  assert.equal((await request('GET','/auth/me',undefined,undefined,{'X-Madina-Device':'terminal-1'})).status,401);
  cookie=ownerCookie;csrf=ownerCsrf;
  const sub=await request('POST','/users',{name:'Remote sub-admin',username:'remote-admin',email:'remote@example.invalid',role:'admin',password:staffPassword,remoteAllowed:true,terminals:[]});
  assert.equal(sub.status,201,JSON.stringify(sub.payload));
  cookie='';csrf=undefined;
  const subLogin=await request('POST','/auth/login',{identity:'remote@example.invalid',password:staffPassword});
  assert.equal(subLogin.status,200,JSON.stringify(subLogin.payload));cookie=subLogin.cookie;csrf=subLogin.payload.csrfToken;
  assert.equal((await request('POST','/users',{name:'Escalation',username:'bad-user',role:'admin',password:staffPassword})).status,403);
  assert.equal((await request('PUT','/settings/policies',{staffCanRefund:false})).status,403);
  cookie=ownerCookie;csrf=ownerCsrf;
  const enabled=await request('POST',`/users/${sub.payload.user.id}/authenticator`,{enabled:true});
  assert.equal(enabled.status,200);assert.ok(enabled.payload.setup.secret);
  cookie='';csrf=undefined;
  assert.equal((await request('POST','/auth/login',{identity:'remote-admin',password:staffPassword})).status,401);
  const secret=enabled.payload.setup.secret;let bits=0,number=0;const bytes=[];
  for(const char of secret){number=(number<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;if(bits>=8){bits-=8;bytes.push((number>>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
  const subOtp=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
  const secured=await request('POST','/auth/login',{identity:'remote-admin',password:staffPassword,otp:subOtp});
  assert.equal(secured.status,200,JSON.stringify(secured.payload));
  const subCookie=secured.cookie,subCsrf=secured.payload.csrfToken;
  cookie=ownerCookie;csrf=ownerCsrf;
  assert.equal((await request('POST',`/users/${sub.payload.user.id}/revoke`,{})).status,200);
  cookie=subCookie;csrf=subCsrf;assert.equal((await request('GET','/auth/me')).status,401);
  cookie=ownerCookie;csrf=ownerCsrf;
  assert.equal((await request('PUT','/settings/policies',{publicReservationsEnabled:false,publicExpiryHours:3,staffMaxRefundPercent:50})).status,200);
  assert.equal((await request('POST','/public/bookings',{passenger:'Test',phone:'03001112222'})).status,409);
  assert.equal((await request('GET','/settings/policies')).payload.policies.publicExpiryHours,3);
  assert.equal((await request('PUT','/settings/policies',{})).status,200);
  assert.equal((await request('DELETE',`/users/${sub.payload.user.id}`)).status,200);
  assert.equal((await request('DELETE',`/users/${firstLogin.payload.user.id}`)).status,403);
  await admin.query('DELETE FROM api_sessions');
  await admin.query("REVOKE INSERT,UPDATE,DELETE ON `"+dbName+"`.* FROM '"+dbUser+"'@'127.0.0.1'");
  await writeFile(join(directory,'state/state.json'),JSON.stringify({phase:'preparing'}));
  cookie='';csrf=undefined;
  console.log('PASS terminal-specific staff access, approved remote email login, sub-admin limits, optional MFA, session revocation and editable reservation policies');
  assert.equal((await request('GET', '/admin/bootstrap')).status, 401);
  assert.equal((await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: 'invalid' })).status, 401);
  const login = await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: otp() });
  assert.equal(login.status, 200, JSON.stringify(login.payload)); cookie = login.cookie; csrf = login.payload.csrfToken;
  assert.equal((await request('GET', '/auth/me')).payload.user.username, 'admin');
  assert.equal((await request('GET', '/admin/bootstrap')).payload.readOnly, true);
  assert.equal((await request('POST', '/bookings', {})).status, 503);
  assert.equal((await request('POST', '/auth/finance-unlock', { pin }, 'wrong')).status, 403);
  assert.equal((await request('POST', '/auth/finance-unlock', { pin })).status, 200);
  assert.equal((await request('GET', '/finance/status')).payload.unlocked, true);
  const [[sqlSessions]] = await admin.query('SELECT COUNT(*) total FROM api_sessions'); assert.equal(sqlSessions.total, 0);
  for (const name of await readdir(join(directory, 'sessions'))) assert.equal((await stat(join(directory, 'sessions', name))).mode & 0o777, 0o600);
  console.log('PASS password + MFA login, bootstrap, finance PIN and mutation guard with SELECT-only database access during setup');
  await writeFile(join(directory, 'state/state.json'), JSON.stringify({ phase: 'active' }));
  assert.equal((await request('GET', '/admin/bootstrap')).payload.readOnly, true);
  assert.equal((await request('POST', '/auth/logout', {})).status, 200);
  assert.equal((await request('GET', '/auth/me')).status, 401);
  const again = await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: otp(1) });
  assert.equal(again.status, 200); cookie = again.cookie; csrf = again.payload.csrfToken;
  await admin.query("UPDATE users SET password_hash = 'changed' WHERE username='admin'");
  assert.equal((await request('GET', '/auth/me')).status, 401);
  console.log('PASS offline-active access, logout revocation, and immediate invalidation after a password change');
} finally {
  if (server) { const ended = new Promise(resolve => server.once('exit', resolve)); server.kill(); await ended; }
  await admin.query('DROP DATABASE IF EXISTS `' + dbName + '`');
  await admin.query("DROP USER IF EXISTS '" + dbUser + "'@'127.0.0.1'");
  await admin.end(); await rm(directory, { recursive: true, force: true });
}
