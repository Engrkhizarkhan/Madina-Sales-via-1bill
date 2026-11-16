import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
import {materializeBridge,releaseTreeHash} from '../../deploy/updater/materialize-bridge.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'madina-bridge-qa-'));
 const baseId='r-0123456789ab',releaseId='r-123456789abc',target=join(root,releaseId);
 const original={'package.json':Buffer.from('{"type":"module"}'),'build-info.json':Buffer.from(JSON.stringify({releaseId:baseId})),'backend/node/server.js':Buffer.from('original server'),'dist/index.html':Buffer.from('existing frontend'),'node_modules/retained/index.js':Buffer.from('verified dependency'),'dist/fonts/retained.ttf':Buffer.from('existing Urdu font')};
 const archive=Buffer.from(zipSync(original));
 const overlay={'package.json':original['package.json'],'backend/node/server.js':original['backend/node/server.js'],'dist/index.html':original['dist/index.html'],'build-info.json':Buffer.from(JSON.stringify({releaseId})),'backend/update/migrate-release.mjs':Buffer.from('configuration migration'),'deploy/updater/materialize-bridge.mjs':Buffer.from('signed bootstrap')};
 try{
  await mkdir(target);await writeFile(join(root,baseId+'.zip'),archive);
  for(const [name,value] of Object.entries(overlay)){await mkdir(dirname(join(target,name)),{recursive:true});await writeFile(join(target,name),value);}
  const metadata={project:'madina-express',kind:'domain-bridge',baseReleaseId:baseId,baseSha256:hash(archive),baseTreeSha256:releaseTreeHash(original),overlay:Object.entries(overlay).map(([path,value])=>({path,sha256:hash(value)}))};
  await writeFile(join(target,'domain-bridge.json'),JSON.stringify(metadata));
  await mkdir(join(root,'data'));await writeFile(join(root,'data/bookings.sql'),'retained business data');
  await run({root,target,metadata,archive,baseId,overlay,original});
  assert.equal(await readFile(join(root,'data/bookings.sql'),'utf8'),'retained business data');
 }finally{await rm(root,{recursive:true,force:true});}
}
test('small bridge reconstructs verified installed code without overwriting signed changes or business data',()=>fixture(async({target,overlay})=>{
 assert.equal(await materializeBridge(target),true);
 assert.equal(await readFile(join(target,'node_modules/retained/index.js'),'utf8'),'verified dependency');
 assert.equal(await readFile(join(target,'dist/fonts/retained.ttf'),'utf8'),'existing Urdu font');
 for(const [name,value] of Object.entries(overlay))assert.deepEqual(await readFile(join(target,name)),value);
 await writeFile(join(target,'node_modules/retained/index.js'),'interrupted copy');
 assert.equal(await materializeBridge(target),true);
 assert.equal(await readFile(join(target,'node_modules/retained/index.js'),'utf8'),'verified dependency');
}));
test('corrupted or missing cached packages cannot become executable release code',()=>fixture(async({root,target,baseId})=>{
 await writeFile(join(root,baseId+'.zip'),'corrupted archive');
 await assert.rejects(materializeBridge(target),/missing or corrupted/);
 await assert.rejects(access(join(target,'node_modules/retained/index.js')));
 await rm(join(root,baseId+'.zip'));
 await assert.rejects(materializeBridge(target),error=>error.code==='ENOENT');
}));
test('signed overlay corruption and escaping paths are rejected before base files are copied',()=>fixture(async({target,metadata})=>{
 await writeFile(join(target,'backend/node/server.js'),'corrupted overlay');
 await assert.rejects(materializeBridge(target),/incomplete or corrupted/);
 metadata.overlay[0].path='../config/backend.env';
 await writeFile(join(target,'domain-bridge.json'),JSON.stringify(metadata));
 await assert.rejects(materializeBridge(target),/Unsafe domain bridge/);
 await assert.rejects(access(join(target,'node_modules/retained/index.js')));
}));
test('ordinary full releases do not perform a bridge operation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'madina-full-qa-'));
 try{assert.equal(await materializeBridge(directory),false);}finally{await rm(directory,{recursive:true,force:true});}
});
test('an expired archive cache can reuse only a byte-verified installed base',()=>fixture(async({root,target,baseId,original})=>{
 const base=join(root,baseId);
 for(const[name,value]of Object.entries(original)){await mkdir(dirname(join(base,name)),{recursive:true});await writeFile(join(base,name),value);}
 await writeFile(join(base,'release-metadata.json'),'protected cloud-only metadata');
 await rm(join(root,baseId+'.zip'));
 assert.equal(await materializeBridge(target),true);
 await writeFile(join(base,'node_modules/retained/index.js'),'modified installed code');
 await assert.rejects(materializeBridge(target),/does not match/);
}));
