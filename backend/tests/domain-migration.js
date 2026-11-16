import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateCloudDomain} from '../../deploy/updater/domain-migration.mjs';
import {withCloudOrigin} from '../../deploy/updater/cloud-origin.mjs';
import {staffOrigin,legacyStaffOrigin,webOrigins,cloudOriginCandidates} from '../../shared/domains.mjs';
import {fetchBounded} from '../../deploy/updater/release.mjs';

for(const interrupted of [false,true])test(`protected domain migration preserves credentials, local access and old endpoints${interrupted?' after an interrupted switch':''}`,async()=>{
 const base=await mkdtemp(join(tmpdir(),'madina-domain-qa-'));
 const source=`\uFEFFTERMINAL_ROLE=terminal\r\nTERMINAL_CLOUD_ORIGIN=${interrupted?staffOrigin:legacyStaffOrigin}\r\nTERMINAL_LOCAL_ORIGIN=https://192.168.7.243:8443\r\nALLOWED_ORIGINS=https://192.168.7.243:8443,https://localhost:8443,${legacyStaffOrigin}\r\nTERMINAL_INSTALL_TOKEN=protected-token\r\nDB_PASSWORD=protected-database-password\r\nADMIN_TOTP_HEX=protected-authenticator\r\n`;
 const updater={project:'madina-express',cloudOrigin:legacyStaffOrigin,retainedSetting:true};
 try{
  for(const name of ['config','host'])await mkdir(join(base,name));
  await writeFile(join(base,'config/backend.env'),source);await writeFile(join(base,'host/updater.json'),JSON.stringify(updater));
  assert.equal((await migrateCloudDomain(base)).changed,true);
  const after=await readFile(join(base,'config/backend.env'),'utf8');
  assert.match(after,/TERMINAL_CLOUD_ORIGIN=https:\/\/staff\.madinaexpress\.pk\r?\n/);
  for(const line of source.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x&&!x.startsWith('TERMINAL_CLOUD_ORIGIN=')&&!x.startsWith('ALLOWED_ORIGINS=')))assert.ok(after.includes(line));
  const allowed=after.match(/^ALLOWED_ORIGINS=(.*)$/m)[1].trim().split(',');
  for(const origin of ['https://192.168.7.243:8443','https://localhost:8443',...webOrigins])assert.ok(allowed.includes(origin));
  assert.equal(allowed.length,new Set(allowed).size);
  assert.deepEqual(JSON.parse(await readFile(join(base,'host/updater.json'))),{...updater,cloudOrigin:staffOrigin});
  assert.equal(await readFile(join(base,'config/backend.env.pre-pk'),'utf8'),source);
  assert.deepEqual(JSON.parse(await readFile(join(base,'host/updater.json.pre-pk'))),updater);
  const marker=JSON.parse(await readFile(join(base,'host/cloud-domain-migration.json')));
  assert.equal(marker.cloudOrigin,staffOrigin);assert.equal(marker.fallbackOrigin,legacyStaffOrigin);
  assert.equal((await migrateCloudDomain(base)).changed,false);
  assert.equal(await readFile(join(base,'config/backend.env.pre-pk'),'utf8'),source);
  if(process.platform!=='win32')for(const file of ['config/backend.env','config/backend.env.pre-pk','host/updater.json','host/cloud-domain-migration.json'])assert.equal((await stat(join(base,file))).mode&0o777,0o600);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('migration never overwrites an unapproved cloud or broken updater configuration',async()=>{
 const base=await mkdtemp(join(tmpdir(),'madina-domain-qa-'));
 try{
  for(const name of ['config','host'])await mkdir(join(base,name));
  const source='TERMINAL_CLOUD_ORIGIN=https://unapproved.invalid\nDB_PASSWORD=retained\n';
  await writeFile(join(base,'config/backend.env'),source);
  await writeFile(join(base,'host/updater.json'),JSON.stringify({project:'madina-express',cloudOrigin:legacyStaffOrigin}));
  await assert.rejects(migrateCloudDomain(base),/not an approved/);
  assert.equal(await readFile(join(base,'config/backend.env'),'utf8'),source);
  await writeFile(join(base,'host/updater.json'),'broken');
  await assert.rejects(migrateCloudDomain(base),/Invalid JSON/);
  assert.equal(await readFile(join(base,'config/backend.env'),'utf8'),source);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('cloud requests use the new domain and fail over only to the retained approved server',async()=>{
 const seen=[];
 assert.deepEqual(await withCloudOrigin(staffOrigin,async origin=>{seen.push(origin);return 'connected';}),{origin:staffOrigin,value:'connected'});
 assert.deepEqual(seen,[staffOrigin]);seen.length=0;
 const fallback=await withCloudOrigin(staffOrigin,async origin=>{seen.push(origin);if(origin===staffOrigin)throw new Error('Connection interrupted');return {connected:true};});
 assert.equal(fallback.origin,legacyStaffOrigin);assert.deepEqual(seen,[staffOrigin,legacyStaffOrigin]);
 await assert.rejects(withCloudOrigin(staffOrigin,async()=>{throw new Error('Offline');}),/Offline/);
 assert.deepEqual(cloudOriginCandidates('https://custom.invalid/'),['https://custom.invalid']);
 assert.deepEqual(cloudOriginCandidates(legacyStaffOrigin),[legacyStaffOrigin,staffOrigin]);
});
test('bounded cloud downloads honor the caller timeout so fallback is not held for three minutes',async()=>{
 const original=globalThis.fetch,signal=AbortSignal.timeout(1000);
 try{
  globalThis.fetch=async(_url,options)=>{assert.equal(options.signal,signal);assert.equal(options.redirect,'error');return new Response('verified bytes');};
  assert.equal((await fetchBounded('https://example.invalid/package',100,{signal})).toString(),'verified bytes');
 }finally{globalThis.fetch=original;}
});
