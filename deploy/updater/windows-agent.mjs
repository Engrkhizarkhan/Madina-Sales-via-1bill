import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,writeFile,mkdir,rm,readdir,stat,cp } from 'node:fs/promises';
import { join,resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { verifyRelease,verifyPackage,zipEntries,fetchBounded,maxPackageBytes } from './release.mjs';
import { atomicJson,jsonFile,activate,recover } from './engine.mjs';
const exec=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const ps=code=>exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';"+code,'utf16le').toString('base64')],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
export const releaseAclCommand=target=>`& icacls.exe ${quote(target)} /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null; if($LASTEXITCODE -ne 0){throw 'Release directory permissions failed'}; & icacls.exe ${quote(join(target,'*'))} /reset /T /C /Q | Out-Null; if($LASTEXITCODE -ne 0){throw 'Release file permissions failed'}`;
export async function run(base){
 if(process.platform!=='win32')throw new Error('This updater runs on Windows only');
 const host=join(base,'host'),settings=await jsonFile(join(host,'updater.json'));
 if(!settings||settings.project!=='madina-express'||new URL(settings.cloudOrigin).protocol!=='https:')throw new Error('Invalid protected updater configuration');
 const publicKey=await readFile(join(host,'release-public-key.pem'),'utf8');
 const env=Object.fromEntries((await readFile(join(base,'config/backend.env'),'utf8')).split(/\r?\n/).map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value]));
 const origin=settings.cloudOrigin.replace(/\/$/,''),data=join(base,'data'),node=join(base,'runtime/node.exe');
 // Expired update backups are separate from the daily app backup rotation.
 try{for(const name of await readdir(join(base,'backups'))){
  if(!/^pre-update-[0-9TZ-]+\.sql\.gz$/.test(name))continue;
  const file=join(base,'backups',name);if((await stat(file)).mtimeMs<Date.now()-30*86400000)await rm(file,{force:true});
 }}catch{/* Cleanup must never prevent an application update. */}
 const report=async status=>{
  const value={...status,checkedAt:new Date().toISOString()};
  await atomicJson(join(data,'update-status.json'),value);
  try{await fetch(origin+'/api/terminal-sync/update-status',{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':env.TERMINAL_INSTALL_TOKEN},body:JSON.stringify({...value,installationId:env.TERMINAL_INSTALLATION_ID}),signal:AbortSignal.timeout(10000)});}catch{/* operation remains local */}
 };
 const local=async(path,method='GET')=>{
  const response=await fetch('http://127.0.0.1:'+(env.NODE_API_PORT||43101)+path,{method,headers:{'X-Madina-Relay-Key':env.TERMINAL_RELAY_KEY,'X-Madina-Updater-Key':env.UPDATE_CONTROL_KEY},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`The local updater request returned ${response.status}`);return response.json();
 };
 const assertApplication=application=>{const path=relative(base,resolve(application));if(path.startsWith('..')||path.startsWith('host')||(!path.startsWith('releases')&&path!=='application'))throw new Error('Invalid application pointer');};
 const healthy=async releaseId=>{
  for(let attempt=0;attempt<30;attempt++){
   try{
    const health=await local('/health');
    if(health.status==='ok'&&(!releaseId||health.release?.releaseId===releaseId)){
     const https=await new Promise((resolveHealth,reject)=>{
      const request=httpsRequest('https://localhost:'+(env.TERMINAL_HTTPS_PORT||8443)+'/api/health',{ca:awaitableCa,timeout:3000},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>{try{resolveHealth(JSON.parse(text));}catch(error){reject(error);}});});request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('HTTPS health timeout')));request.end();
     });
     if(https.status==='ok'&&https.release?.releaseId===health.release?.releaseId)return true;
    }
   }catch{/* wait for the service */}
   await sleep(2000);
  }return false;
 };
 const awaitableCa=await readFile(join(data,'tls/ca.crt'));
 const operations={
  activity:()=>local('/internal-update/status'),drain:()=>local('/internal-update/drain','POST'),resume:()=>local('/internal-update/resume','POST'),healthy,
  stop:()=>ps(`Stop-ScheduledTask -TaskName 'Madina Express Terminal Server' -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -eq ${quote(node)} -and $_.CommandLine -match 'backend[\\/]node[\\/]server\\.js') -or ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like '*madina-terminal@62.171.173.11*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`),
  start:()=>ps("Start-ScheduledTask -TaskName 'Madina Express Terminal Server'"),
  backup:async()=>{
   const directory=join(base,'backups');await mkdir(directory,{recursive:true});const file=join(directory,'pre-update-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql.gz');
   const child=spawn(join(base,'mysql/bin/mysqldump.exe'),['--defaults-extra-file='+join(base,'config/mysql-admin.cnf'),'--single-transaction','--set-gtid-purged=OFF','--no-tablespaces','madina_express'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
   const exit=new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolveExit():reject(new Error('Pre-update database backup failed')));});
   await Promise.all([pipeline(child.stdout,createGzip(),createWriteStream(file)),exit]);return file;
  },
  migrate:async application=>{assertApplication(application);await exec(node,['backend/update/migrate-release.mjs',join(base,'config/mysql-admin.cnf')],{cwd:application,windowsHide:true,timeout:180000,maxBuffer:1024*1024});}
 };
 await recover({host,operations});
