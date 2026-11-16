import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {unzipSync} from 'fflate';
import {fetchBounded,verifyRelease,verifyPackage,maxPackageBytes} from '../../deploy/updater/release.mjs';

test('actual bridge extracts the complete signed production base on the installed platform',{skip:!process.env.DOMAIN_BRIDGE_BASE,timeout:300000},async()=>{
 const baseId=process.env.DOMAIN_BRIDGE_BASE;
 assert.match(baseId,/^r-[a-f0-9]{12,40}$/);
 let result=spawnSync(process.execPath,['scripts/write-build-info.mjs'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const keys=generateKeyPairSync('ed25519');
 result=spawnSync(process.execPath,['scripts/package-domain-bridge.mjs'],{env:{...process.env,RELEASE_SIGNING_KEY_BASE64:Buffer.from(keys.privateKey.export({format:'pem',type:'pkcs8'})).toString('base64')},encoding:'utf8',timeout:240000});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const envelope=JSON.parse(await readFile('.release/channel.json','utf8'));
 assert.ok(verify(null,Buffer.from(envelope.payload),keys.publicKey,Buffer.from(envelope.signature,'base64')));
 const release=JSON.parse(envelope.payload);
 const root=await mkdtemp(join(process.platform==='win32'?process.env.ProgramData:tmpdir(),'MEBridgeQA-'));
 const target=join(root,release.releaseId);
 try{
  await mkdir(target);
  for(const[name,value]of Object.entries(unzipSync(await readFile('.release/'+release.file)))){await mkdir(dirname(join(target,name)),{recursive:true});await writeFile(join(target,name),value);}
  const url='https://github.com/Engrkhizarkhan/Madina-Sales-via-1bill/releases/download/'+baseId+'/';
  const base=verifyRelease(JSON.parse((await fetchBounded(url+'channel.json',65536,{redirect:'follow'})).toString()),await readFile('deploy/updater/release-public-key.pem','utf8'));
  const bytes=await fetchBounded(url+base.file,maxPackageBytes,{redirect:'follow'});verifyPackage(bytes,base);
  await writeFile(join(root,base.file),bytes);
  await cp(join(target,'dist/assets'),join(root,'static-assets'),{recursive:true});
  const installation=join(root,'MadinaExpress');
  for(const folder of ['host','config','data'])await mkdir(join(installation,folder),{recursive:true});
  await writeFile(join(installation,'host/updater.json'),JSON.stringify({project:'madina-express',cloudOrigin:'https://staff.madinaexpress.duckdns.org'}));
  await writeFile(join(installation,'config/backend.env'),'TERMINAL_CLOUD_ORIGIN=https://staff.madinaexpress.duckdns.org\nALLOWED_ORIGINS=https://localhost:8443\nDB_PASSWORD=fixture-retained\n');
  await writeFile(join(installation,'data/bookings.fixture'),'untouched passenger records');
  result=spawnSync(process.execPath,['backend/update/migrate-release.mjs','not-a-database-config'],{cwd:target,env:{...process.env,ProgramData:root},encoding:'utf8',timeout:180000});
  assert.equal(result.status,0,result.stderr);assert.ok(result.stderr.length<65536,'PowerShell progress must not overflow the migration pipe');
  if(process.platform==='win32'){
   assert.equal(JSON.parse(await readFile(join(installation,'host/updater.json'),'utf8')).cloudOrigin,'https://staff.madinaexpress.pk');
   assert.match(await readFile(join(installation,'config/backend.env'),'utf8'),/DB_PASSWORD=fixture-retained/);
  }
  assert.equal(await readFile(join(installation,'data/bookings.fixture'),'utf8'),'untouched passenger records');
  result=spawnSync(process.execPath,['--input-type=module','-e','await import("./backend/node/app.js");const{pool}=await import("./backend/node/db.js");await pool.end();'],{cwd:target,env:{...process.env,MADINA_ENV_FILE:join(root,'absent.env'),DB_NAME:'bridge_package_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone',ADMIN_TOTP_HEX:'',RESTRICT_STAFF_DEVICES:'false',ADMIN_TOTP_PAUSED:'false'},encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
 }finally{await rm(root,{recursive:true,force:true});}
});
