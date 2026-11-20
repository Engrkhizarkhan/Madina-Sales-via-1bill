import 'reflect-metadata';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import https from 'node:https';
import http from 'node:http';
import { createHmac, randomBytes, webcrypto, X509Certificate } from 'node:crypto';
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
const {pakistanDate} = await import('../node/helpers.js');
const { createTerminalCertificates } = await import('../terminal/certificates.js');
const { app } = await import('../node/app.js');
const { startTerminalWeb } = await import('../terminal/web.js');
let server,relay,proxy;
const userIds = [];
const suffix = randomBytes(5).toString('hex');
const saleFixture={route:'seller-route-'+suffix,bus:'seller-bus-'+suffix,trip:'seller-trip-'+suffix};
const password = 'Terminal-QA!-' + suffix;
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; console.log('PASS', label); };
let ca;
const [[previousPrintSetting]]=await pool.execute("SELECT CAST(setting_value AS CHAR) setting_value FROM settings WHERE setting_key='terminal_print_preferences'");
const request = (path, { method = 'GET', body, cookie = '', csrf = '', device, extraHeaders = {}, viaProxy=false } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = https.request({ host: '127.0.0.1', servername: 'localhost', port: (viaProxy?proxy:server).address().port,
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
  // Reproduce the cloud TLS boundary: trust only its actual peer certificate,
  // overwrite client-supplied forwarding headers, then use the private relay.
  relay=http.createServer(app).listen(0,'127.0.0.1');
  await new Promise(resolve=>relay.once('listening',resolve));
  proxy=https.createServer({key:await readFile(join(directory,'tls/server.key')),cert:await readFile(join(directory,'tls/server.crt')),ca,requestCert:true,rejectUnauthorized:false,minVersion:'TLSv1.2'},(req,res)=>{
    const peer=req.socket.getPeerCertificate()?.raw;
    const forwarded=http.request({host:'127.0.0.1',port:relay.address().port,path:req.url.replace(/^\/api/,''),method:req.method,headers:{...req.headers,'X-Madina-Relay-Key':config.terminal.relayKey,'X-Madina-Client-Cert':peer?encodeURIComponent(new X509Certificate(peer).toString()):''}},upstream=>{
      res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);
    });
    forwarded.on('error',()=>{res.statusCode=502;res.end();});req.pipe(forwarded);
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>proxy.once('listening',resolve));
  for (const role of ['admin', 'counter']) {
    const [user] = await pool.execute('INSERT INTO users (name, username, password_hash, role, force_password_change,is_owner,remote_allowed) VALUES (?, ?, ?, ?, 0,?,?)',
      [role==='counter'?'Counter Agent Full Name':'Main Admin Full Name', 'enroll-' + role + '-' + suffix, await bcrypt.hash(password, 10), role, role === 'admin' ? 1 : 0, role === 'admin' ? 1 : 0]);
    userIds.push(user.insertId);
  }
  const otpCounter = Buffer.alloc(8); otpCounter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', config.adminOtpKey).update(otpCounter).digest();
  const otp = String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  const adminLogin = await request('/auth/login', { method: 'POST', body: { identity: 'enroll-admin-' + suffix, password, otp } });
  check(adminLogin.status === 200, 'main admin signs in over local HTTPS with authenticator');
  const admin = { cookie: adminLogin.cookie, csrf: adminLogin.payload.csrfToken };
  check((await request('/terminal/status', admin)).payload.mode === 'terminal', 'settings identifies the local main PC');
  check((await request('/internal-diagnostics/web',{...admin,extraHeaders:{'X-Madina-Diagnostic-Key':process.env.TERMINAL_RELAY_KEY}})).status===403,
    'even the admin browser cannot invoke the protected loopback operator self-check');
  const packageRequest = () => request('/terminal/devices/2/package', { ...admin, method: 'POST', body: { currentPassword: password } });
  const archive = await packageRequest();
  check(archive.status === 200, 'admin generates a protected child PC installer');
  const files = unzipSync(archive.bytes);
  const setup = JSON.parse(strFromU8(files['setup.json']));
  check(setup.allowSoftwareKey === false, 'TPM enrollment remains the default');
  check(setup.localOrigin === config.terminal.localOrigin && !files['ca.key'], 'child setup embeds the main IP and contains no CA private key');
  const keys = await deviceKey();
  const enroll = () => request('/terminal/enroll', { method: 'POST', body: { token: setup.token, slot: 2, request: keys.request } });
  check((await request('/terminal/enroll', { method: 'POST', body: { token: setup.token, slot: 2, request: keys.request, keyStorage: 'windows' } })).status === 403,
    'editing a setup file cannot approve software enrollment on the server');
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
  const heartbeat={instance:'1234567890abcdef1234567890abcdef',phase:'opening',version:'3.5.0',rttMs:16,downloadMbps:null,lossPct:0,probeOk:null,slot:99};
  check((await request('/terminal/presence/heartbeat',{method:'POST',body:heartbeat})).status===403,'unenrolled browsers cannot spoof PC contacts');
  check((await request('/terminal/presence/heartbeat',{method:'POST',body:heartbeat,device})).status===200,'an enrolled PC reports startup progress without requiring a staff session');
  const contacts=await request('/terminal/presence',admin);
  check(contacts.status===200&&contacts.payload.terminals.find(pc=>pc.slot===2)?.status==='opening'&&!contacts.payload.terminals.some(pc=>pc.slot===99),'admin sees the PC authenticated by its certificate, not a forged body slot');
  check((await request('/terminal/presence',{cookie:login.cookie,device})).status===403,'counter staff cannot inspect other terminal contacts');
  check((await request('/terminal/presence/probe',{device})).bytes.length===98304,'the PC probe transfers more than the 64 KB boundary that previously stalled');
  check((await request('/terminal/presence/heartbeat',{method:'POST',device,body:{...heartbeat,rttMs:-1}})).status===422,'invalid measurements cannot be stored');
  check((await request('/terminal/presence/heartbeat',{method:'POST',device,viaProxy:true,body:{...heartbeat,phase:'ready',probeOk:true,downloadMbps:8}})).status===200,'private online relay preserves the enrolled identity for connection reporting');
  check((await request('/terminal/presence',admin)).payload.terminals.find(pc=>pc.slot===2)?.transport==='online','admin can distinguish online fallback from the local network path');
  await Promise.all(Array.from({length:20},(_,index)=>request('/terminal/presence/heartbeat',{method:'POST',device,body:{...heartbeat,instance:index.toString(16).padStart(32,'0')}})));
  const [[bounded]]=await pool.execute('SELECT COUNT(*) n FROM terminal_presence WHERE slot=2');
  check(Number(bounded.n)<=16,'simultaneous browser tabs cannot grow connection storage beyond the per-PC bound');
  const onlineLogin=await request('/auth/login',{method:'POST',body:credentials,device,viaProxy:true});
  check(onlineLogin.status===200,'online fallback authenticates enrolled staff through actual client TLS and the private relay');
  check((await request('/auth/me',{cookie:onlineLogin.cookie,device,viaProxy:true})).status===200,'online fallback retains the same terminal-bound staff session');
  check((await request('/auth/login',{method:'POST',body:credentials,viaProxy:true,extraHeaders:{'X-Madina-Client-Cert':encodeURIComponent(enrolled.payload.certificate),'X-Madina-Device':'terminal-2','X-Madina-Relay-Key':config.terminal.relayKey}})).status===403,'forged cloud forwarding headers without a real enrolled client certificate cannot sign in');
  check((await request('/auth/me',{cookie:onlineLogin.cookie,viaProxy:true})).status===401,'copying an online staff session to an unenrolled browser does not authenticate');
  const date=pakistanDate(new Date(Date.now()+86400000));
  await pool.execute("INSERT INTO routes(id,origin,destination,distance,duration,fare,boarding_point,status) VALUES (?,'Peshawar','Test destination','','',500,'Terminal','Active')",[saleFixture.route]);
  await pool.execute("INSERT INTO buses(id,registration,service,seats,model,model_year,status,next_service) VALUES (?,?,'Standard Plus',49,'Seller test',2026,'Ready','Not scheduled')",[saleFixture.bus,'SELLER-'+suffix]);
  await pool.execute("INSERT INTO trips(id,route_id,bus_id,departure,arrival,driver,attendant,platform,status,service_days,active) VALUES (?,?,?,'23:00','23:59','','','','Scheduled',?,1)",[saleFixture.trip,saleFixture.route,saleFixture.bus,JSON.stringify(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])]);
  const staff={cookie:login.cookie,csrf:login.payload.csrfToken,device};
  check((await request('/settings/printing',staff)).payload.terminals===undefined,'staff cannot view settings for other PCs');
  check((await request('/settings/printing',{...staff,method:'PUT',body:{terminals:[]}})).status===403,'staff cannot edit centrally managed printing');
  const printPrefs=[{slot:2,managed:true,autoPrint:true,preview:false}];
  check((await request('/settings/printing',{...admin,method:'PUT',body:{terminals:printPrefs}})).status===200,'owner saves independent print switches for PC 2');
  const ownPrinting=(await request('/settings/printing',{...staff,extraHeaders:{'X-Madina-Device':'terminal-99'}})).payload.own;
  check(ownPrinting.slot===2&&ownPrinting.managed&&ownPrinting.autoPrint&&!ownPrinting.preview,'PC policy follows the real enrolled certificate, ignoring forged headers');
  check((await request('/settings/printing',{...admin,method:'PUT',body:{terminals:[{...printPrefs[0],slot:99}]}})).status===422,'print settings cannot target a nonexistent PC');
  const draft={tripId:saleFixture.trip,date,passenger:'Seller tracking passenger',phone:'03001234567',cnic:'17301-1234567-1',gender:'Male',paymentMethod:'Cash',seats:[1],issuedBy:'Forged name',soldByUserId:userIds[0],soldTerminalSlot:99,soldFrom:'Terminal 99'};
  const sold=await request('/bookings',{...staff,method:'POST',body:draft,extraHeaders:{'X-Madina-Device':'terminal-99'}});
  check(sold.payload.printing?.slot===2&&sold.payload.printing.autoPrint&&!sold.payload.printing.preview,'sale returns the current centrally managed print decision');
  check(sold.status===201&&sold.payload.booking.issuedBy==='Counter Agent Full Name'&&sold.payload.booking.soldByUserId===userIds[1]&&sold.payload.booking.soldTerminalSlot===2&&sold.payload.booking.soldFrom==='Terminal 2','sale saves the authenticated full name and real TLS terminal, ignoring forged fields');
  const held=await request('/bookings',{...admin,method:'POST',body:{...draft,seats:[2,3],bookingStatus:'Reserved'}});
  check(held.status===201&&held.payload.bookings.every(b=>b.soldByUserId===null&&b.soldTerminalSlot===null&&b.soldFrom===null),'reservation creator is not recorded as the seller');
  const ids=held.payload.bookings.map(b=>b.id);
  const collected=await request(`/bookings/${ids[0]}/reservations/confirm`,{...staff,method:'POST',body:{...draft,ids}});
  check(collected.status===200&&collected.payload.bookings.every(b=>b.issuedBy==='Counter Agent Full Name'&&b.soldByUserId===userIds[1]&&b.soldTerminalSlot===2),'group collection records the collector on every individual ticket');
  const [creators]=await pool.query('SELECT created_by,sold_by_user_id FROM bookings WHERE id IN (?,?)',ids);
  check(creators.every(b=>Number(b.created_by)===userIds[0]&&Number(b.sold_by_user_id)===userIds[1]),'reservation maker and actual payment collector remain independently traceable');
  const edited=await request('/bookings/'+sold.payload.booking.id,{...staff,method:'PUT',body:{...sold.payload.booking,passenger:'Edited passenger',issuedBy:'Forged editor',soldByUserId:userIds[0],soldTerminalSlot:99,soldFrom:'Terminal 99'}});
  check(edited.status===200&&edited.payload.booking.issuedBy==='Counter Agent Full Name'&&edited.payload.booking.soldTerminalSlot===2,'passenger editing cannot rewrite the seller or selling PC');
  const refunded=await request('/bookings/'+sold.payload.booking.id+'/refunds',{...staff,method:'POST',body:{amount:500,method:'Cash',reason:'Passenger request'}});
  check(refunded.status===201&&refunded.payload.booking.soldByUserId===userIds[1]&&refunded.payload.booking.soldTerminalSlot===2,'refund preserves the original selling account and terminal');
  await pool.execute("UPDATE users SET name='Renamed counter account' WHERE id=?",[userIds[1]]);
  const refreshed=await request('/admin/bootstrap',staff);
  check(refreshed.payload.bookings.find(b=>b.id===ids[0]).issuedBy==='Counter Agent Full Name','reprint data retains the full name from the original sale after an account rename');
  await pool.execute("UPDATE users SET name='Counter Agent Full Name' WHERE id=?",[userIds[1]]);
  const mainSale=await request('/bookings',{...admin,method:'POST',body:{...draft,seats:[5]}});
  check(mainSale.status===201&&mainSale.payload.booking.issuedBy==='Main Admin Full Name'&&mainSale.payload.booking.soldTerminalSlot===null&&mainSale.payload.booking.soldFrom==='Main PC','unenrolled local main-PC admin access does not invent a numbered terminal');
  await pool.execute("UPDATE bookings SET sold_by_user_id=NULL,sold_terminal_slot=NULL,sold_from=NULL,issued_by='Original historical seller' WHERE id=?",[ids[0]]);
  const migration=await readFile(new URL('../database/migrations/016_ticket_seller.sql',import.meta.url),'utf8');
  const connection=await pool.getConnection();
  try{for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);}finally{connection.release();}
  const [[historical]]=await pool.query('SELECT * FROM bookings WHERE id=?',[ids[0]]);
  check(Number(historical.sold_by_user_id)===userIds[1]&&historical.issued_by==='Original historical seller'&&historical.sold_terminal_slot===null&&historical.sold_from===null,'historical migration recovers the payment actor from the ledger without inventing a PC or changing the name snapshot');
  const launcher=await request('/terminal/counter-launcher',{cookie:login.cookie,device});
  check(launcher.status===200,'enrolled staff can download Counter and A4 setup without a server error');
  const launcherFiles=unzipSync(launcher.bytes),launcherSetup=JSON.parse(strFromU8(launcherFiles['setup.json']));
  check(['Setup-Counter-Shortcut.ps1','Setup-Counter-Shortcut.cmd','Open-A4-Report.ps1'].every(name=>launcherFiles[name]?.length>0),'printing setup contains the Counter shortcut and A4 launcher');
  check(launcherSetup.localOrigin===config.terminal.localOrigin&&/^[a-f0-9]{64}$/.test(launcherSetup.terminalFingerprint),'download uses the local server and the requesting enrolled PC identity');
  check((await request('/terminal/counter-launcher')).status===401,'printing setup download requires authentication');
  check((await request('/auth/me', { cookie: login.cookie })).status === 401, 'copied staff cookie is rejected on another PC');
  check((await request('/terminal/devices/1/package', { cookie: login.cookie, csrf: login.payload.csrfToken, device, method: 'POST', body: { currentPassword: password } })).status === 403,
    'staff cannot generate device enrollment packages');
  check((await request('/terminal/devices/2', { ...admin, method: 'DELETE', body:{currentPassword:password,confirm:true} })).status === 200, 'admin revokes a terminal PC');
  check((await request('/auth/me', { cookie: login.cookie, device })).status === 401, 'revoked terminal loses its existing session immediately');
  check((await request('/terminal/presence/heartbeat',{method:'POST',body:heartbeat,device})).status===403,'revoked PC can no longer send connection contacts');
  const compatible = await request('/terminal/devices/2/package', { ...admin, method: 'POST', body: { currentPassword: password, allowSoftwareKey: true } });
  const compatibleFiles = unzipSync(compatible.bytes);
  const compatibleSetup = JSON.parse(strFromU8(compatibleFiles['setup.json']));
  check(compatibleSetup.allowSoftwareKey === true, 'main admin explicitly approves a compatible Windows key');
  const compatibleEnrollment = await request('/terminal/enroll', { method: 'POST', body: { token: compatibleSetup.token, slot: 2, request: keys.request, keyStorage: 'windows' } });
  check(compatibleEnrollment.status === 200, 'approved compatible enrollment signs a device certificate');
  const compatibleDevice = {key:keys.key,cert:compatibleEnrollment.payload.certificate};
  const compatibleLogin = await request('/auth/login', {method:'POST',body:credentials,device:compatibleDevice});
  check(compatibleLogin.status === 200, 'approved Windows-key device can sign in');
  check((await request('/auth/me', {cookie:compatibleLogin.cookie})).status === 401, 'compatible device session still fails without its TLS key');
  const access = await request('/users/terminal-access', admin);
  check(access.payload.terminals.find(device=>device.slot===2)?.keyStorage === 'windows', 'admin sees compatible device enrollment');
  await request('/terminal/devices/2', {...admin,method:'DELETE',body:{currentPassword:password,confirm:true}});
  check((await request('/auth/me', {cookie:compatibleLogin.cookie,device:compatibleDevice})).status === 401, 'revoking a compatible device immediately ends access');
  const second = unzipSync((await packageRequest()).bytes);
  const expiredSetup = JSON.parse(strFromU8(second['setup.json']));
  await pool.execute('UPDATE terminal_enrollments SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE slot = 2');
  check((await request('/terminal/enroll', { method: 'POST', body: { slot: 2, token: expiredSetup.token, request: keys.request } })).status === 409,
    'expired enrollment packages are rejected');
  check((await request('/terminal/connection', { ...admin })).payload.local === true, 'counter connection status is available without disclosing credentials');
  check((await request('/terminal/devices/2', {...admin,method:'DELETE'})).status === 422,'revocation requires re-entering administrator password');
  check((await request('/terminal/devices/2', {...admin,method:'DELETE',body:{currentPassword:password}})).status === 422,'revocation requires explicit confirmation');
  const added = await request('/terminal/devices',{...admin,method:'POST',body:{currentPassword:password}});
  check(added.status===201 && added.payload.slot===4,'owner can add PC 4 without changing existing enrollment');
  const pc4 = await request('/terminal/devices/4/package',{...admin,method:'POST',body:{currentPassword:password,allowSoftwareKey:true}});
  check(pc4.status===200,'PC 4 setup download is supported');
  const pc4Files=unzipSync(pc4.bytes),pc4Setup=JSON.parse(strFromU8(pc4Files['setup.json']));
  check(Boolean(pc4Files['Setup-Counter-Shortcut.ps1']),'enrollment includes existing-browser shortcut setup');
  const enrolled4=await request('/terminal/enroll',{method:'POST',body:{slot:4,token:pc4Setup.token,request:keys.request,keyStorage:'windows'}});
  check(enrolled4.status===200,'PC 4 enrolls with its approved key');
  await pool.execute('UPDATE users SET terminal_slots=? WHERE id=?',[JSON.stringify([4]),userIds[1]]);
  const device4={key:keys.key,cert:enrolled4.payload.certificate};
  const login4=await request('/auth/login',{method:'POST',body:credentials,device:device4});
  check(login4.status===200,'staff assigned to PC 4 can sign in there');
  const sale4=await request('/bookings',{method:'POST',cookie:login4.cookie,csrf:login4.payload.csrfToken,device:device4,body:{...draft,seats:[4]}});
  check(sale4.status===201&&sale4.payload.booking.soldByUserId===userIds[1]&&sale4.payload.booking.soldTerminalSlot===4,'the same account selling on another enrolled PC records that PC separately');
  check((await request('/auth/login',{method:'POST',body:credentials,device:compatibleDevice})).status===403,'PC 4 staff cannot use a different enrolled PC');
  check((await request('/terminal/devices/99/package',{...admin,method:'POST',body:{currentPassword:password}})).status===404,'PC must be added before setup can be generated');
  console.log(`Passed ${passed} terminal enrollment checks.`);
} finally {
  if(previousPrintSetting)await pool.execute("UPDATE settings SET setting_value=? WHERE setting_key='terminal_print_preferences'",[previousPrintSetting.setting_value]);
  else await pool.execute("DELETE FROM settings WHERE setting_key='terminal_print_preferences'");
  await pool.execute("DELETE FROM terminal_presence WHERE slot=2").catch(()=>{});
  if(proxy)await new Promise(resolve=>proxy.close(resolve));
  if(relay)await new Promise(resolve=>relay.close(resolve));
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.execute('DELETE f FROM financial_transactions f JOIN bookings b ON b.id=f.booking_id WHERE b.trip_id=?',[saleFixture.trip]);
  await pool.execute('DELETE r FROM refunds r JOIN bookings b ON b.id=r.booking_id WHERE b.trip_id=?',[saleFixture.trip]);
  await pool.execute('DELETE s FROM booking_seats s JOIN bookings b ON b.id=s.booking_id WHERE b.trip_id=?',[saleFixture.trip]);
  await pool.execute('DELETE FROM bookings WHERE trip_id=?',[saleFixture.trip]);
  await pool.execute('DELETE FROM trip_runs WHERE trip_id=?',[saleFixture.trip]);
  await pool.execute('DELETE FROM trips WHERE id=?',[saleFixture.trip]);
  await pool.execute('DELETE FROM buses WHERE id=?',[saleFixture.bus]);
  await pool.execute('DELETE FROM routes WHERE id=?',[saleFixture.route]);
  await pool.execute('DELETE FROM terminal_enrollments WHERE slot IN (2,4)');
  await pool.execute('DELETE FROM terminal_devices WHERE slot IN (2,4)');
  await pool.execute('DELETE FROM terminal_slots WHERE slot=4');
  for (const id of userIds) {
    await pool.execute('DELETE FROM audit_logs WHERE user_id = ?', [id]);
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.end();
  await rm(directory, { recursive: true, force: true });
}
