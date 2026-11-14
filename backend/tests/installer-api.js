import assert from 'node:assert/strict';
import {mock} from 'node:test';
import bcrypt from 'bcryptjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import * as processTools from '../terminal/process.js';
const directory=await mkdtemp(join(tmpdir(),'madina-installer-api-qa-'));
process.env.TERMINAL_ROLE='cloud';process.env.TERMINAL_DIRECTORY=join(directory,'state');process.env.TERMINAL_INSTALLER_DIRECTORY=join(directory,'downloads');process.env.CLOUD_SESSION_DIRECTORY=join(directory,'sessions');
process.env.TERMINAL_ACCEL_DOWNLOADS='false';process.env.SESSION_SECURE='false';process.env.RESTRICT_STAFF_DEVICES='false';process.env.ADMIN_TOTP_HEX='';process.env.ADMIN_TOTP_PAUSED='false';
await mkdir(process.env.TERMINAL_DIRECTORY);await writeFile(join(process.env.TERMINAL_DIRECTORY,'state.json'),JSON.stringify({phase:'awaiting-main'}));
const application=zipSync({'fixture.bin':randomBytes(2*1024*1024)},{level:0});await writeFile(join(process.env.TERMINAL_DIRECTORY,'base.zip'),application);
let prepared=0;
mock.module('../terminal/process.js',{namedExports:{...processTools,terminalControl:async action=>{assert.equal(action,'prepare');prepared++;return {installToken:'a'.repeat(64),knownHost:'62.171.173.11 ssh-ed25519 TEST-PUBLIC-KEY'};}}});
const {config}=await import('../node/config.js');
if(!/test|qa/i.test(config.db.database))throw new Error('Use an isolated QA database.');
const {pool}=await import('../node/db.js');const {app}=await import('../node/app.js');
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let cookie='',csrf='',passed=0,subId;
const check=(value,label)=>{assert.ok(value,label);passed++;console.log('PASS',label);};
async function request(path,{method='GET',body,auth=true,token=csrf,headers={}}={}){
 const response=await fetch(origin+path,{method,headers:{...(auth?{Cookie:cookie}:{}),...(token?{'X-CSRF-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const bytes=Buffer.from(await response.arrayBuffer());return {status:response.status,headers:response.headers,bytes,payload:response.headers.get('content-type')?.includes('json')?JSON.parse(bytes.toString()):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
try{
 const [[owner]]=await pool.query('SELECT * FROM users WHERE is_owner=1 LIMIT 1');const password='InstallerQA!2026Only';
 await pool.execute('UPDATE users SET password_hash=?,force_password_change=0 WHERE id=?',[await bcrypt.hash(password,4),owner.id]);
 const login=await request('/auth/login',{method:'POST',body:{identity:owner.username,password}});check(login.status===200,'cloud owner can sign in while main PC is absent');cookie=login.cookie;csrf=login.payload.csrfToken;
 const ownerCookie=cookie,ownerCsrf=csrf;
 check((await request('/terminal/package',{method:'POST',body:{currentPassword:password,delivery:'browser'},auth:false})).status===401,'installer preparation requires a signed-in owner');
 check((await request('/terminal/package',{method:'POST',body:{currentPassword:password,delivery:'browser'},token:'wrong'})).status===403,'installer preparation requires CSRF protection');
 check((await request('/terminal/package',{method:'POST',body:{currentPassword:'wrong',delivery:'browser'}})).status===422&&prepared===0,'incorrect passwords cannot prepare an installer or alter pairing');
 const grant=await request('/terminal/package',{method:'POST',body:{currentPassword:password,delivery:'browser'}});
 check(grant.status===200&&/^\/terminal\/installer-download\/[a-f0-9]{64}$/.test(grant.payload.downloadPath),'password-confirmed preparation returns a small native-download link');
 check(!JSON.stringify(grant.payload).includes('a'.repeat(64)),'installer authorization secrets are absent from the download URL/JSON');
 const path=grant.payload.downloadPath,full=await request(path);
 check(full.status===200&&Number(full.headers.get('content-length'))===full.bytes.length&&full.headers.get('content-disposition').includes('attachment'),'native GET returns a complete ZIP with its exact length and attachment name');
 const entries=unzipSync(full.bytes);check(Buffer.from(entries['application.zip']).equals(Buffer.from(application))&&!!entries['Install-Main-PC.cmd'],'downloaded installer contains the complete application and Windows setup');
 const range=await request(path,{headers:{Range:'bytes=100-199'}});
 check(range.status===206&&range.bytes.equals(full.bytes.subarray(100,200))&&range.headers.get('content-range')===`bytes 100-199/${full.bytes.length}`,'browser can resume with an authenticated byte-range request');
 const interrupted=await fetch(origin+path,{headers:{Cookie:cookie}}),reader=interrupted.body.getReader();const first=await reader.read();await reader.cancel();
 const offset=first.value.length,resumed=await request(path,{headers:{Range:`bytes=${offset}-`}});
 check(resumed.status===206&&Buffer.concat([Buffer.from(first.value),resumed.bytes]).equals(full.bytes),'interrupted transfer resumes to the exact original bytes without preparing another installer');
 check(prepared===1,'resume does not regenerate setup credentials');
 check((await request(path,{auth:false})).status===401,'anonymous clients cannot retrieve prepared installers');
 const secondLogin=await request('/auth/login',{method:'POST',auth:false,body:{identity:owner.username,password}});cookie=secondLogin.cookie;csrf=secondLogin.payload.csrfToken;
 check((await request(path)).status===403,'copying the URL to a different session is rejected, even for the same owner');
 cookie=ownerCookie;csrf=ownerCsrf;
 const username='installer-sub-'+randomBytes(4).toString('hex');const [sub]=await pool.execute("INSERT INTO users(name,username,password_hash,role,remote_allowed,is_owner,force_password_change) VALUES (?,?,?,'admin',1,0,0)",['Installer QA subadmin',username,await bcrypt.hash(password,4)]);subId=sub.insertId;
 const subLogin=await request('/auth/login',{method:'POST',auth:false,body:{identity:username,password}});cookie=subLogin.cookie;csrf=subLogin.payload.csrfToken;
 check((await request(path)).status===403,'sub-admin accounts cannot retrieve owner installers');cookie=ownerCookie;csrf=ownerCsrf;
 for(const phase of ['preparing','active']){
  await writeFile(join(process.env.TERMINAL_DIRECTORY,'state.json'),JSON.stringify({phase}));
  check((await request('/terminal/package',{method:'POST',body:{currentPassword:password,delivery:'browser'}})).status===409,'a '+phase+' main PC cannot be overwritten by another installer');
 }
 check((await request(path)).status===200,'an authorized download stays resumable when pairing becomes active');
 await writeFile(join(process.env.TERMINAL_DIRECTORY,'state.json'),JSON.stringify({phase:'awaiting-main'}));
 process.env.TERMINAL_ACCEL_DOWNLOADS='true';const accelerated=await request(path);
 check(accelerated.status===200&&accelerated.headers.get('x-accel-redirect')===`/_madina-installers/${path.split('/').at(-1)}.zip`&&accelerated.bytes.length===0,'production delegates the protected ZIP stream to nginx rather than the Node/browser fetch buffer');process.env.TERMINAL_ACCEL_DOWNLOADS='false';
 const id=path.split('/').at(-1),metadata=join(process.env.TERMINAL_INSTALLER_DIRECTORY,id+'.json');const value=JSON.parse(await readFile(metadata,'utf8'));value.expiresAt=Date.now()-1;await writeFile(metadata,JSON.stringify(value));
 check((await request(path)).status===410,'expired links require fresh password-confirmed preparation');
 const legacy=await request('/terminal/package',{method:'POST',body:{currentPassword:password}});
 check(legacy.status===200&&!!unzipSync(legacy.bytes)['Install-Main-PC.cmd'],'old open clients retain the previous ZIP response during rollout');
 console.log(`Installer API: ${passed} checks passed; ZIP ${full.bytes.length} bytes; SHA-256 ${createHash('sha256').update(full.bytes).digest('hex')}`);
}finally{
 server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
 if(subId){await pool.execute('DELETE FROM api_sessions WHERE user_id=?',[subId]);await pool.execute('DELETE FROM users WHERE id=?',[subId]);}
 await pool.end();await rm(directory,{recursive:true,force:true});mock.restoreAll();
}
