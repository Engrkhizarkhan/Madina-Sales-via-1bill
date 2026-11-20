import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {nodeRuntime,verifyNodeRuntime,selectedNodeRuntime,packageNodeRuntime,installNodeRuntime} from '../../deploy/updater/node-runtime.mjs';
test('unverified runtime bytes cannot change a protected launcher or the current runtime',async()=>{
 const base=await mkdtemp(join(tmpdir(),'madina-runtime-qa-'));
 try{
  for(const directory of ['runtime','host','app/deploy/windows'])await mkdir(join(base,directory),{recursive:true});
  await writeFile(join(base,'runtime/node.exe'),'original runtime');
  await writeFile(join(base,'host/Run-Server.ps1'),'original launcher');
  await writeFile(join(base,'app/deploy/windows',nodeRuntime.name),'corrupt executable');
  assert.equal(selectedNodeRuntime(base),join(base,'runtime/node.exe'));
  assert.throws(()=>verifyNodeRuntime(Buffer.from('untrusted')),/checksum/);
  await assert.rejects(installNodeRuntime(base,join(base,'app')),/checksum/);
  assert.equal(await readFile(join(base,'host/Run-Server.ps1'),'utf8'),'original launcher');
  assert.equal(await readFile(join(base,'runtime/node.exe'),'utf8'),'original runtime');
 }finally{await rm(base,{recursive:true,force:true});}
});
test('official pinned runtime stages beside the running executable and survives a repeated update', {skip:process.platform!=='win32'&&process.env.MADINA_RUNTIME_VERIFY!=='1',timeout:240000},async()=>{
 const base=await mkdtemp(join(tmpdir(),'madina-runtime-real-'));
 try{
  const application=join(base,'app');
  for(const directory of ['runtime','host','app/deploy/windows'])await mkdir(join(base,directory),{recursive:true});
  await writeFile(join(base,'runtime/node.exe'),'retained running runtime');
  for(const file of ['Run-Server.ps1','Run-Updater.ps1'])await writeFile(join(application,'deploy/windows',file),await readFile(resolve('deploy/windows',file)));
  await packageNodeRuntime(application);
  const expected=await readFile(join(application,'deploy/windows',nodeRuntime.name));verifyNodeRuntime(expected);
  const executable=await installNodeRuntime(base,application);
  assert.equal(selectedNodeRuntime(base),executable);
  assert.equal(await readFile(join(base,'runtime/node.exe'),'utf8'),'retained running runtime');
  assert.deepEqual(await readFile(executable),expected);
  assert.equal(await installNodeRuntime(base,application),executable);
  for(const file of ['Run-Server.ps1','Run-Updater.ps1'])assert.deepEqual(await readFile(join(base,'host',file)),await readFile(join(application,'deploy/windows',file)));
  if(process.platform==='win32')assert.equal(execFileSync(executable,['--version'],{encoding:'utf8'}).trim(),nodeRuntime.version);
 }finally{await rm(base,{recursive:true,force:true});}
});