try{if((await operations.activity()).draining)await operations.resume();}catch{/* the application may be starting */}
 const channel=JSON.parse((await fetchBounded(origin+'/api/terminal-sync/update-channel',65536)).toString());
 if(channel.paused||!channel.manifest){await report({stage:channel.paused?'paused':'up-to-date',current:await jsonFile(join(host,'current.json'))});return;}
 const state=await jsonFile(join(host,'update-state.json'),{}),current=await jsonFile(join(host,'current.json'));
 const release=verifyRelease(channel.manifest,publicKey,{minimumSequence:Math.max(Number(state.highestSequence||0),Number(state.sequence||0),Number(current.sequence||0))});
 await atomicJson(join(host,'update-state.json'),{...state,highestSequence:Math.max(Number(state.highestSequence||0),release.sequence)});
 if(current.releaseId===release.releaseId){await report({stage:'up-to-date',current,available:release.releaseId});return;}
 if(state.failedRelease===release.releaseId){await report({...state,current});return;}
 const releases=join(base,'releases');await mkdir(releases,{recursive:true});const target=join(releases,release.releaseId);
 const archive=join(releases,release.file);let bytes;
 try{bytes=await readFile(archive);verifyPackage(bytes,release);}catch{bytes=await fetchBounded(origin+'/updates/'+release.file,maxPackageBytes);verifyPackage(bytes,release);await writeFile(archive,bytes);}
 zipEntries(bytes);assertApplication(target);
 let staged;
 try{staged=await jsonFile(join(target,'build-info.json'));}
 catch(error){
  if(!['EPERM','EACCES'].includes(error.code))throw error;
  await ps(releaseAclCommand(target));
  staged=await jsonFile(join(target,'build-info.json'));
 }
 if(staged?.commit!==release.commit||staged.releaseId!==release.releaseId){
  await rm(target,{recursive:true,force:true});await mkdir(target);
  await ps(`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(target)} -Force`);
 }
 // Normalize inherited file permissions before reading or starting extracted code.
 // Keep only the release root protected; descendants inherit its explicit rules.
 await ps(releaseAclCommand(target));
 const info=await jsonFile(join(target,'build-info.json'));if(info?.commit!==release.commit||info.releaseId!==release.releaseId)throw new Error('Package identity does not match signed metadata');
 await cp(join(target,'dist/assets'),join(base,'static-assets'),{recursive:true});
 await report({stage:'ready',current,available:release.releaseId});
 const latestChannel=JSON.parse((await fetchBounded(origin+'/api/terminal-sync/update-channel',65536)).toString());
 if(latestChannel.paused){await report({stage:'paused',current,available:release.releaseId});return;}
 const latestRelease=verifyRelease(latestChannel.manifest,publicKey,{minimumSequence:release.sequence});
 if(latestRelease.releaseId!==release.releaseId){await report({stage:'waiting',message:'A newer release is available; checking again shortly',current});return;}
 const result=await activate({host,target,release,operations});await report({...result,current:await jsonFile(join(host,'current.json'))});
 if(result.stage==='installed'){
  const candidates=[];for(const name of await readdir(releases)){if(/^r-[a-f0-9]{12,40}$/.test(name))candidates.push({name,time:(await stat(join(releases,name))).mtimeMs});}
  candidates.sort((a,b)=>b.time-a.time);
  for(const item of candidates.slice(3)){if(join(releases,item.name)!==target&&join(releases,item.name)!==current.application){await rm(join(releases,item.name),{recursive:true,force:true});await rm(join(releases,item.name+'.zip'),{force:true});}}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const base=join(process.env.ProgramData||'C:\\ProgramData','MadinaExpress');
 run(base).catch(async error=>{console.error('Update deferred:',error.message);try{await atomicJson(join(base,'data/update-status.json'),{stage:'deferred',message:error.message,checkedAt:new Date().toISOString()});}catch{/* log stays available */}process.exitCode=1;});
}
