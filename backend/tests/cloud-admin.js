// Run as the deployment operator against disposable tables, never production rows.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
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
async function request(method, path, body, token = csrf) {
  const response = await fetch('http://127.0.0.1:43191' + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-CSRF-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
  await admin.query('INSERT INTO users (name, username, role, password_hash, force_password_change) VALUES (?,?,?,?,0)', ['QA admin', 'admin', 'admin', await bcrypt.hash(adminPassword, 4)]);
  await admin.query("INSERT INTO settings (setting_key, setting_value) VALUES ('finance_pin_hash',?)", [JSON.stringify(await bcrypt.hash(pin, 4))]);
  await admin.query("CREATE USER '" + dbUser + "'@'127.0.0.1' IDENTIFIED BY ?", [password]);
  await admin.query("GRANT SELECT ON `" + dbName + "`.* TO '" + dbUser + "'@'127.0.0.1'");
} catch (error) {
  // Setup errors use the same cleanup as the test body.
  output = error.message;
}
try {
  if (output) throw new Error(output);
  await mkdir(join(directory, 'state'));
  await writeFile(join(directory, 'state/state.json'), JSON.stringify({ phase: 'preparing' }));
  server = spawn(process.execPath, ['backend/node/server.js'], { env: { ...process.env, DB_NAME: dbName, DB_USER: dbUser, DB_PASSWORD: password, DB_HOST: '127.0.0.1', DB_PORT: '3306', TERMINAL_ROLE: 'cloud', TERMINAL_DIRECTORY: join(directory, 'state'), CLOUD_SESSION_DIRECTORY: join(directory, 'sessions'), ADMIN_TOTP_HEX: otpKey.toString('hex'), ADMIN_TOTP_PAUSED: 'false', RESTRICT_STAFF_DEVICES: 'true', NODE_API_HOST: '127.0.0.1', NODE_API_PORT: '43191', SESSION_SECURE: 'true', ALLOWED_ORIGINS: 'https://qa.invalid' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  let ready = false;
  for (let i = 0; i < 60; i++) { try { ready = (await request('GET', '/health')).status === 200; if (ready) break; } catch { /* startup */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'QA server startup: ' + output);
  assert.equal((await request('GET', '/admin/bootstrap')).status, 401);
  assert.equal((await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: 'invalid' })).status, 401);
  const login = await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: otp(-1) });
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
  const again = await request('POST', '/auth/login', { identity: 'admin', password: adminPassword, otp: otp() });
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
