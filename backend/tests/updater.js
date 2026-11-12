import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign,createHash } from 'node:crypto';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRelease,verifyPackage,zipEntries } from '../../deploy/updater/release.mjs';
import { activate,recover,atomicJson,jsonFile } from '../../deploy/updater/engine.mjs';
const keys=generateKeyPairSync('ed25519'),key=keys.publicKey.export({type:'spki',format:'pem'});
const release={project:'madina-express',releaseId:'r-'+('ab'.repeat(6)),commit:'ab'.repeat(20),version:'3.0.0',sequence:10,createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),schemaBackwardsCompatible:true,migrations:[],file:'r-'+('ab'.repeat(6))+'.zip',bytes:3,sha256:createHash('sha256').update('zip').digest('hex')};
const envelope=value=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')};};
test('signed updates reject tampering, downgrade, expiry and unsafe metadata',()=>{
 assert.equal(verifyRelease(envelope(release),key).releaseId,release.releaseId);
 assert.throws(()=>verifyRelease({...envelope(release),payload:JSON.stringify({...release,sequence:99})},key),/signature/);
 assert.throws(()=>verifyRelease(envelope(release),key,{minimumSequence:11}),/Older/);
 assert.throws(()=>verifyRelease(envelope({...release,expiresAt:'2000-01-01'}),key),/expired/);
 assert.throws(()=>verifyRelease(envelope({...release,file:'../../escape.zip'}),key),/package/);
 assert.throws(()=>verifyRelease(envelope({...release,schemaBackwardsCompatible:false}),key),/supervised/);
 verifyPackage(Buffer.from('zip'),release);assert.throws(()=>verifyPackage(Buffer.from('bad'),release),/corrupted/);
});
function zip(names){
 const local=[],central=[];let position=0;
 for(const name of names){const filename=Buffer.from(name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(filename.length,26);local.push(header,filename);const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(position,42);central.push(record,filename);position+=header.length+filename.length;}
 const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(position,16);return Buffer.concat([...local,dir,end]);
}
const files=['package.json','backend/node/server.js','dist/index.html','build-info.json'];
test('archive validation rejects path traversal, environment files, duplicate Windows paths and incomplete packages',()=>{
 assert.equal(zipEntries(zip(files)).length,4);
 for(const path of ['../outside','C:/outside','backend/.env','a\\..\\outside','PACKAGE.JSON'])assert.throws(()=>zipEntries(zip([...files,path])),/Unsafe/);
 assert.throws(()=>zipEntries(zip(['package.json'])),/missing/);
 assert.throws(()=>zipEntries(Buffer.from('partial')),/ZIP/);
});
async function fixture(action){
 const host=await mkdtemp(join(tmpdir(),'madina-update-qa-'));await mkdir(join(host,'old'));await mkdir(join(host,'new'));
 const previous={application:join(host,'old'),releaseId:'r-'+('cd'.repeat(6)),sequence:9};await atomicJson(join(host,'current.json'),previous,0o644);
 const events=[],data={tickets:17,payments:119000};let running=previous.releaseId;
 const operations={activity:async()=>({activeWrites:0,quietSeconds:61}),drain:async()=>events.push('drain'),resume:async()=>events.push('resume'),backup:async()=>{events.push('backup');return 'private-backup.sql.gz';},stop:async()=>events.push('stop'),migrate:async()=>{events.push('migrate');},start:async()=>{running=(await jsonFile(join(host,'current.json'))).releaseId;events.push('start:'+running);},healthy:async id=>running===id};
 try{await action({host,target:join(host,'new'),release,previous,events,data,operations});}finally{await rm(host,{recursive:true,force:true});}
}
test('quiet updates back up, migrate, switch and verify without changing ticket data',()=>fixture(async context=>{
 const result=await activate(context);assert.equal(result.stage,'installed');assert.equal((await jsonFile(join(context.host,'current.json'))).releaseId,release.releaseId);
 assert.deepEqual(context.events,['drain','backup','stop','migrate','start:'+release.releaseId,'resume']);
 assert.deepEqual(context.data,{tickets:17,payments:119000});assert.equal(await jsonFile(join(context.host,'transaction.json')),null);
}));
test('busy payment collection defers update without stopping the application',()=>fixture(async context=>{
 context.operations.activity=async()=>({activeWrites:1,quietSeconds:0});assert.equal((await activate(context)).stage,'waiting');assert.deepEqual(context.events,[]);
}));
test('failed health checks roll back code and preserve the live database',()=>fixture(async context=>{
 context.operations.healthy=async id=>id===context.previous.releaseId;
 await assert.rejects(activate(context),/health/);
 assert.equal((await jsonFile(join(context.host,'current.json'))).releaseId,context.previous.releaseId);
 assert.equal((await jsonFile(join(context.host,'update-state.json'))).failedRelease,release.releaseId);
 assert.deepEqual(context.data,{tickets:17,payments:119000});
}));
test('backup failure keeps the old application running and allows a later retry',()=>fixture(async context=>{
 context.operations.backup=async()=>{throw new Error('backup unavailable');};await assert.rejects(activate(context),/backup/);
 assert.equal((await jsonFile(join(context.host,'current.json'))).releaseId,context.previous.releaseId);assert.ok(!context.events.includes('stop'));
 assert.equal((await jsonFile(join(context.host,'update-state.json'))).failedRelease,undefined);
}));
test('power interruption after switching is recovered without restoring an old database',()=>fixture(async context=>{
 await atomicJson(join(context.host,'current.json'),{application:context.target,releaseId:release.releaseId});
 await atomicJson(join(context.host,'transaction.json'),{previous:context.previous,target:context.target,release});
 context.operations.healthy=async id=>id===context.previous.releaseId;
 assert.equal(await recover(context),true);assert.equal((await jsonFile(join(context.host,'current.json'))).releaseId,context.previous.releaseId);
 assert.deepEqual(context.data,{tickets:17,payments:119000});
}));
test('power interruption after a healthy switch finishes the successful update',()=>fixture(async context=>{
 await atomicJson(join(context.host,'current.json'),{application:context.target,releaseId:release.releaseId});
 await atomicJson(join(context.host,'transaction.json'),{previous:context.previous,target:context.target,release});
 context.operations.healthy=async()=>true;assert.equal(await recover(context),true);
 assert.equal((await jsonFile(join(context.host,'update-state.json'))).releaseId,release.releaseId);assert.deepEqual(context.events,['resume']);
}));

test('a stable process launcher selects the new release even when the old working directory remains',async()=>{
 const root=await mkdtemp(join(tmpdir(),'madina-launcher-qa-'));
 const {selectedApplication}=await import('../../deploy/updater/application-path.mjs');
 try{
  for(const name of ['old','new']){await mkdir(join(root,name,'backend/node'),{recursive:true});await writeFile(join(root,name,'backend/node/server.js'),'');}
  const pointer=join(root,'current.json');await atomicJson(pointer,{application:join(root,'old')});
  assert.equal(await selectedApplication(pointer,[root]),await (await import('node:fs/promises')).realpath(join(root,'old')));
  await atomicJson(pointer,{application:join(root,'new')});
  assert.equal(await selectedApplication(pointer,[root]),await (await import('node:fs/promises')).realpath(join(root,'new')));
  await atomicJson(pointer,{application:join(root,'..')});await assert.rejects(selectedApplication(pointer,[root]),/outside/);
 }finally{await rm(root,{recursive:true,force:true});}
});
