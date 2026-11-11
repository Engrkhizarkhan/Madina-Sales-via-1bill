import 'reflect-metadata';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import https from 'node:https';
import { createHmac, randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';
import { unzipSync, strFromU8 } from 'fflate';
const directory = await mkdtemp(join(tmpdir(), 'madina-enrollment-qa-'));
Object.assign(process.env, {
  TERMINAL_ROLE: 'terminal', TERMINAL_DIRECTORY: directory, TERMINAL_HTTPS_PORT: '0',
  TERMINAL_RELAY_KEY: randomBytes(32).toString('hex'), TERMINAL_LOCAL_ORIGIN: 'https://192.168.1.20:8443',
  TERMINAL_CLOUD_ORIGIN: 'https://example.invalid', TERMINAL_INSTALLATION_ID: 'enrollment-test',
  ADMIN_TOTP_HEX: randomBytes(20).toString('hex'), ADMIN_TOTP_PAUSED: 'false',
  RESTRICT_STAFF_DEVICES: 'true', SESSION_SECURE: 'true',
});
const { config } = await import('../node/config.js');
if (!/test|qa/i.test(config.db.database)) throw new Error('Use an isolated test database.');
const { pool } = await import('../node/db.js');
const { createTerminalCertificates } = await import('../terminal/certificates.js');
const { app } = await import('../node/app.js');
const { startTerminalWeb } = await import('../terminal/web.js');
let server;
const userIds = [];
const suffix = randomBytes(5).toString('hex');
const password = 'Terminal-QA!-' + suffix;
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; console.log('PASS', label); };
let ca;
const request = (path, { method = 'GET', body, cookie = '', csrf = '', device, extraHeaders = {} } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = https.request({ host: '127.0.0.1', servername: 'localhost', port: server.address().port,
    path: '/api' + path, method, agent: false, ca, ...device,
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...extraHeaders },
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const bytes = Buffer.concat(chunks);
      let payload; try { payload = JSON.parse(bytes); } catch { payload = {}; }
      resolve({ status: res.statusCode, payload, bytes, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] || '' });
    });
  });
  req.on('error', reject); req.end(data);
});
async function deviceKey() {
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({ name: 'CN=QA Terminal', keys, signingAlgorithm: algorithm });
  const binary = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const key = '-----BEGIN PRIVATE KEY-----\n' + binary.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----';
  return { request: csr.toString('pem'), key };
}
try {
  await createTerminalCertificates(join(directory, 'tls'), '192.168.1.20');
  await writeFile(join(directory, 'ready.json'), JSON.stringify({ installationId: 'enrollment-test' }));
  ca = await readFile(join(directory, 'tls/ca.crt'));
  server = await startTerminalWeb(app);
  for (const role of ['admin', 'counter']) {
    const [user] = await pool.execute('INSERT INTO users (name, username, password_hash, role, force_password_change) VALUES (?, ?, ?, ?, 0)',
      ['Enrollment QA', 'enroll-' + role + '-' + suffix, await bcrypt.hash(password, 10), role]);
    userIds.push(user.insertId);
  }
  const otpCounter = Buffer.alloc(8); otpCounter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', config.adminOtpKey).update(otpCounter).digest();
  const otp = String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  const adminLogin = await request('/auth/login', { method: 'POST', body: { identity: 'enroll-admin-' + suffix, password, otp } });
  check(adminLogin.status === 200, 'main admin signs in over local HTTPS with authenticator');
  const admin = { cookie: adminLogin.cookie, csrf: adminLogin.payload.csrfToken };
  check((await request('/terminal/status', admin)).payload.mode === 'terminal', 'settings identifies the local main PC');
  const packageRequest = () => request('/terminal/devices/2/package', { ...admin, method: 'POST', body: { currentPassword: password } });
  const archive = await packageRequest();
  check(archive.status === 200, 'admin generates a protected child PC installer');
  const files = unzipSync(archive.bytes);
  const setup = JSON.parse(strFromU8(files['setup.json']));
  check(setup.localOrigin === config.terminal.localOrigin && !files['ca.key'], 'child setup embeds the main IP and contains no CA private key');
  const keys = await deviceKey();
  const enroll = () => request('/terminal/enroll', { method: 'POST', body: { token: setup.token, slot: 2, request: keys.request } });
  const enrolled = await enroll();
  check(enrolled.status === 200 && enrolled.payload.certificate, 'one-use enrollment signs a device certificate');
  check((await enroll()).status === 409, 'used enrollment token cannot enroll another device');
  const credentials = { identity: 'enroll-counter-' + suffix, password };
  check((await request('/auth/login', { method: 'POST', body: credentials,
    extraHeaders: { 'X-Madina-Device': 'terminal-2', 'X-Madina-Client-Cert': encodeURIComponent(enrolled.payload.certificate) } })).status === 403,
    'staff credentials and forged headers cannot bypass actual client TLS');
  const device = { key: keys.key, cert: enrolled.payload.certificate };
  const login = await request('/auth/login', { method: 'POST', body: credentials, device });
  check(login.status === 200, 'staff signs in with the enrolled TLS device');
  check((await request('/auth/me', { cookie: login.cookie, device })).status === 200, 'approved staff session stays valid');
  check((await request('/auth/me', { cookie: login.cookie })).status === 401, 'copied staff cookie is rejected on another PC');
  check((await request('/terminal/devices/1/package', { cookie: login.cookie, csrf: login.payload.csrfToken, device, method: 'POST', body: { currentPassword: password } })).status === 403,
    'staff cannot generate device enrollment packages');
  check((await request('/terminal/devices/2', { ...admin, method: 'DELETE' })).status === 200, 'admin revokes a terminal PC');
  check((await request('/auth/me', { cookie: login.cookie, device })).status === 401, 'revoked terminal loses its existing session immediately');
  const second = unzipSync((await packageRequest()).bytes);
  const expiredSetup = JSON.parse(strFromU8(second['setup.json']));
  await pool.execute('UPDATE terminal_enrollments SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE slot = 2');
  check((await request('/terminal/enroll', { method: 'POST', body: { slot: 2, token: expiredSetup.token, request: keys.request } })).status === 409,
    'expired enrollment packages are rejected');
  check((await request('/terminal/connection', { ...admin })).payload.local === true, 'counter connection status is available without disclosing credentials');
  console.log(`Passed ${passed} terminal enrollment checks.`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.execute('DELETE FROM terminal_enrollments WHERE slot = 2');
  await pool.execute('DELETE FROM terminal_devices WHERE slot = 2');
  for (const id of userIds) {
    await pool.execute('DELETE FROM audit_logs WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.end();
  await rm(directory, { recursive: true, force: true });
}
