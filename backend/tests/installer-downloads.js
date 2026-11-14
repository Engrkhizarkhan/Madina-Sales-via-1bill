import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,stat,utimes,mkdir,chown,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
process.env.DB_NAME||='installer_module_qa';process.env.DB_USER||='qa';process.env.DB_PASSWORD||='unused';
const {buildMainInstaller,createInstallerDownload,installerDownload,pruneInstallerDownloads,installerDownloadLifetime}=await import('../terminal/installer-downloads.js');

const alternateGroup=process.getgroups?.().find(gid=>gid!==process.getgid?.());
test('Linux installer archives inherit the protected nginx cache group',{skip:process.platform!=='linux'||alternateGroup===undefined},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'madina-installer-group-qa-'));
 try{
  const source=join(directory,'source.zip'),cache=join(directory,'downloads');
  await writeFile(source,'installer fixture',{mode:0o600});await mkdir(cache);
  await chown(cache,process.getuid(),alternateGroup);await chmod(cache,0o2750);
  const grant=await createInstallerDownload(source,1,'a'.repeat(64),{directory:cache});
  const id=grant.downloadPath.split('/').at(-1),file=await stat(join(cache,id+'.zip'));
  assert.equal(file.gid,alternateGroup);assert.equal(file.mode&0o777,0o640);
  assert.equal((await stat(join(cache,id+'.json'))).mode&0o777,0o600);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('main installer stays complete and session protected across interrupted/resumed downloads',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'madina-installer-qa-'));
 let archive;
 try{
  const base=join(directory,'base.zip'),payload=zipSync({'fixture.bin':randomBytes(2*1024*1024)},{level:0});await writeFile(base,payload);
  const token=randomBytes(32).toString('hex'),setup={installToken:token,knownHost:'62.171.173.11 ssh-ed25519 QA-PUBLIC-KEY'};
  archive=await buildMainInstaller(setup,{project:resolve('.'),baseArchive:base});
  const bytes=await readFile(archive.file),entries=unzipSync(bytes);
  assert.deepEqual(Buffer.from(entries['application.zip']),Buffer.from(payload));
  assert.equal(JSON.parse(Buffer.from(entries['setup.json'])).token,token);
  for(const name of ['Install-Main-PC.cmd','Install-Main-PC.ps1','runtime.json','Change-Main-PC-Network.cmd'])assert.ok(entries[name]);
  const cache=join(directory,'downloads'),session=randomBytes(32).toString('hex'),now=Date.now();
  const grant=await createInstallerDownload(archive.file,1,session,{directory:cache,now});
  assert.ok(!JSON.stringify(grant).includes(token));const id=grant.downloadPath.split('/').at(-1);
  assert.deepEqual(await readFile(await installerDownload(id,1,session,{directory:cache,now})),bytes);
  await assert.rejects(installerDownload(id,2,session,{directory:cache,now}),e=>e.status===403);
  await assert.rejects(installerDownload(id,1,randomBytes(32).toString('hex'),{directory:cache,now}),e=>e.status===403);
  await assert.rejects(installerDownload('../private.json',1,session,{directory:cache,now}),e=>e.status===404);
  const reloaded=await import('../terminal/installer-downloads.js?fresh-grant-reader');
  assert.deepEqual(await readFile(await reloaded.installerDownload(id,1,session,{directory:cache,now})),bytes);
  if(process.platform!=='win32')assert.equal((await stat(join(cache,id+'.json'))).mode&0o777,0o600);
  await writeFile(join(cache,'mysql-admin.cnf'),'protected fixture');
  await assert.rejects(installerDownload(id,1,session,{directory:cache,now:now+installerDownloadLifetime+1}),e=>e.status===410);
  assert.equal(await readFile(join(cache,'mysql-admin.cnf'),'utf8'),'protected fixture');
  const corrupt=join(cache,randomBytes(32).toString('hex')+'.json');await writeFile(corrupt,'{');
  for(let index=0;index<7;index++){
   const fresh=await createInstallerDownload(archive.file,1,session,{directory:cache,now});
   await installerDownload(fresh.downloadPath.split('/').at(-1),1,session,{directory:cache,now});
  }
  await rm(corrupt);
  assert.equal((await readdir(cache)).filter(name=>name.endsWith('.json')).length,5);
  const staleNext=join(cache,randomBytes(32).toString('hex')+'.json.next');await writeFile(staleNext,'{');
  await writeFile(corrupt,'{');
  for(const file of [staleNext,corrupt])await utimes(file,new Date(now-installerDownloadLifetime-1000),new Date(now-installerDownloadLifetime-1000));
  const orphan=join(cache,randomBytes(32).toString('hex')+'.zip');await writeFile(orphan,'orphan fixture');await utimes(orphan,new Date(now-installerDownloadLifetime-1000),new Date(now-installerDownloadLifetime-1000));
  await pruneInstallerDownloads(cache,now+installerDownloadLifetime+100);
  assert.deepEqual(await readdir(cache),['mysql-admin.cnf']);
 }finally{await archive?.dispose();await rm(directory,{recursive:true,force:true});}
});
