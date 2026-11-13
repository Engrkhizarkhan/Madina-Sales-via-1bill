import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto, X509Certificate } from 'node:crypto';
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';

const directory = await mkdtemp(join(tmpdir(), 'madina-terminal-security-'));
Object.assign(process.env, {
  RESTRICT_STAFF_DEVICES: 'true', ADMIN_TOTP_HEX: 'cd'.repeat(20),
  DB_NAME: 'terminal_security_qa', DB_USER: 'qa', DB_PASSWORD: 'unused-in-this-test',
  TERMINAL_ROLE: 'terminal', TERMINAL_DIRECTORY: directory,
  TERMINAL_RELAY_KEY: 'ab'.repeat(32), TERMINAL_LOCAL_ORIGIN: 'https://192.168.1.20:8443',
  TERMINAL_CLOUD_ORIGIN: 'https://example.invalid', TERMINAL_INSTALLATION_ID: 'security-test',
});
const { createTerminalCertificates, renewTerminalServerCertificate, signTerminalRequest, localTerminalGuard } = await import('../terminal/certificates.js');
const { terminalReady } = await import('../terminal/runtime.js');
const { pool } = await import('../node/db.js');
const { terminalDevice, sessionHash } = await import('../node/access.js');
let approvedFingerprint;
const originalExecute = pool.execute.bind(pool);
pool.execute = async (_sql, parameters) => [[...(parameters[0] === approvedFingerprint ? [{ slot: 2 }] : [])]];
let client;
const guard = request => new Promise(resolve => localTerminalGuard(request, {}, error => resolve(error)));
const request = ({ encrypted = false, remoteAddress = '127.0.0.1', relay, raw, header } = {}) => ({
  socket: { encrypted, remoteAddress, getPeerCertificate: () => ({ raw }) },
  get: name => ({ 'X-Madina-Relay-Key': relay, 'X-Madina-Client-Cert': header, 'X-Madina-Device': 'terminal-1' })[name],
});
test('certificate, relay and staff device boundaries', async t => {
  try {
    await createTerminalCertificates(join(directory, 'tls'), '192.168.1.20');
    const ca = new X509Certificate(await readFile(join(directory, 'tls/ca.crt')));
    const server = new X509Certificate(await readFile(join(directory, 'tls/server.crt')));
    await t.test('server certificate verifies against the private CA and embeds the chosen IP', () => {
      assert.ok(server.verify(ca.publicKey)); assert.equal(server.checkIP('192.168.1.20'), '192.168.1.20');
      assert.equal(server.checkIP('192.168.1.21'), undefined); assert.ok(ca.ca);
    });
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const csr = await x509.Pkcs10CertificateRequestGenerator.create({ name: 'CN=Counter PC', keys, signingAlgorithm: algorithm });
    client = await signTerminalRequest(csr.toString('pem'), 2);
    const certificate = new X509Certificate(client.pem);
    approvedFingerprint = client.fingerprint;
    await t.test('device certificate verifies and has client authentication use', () => {
      assert.ok(certificate.verify(ca.publicKey)); assert.ok(certificate.keyUsage.includes('1.3.6.1.5.5.7.3.2'));
    });
    await t.test('moving the server to another LAN preserves the CA and enrolled client certificate', async () => {
      const oldCa = await readFile(join(directory, 'tls/ca.crt'), 'utf8');
      await renewTerminalServerCertificate(join(directory, 'tls'), '192.168.7.42');
      const moved = new X509Certificate(await readFile(join(directory, 'tls/server.crt')));
      assert.equal(moved.checkIP('192.168.7.42'), '192.168.7.42');
      assert.equal(moved.checkIP('192.168.1.20'), undefined);
      assert.equal(await readFile(join(directory, 'tls/ca.crt'), 'utf8'), oldCa);
      assert.ok(moved.verify(ca.publicKey)); assert.ok(certificate.verify(ca.publicKey));
    });
    await t.test('malformed enrollment requests are rejected', async () => {
      await assert.rejects(signTerminalRequest('invalid CSR', 1), error => error.status === 422);
    });
    await t.test('plain LAN connections cannot impersonate the trusted relay', async () => {
      const error = await guard(request({ remoteAddress: '192.168.1.9', relay: process.env.TERMINAL_RELAY_KEY }));
      assert.equal(error.status, 403);
      assert.equal((await guard(request({ relay: 'wrong' }))).status, 403);
    });
    await t.test('direct HTTPS ignores forged forwarding and device headers', async () => {
      const req = request({ encrypted: true, header: encodeURIComponent(client.pem) });
      assert.equal(await guard(req), undefined); assert.equal(terminalDevice(req), '');
    });
    await t.test('direct TLS and authenticated loopback relay resolve the same pinned PC', async () => {
      const direct = request({ encrypted: true, raw: certificate.raw });
      const relayed = request({ relay: process.env.TERMINAL_RELAY_KEY, header: encodeURIComponent(client.pem) });
      assert.equal(await guard(direct), undefined); assert.equal(await guard(relayed), undefined);
      assert.equal(terminalDevice(direct), 'terminal-2:' + client.fingerprint);
      assert.equal(terminalDevice(relayed), terminalDevice(direct));
    });
    await t.test('staff sessions are bound to their certificate fingerprint', () => {
      assert.notEqual(sessionHash('cookie', 'counter', 'terminal-2:old'), sessionHash('cookie', 'counter', 'terminal-2:new'));
      assert.equal(sessionHash('cookie', 'admin', ''), sessionHash('cookie', 'admin', 'terminal-2:new'));
    });
    await t.test('revoking the pinned device prevents device access immediately', async () => {
      approvedFingerprint = undefined;
      const req = request({ encrypted: true, raw: certificate.raw });
      await guard(req); assert.equal(terminalDevice(req), '');
    });
    await t.test('invalid relay certificate is handled as a forbidden request', async () => {
      assert.equal((await guard(request({ relay: process.env.TERMINAL_RELAY_KEY, header: '%' }))).status, 403);
    });
    await t.test('first activation is required but readiness persists without internet', async () => {
      assert.equal(await terminalReady(), false);
      await writeFile(join(directory, 'ready.json'), JSON.stringify({ installationId: 'security-test' }));
      assert.equal(await terminalReady(), true);
      await writeFile(join(directory, 'ready.json'), JSON.stringify({ installationId: 'another-installation' }));
      assert.equal(await terminalReady(), false);
    });
    await t.test('a retired test main stays fenced even after a restart and without internet', async () => {
      await writeFile(join(directory,'ready.json'),JSON.stringify({installationId:'security-test'}));
      await writeFile(join(directory,'handover.json'),JSON.stringify({installationId:'security-test',nonce:'fixture',stage:'preparing'}));
      assert.equal(await terminalReady(),false);
      await writeFile(join(directory,'handover.json'),JSON.stringify({installationId:'security-test',nonce:'fixture',stage:'ready'}));
      const restarted=await import('../terminal/runtime.js?restart-fence-test');
      assert.equal(await restarted.terminalPaired(),true);assert.equal(await restarted.terminalReady(),false);
    });
  } finally {
    pool.execute = originalExecute;
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
