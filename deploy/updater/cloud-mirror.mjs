import { readFile,writeFile,mkdir,rm,readdir,stat,symlink,rename,copyFile,chmod } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { verifyRelease,verifyPackage,zipEntries,fetchBounded,maxPackageBytes } from './release.mjs';
import { atomicJson,jsonFile,activate,recover } from './engine.mjs';
const exec=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const base='/var/lib/madina-express',host=join(base,'host'),updates=join(base,'updates'),releaseRoot=join(base,'releases');
const env=Object.fromEntries((await readFile('/etc/madina-express/backend.env','utf8')).split(/\r?\n/).map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value]));
const local=async(path,method='GET')=>{const response=await fetch('http://127.0.0.1:3101'+path,{method,headers:{'X-Madina-Updater-Key':env.UPDATE_CONTROL_KEY},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Cloud API is unavailable for update');return response.json();};
const phase=()=>jsonFile(join(base,'terminal/state.json'),{phase:'standalone'});
async function schemaReady(release){
 const expected=release.migrations.map(item=>item.name+':'+item.sha256).sort();
 const result=await exec('mysql',['-N','madina_express','-e',"SELECT CONCAT(name,':',sha256) FROM schema_migrations ORDER BY name"],{maxBuffer:65536});
 const actual=result.stdout.trim().split('\n');return expected.every(value=>actual.includes(value));
}
async function sourceReady(release){
 const secret=await jsonFile(join(base,'terminal/private.json'),{});
 try{const response=await fetch('http://127.0.0.1:3201/health',{headers:{'X-Madina-Relay-Key':secret.relayKey},signal:AbortSignal.timeout(5000)});const health=await response.json();return response.ok&&health.release?.releaseId===release.releaseId&&await schemaReady(release);}catch{return false;}
}
async function start(){
 const current=await jsonFile(join(host,'current.json'));
 if(!current?.application||(!current.application.startsWith(releaseRoot+'/')&&current.application!=='/opt/madina-express'))throw new Error('Invalid cloud application pointer');
 const temporary=join(base,'current.next');await rm(temporary,{force:true});await symlink(current.application,temporary);await rename(temporary,join(base,'current'));
 await exec('systemctl',['reload','madina-express']);
}
const operations={
 activity:()=>local('/internal-update/status'),drain:()=>local('/internal-update/drain','POST'),resume:()=>local('/internal-update/resume','POST'),
 backup:async()=>{const directory='/var/backups/madina-express';await mkdir(directory,{recursive:true,mode:0o700});const file=join(directory,'pre-update-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sql.gz');const child=spawn('mysqldump',['--single-transaction','--set-gtid-purged=OFF','--no-tablespaces','madina_express'],{stdio:['ignore','pipe','pipe']});child.stderr.resume();const exited=new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolveExit():reject(new Error('Cloud backup failed')));});await Promise.all([pipeline(child.stdout,createGzip(),createWriteStream(file,{mode:0o600})),exited]);return file;},
 // Keep the PM2 supervisor running. Restart drains the old process after migrations.
 stop:async()=>undefined,start,
 migrate:async application=>{if((await phase()).phase==='active'){if(!await schemaReady(await jsonFile(join(application,'release-metadata.json'))))throw new Error('Waiting for schema replication');return;}await exec('/opt/node-current/bin/node',['backend/update/migrate-release.mjs','/etc/madina-express/mysql-admin.cnf'],{cwd:application,timeout:180000,maxBuffer:1024*1024});},
 healthy:async releaseId=>{for(let index=0;index<30;index++){try{const health=await local('/health');if(health.status==='ok'&&(!releaseId||health.release?.releaseId===releaseId)){
 const current=await jsonFile(join(host,'current.json'));
 await exec('rsync',['-a','--exclude=index.html',join(current.application,'dist/'),'/var/www/madina-express/']);
 const next='/var/www/madina-express/.index.next';await copyFile(join(current.application,'dist/index.html'),next);await chmod(next,0o644);await rename(next,'/var/www/madina-express/index.html');
 return true;
}}catch{/* restarting */}await sleep(1000);}return false;}
};
await recover({host,operations});
try{if((await operations.activity()).draining)await operations.resume();}catch{/* the application may be starting */}
const state=await jsonFile(join(host,'update-state.json'),{}),current=await jsonFile(join(host,'current.json'));
const publicKey=await readFile('/etc/madina-express/release-public-key.pem','utf8');
const repository='https://github.com/Engrkhizarkhan/Madina-Sales-via-1bill';
let envelope;
try{envelope=JSON.parse((await fetchBounded(repository+'/releases/latest/download/channel.json',65536,{redirect:'follow'})).toString());}
catch(error){if(error.message==='Download returned 404'){console.log('No published signed release yet');process.exit(0);}throw error;}
const release=verifyRelease(envelope,publicKey,{minimumSequence:Math.max(Number(state.highestSequence||0),Number(state.sequence||0),Number(current.sequence||0))});
await atomicJson(join(host,'update-state.json'),{...state,highestSequence:Math.max(Number(state.highestSequence||0),release.sequence)});
const downloadUrl=repository+'/releases/download/'+release.releaseId+'/'+release.file;
await mkdir(updates,{recursive:true,mode:0o755});await mkdir(releaseRoot,{recursive:true,mode:0o755});
const target=join(releaseRoot,release.releaseId),archive=join(updates,release.file);
let bytes;try{bytes=await readFile(archive);verifyPackage(bytes,release);}catch{bytes=await fetchBounded(downloadUrl,maxPackageBytes,{redirect:'follow'});verifyPackage(bytes,release);await writeFile(archive,bytes,{mode:0o644});}
zipEntries(bytes);
const staged=await jsonFile(join(target,'build-info.json'));
if(staged?.commit!==release.commit){await rm(target,{recursive:true,force:true});await mkdir(target,{mode:0o755});await exec('unzip',['-q',archive,'-d',target],{timeout:120000,maxBuffer:65536});}
const info=await jsonFile(join(target,'build-info.json'));if(info?.commit!==release.commit||info.releaseId!==release.releaseId)throw new Error('Release package identity mismatch');
await writeFile(join(target,'release-metadata.json'),JSON.stringify(release),{mode:0o644});
await exec('chmod',['-R','a+rX',target]);
// Publish only after signature, package hash, path and identity verification.
await atomicJson(join(updates,'channel.json'),envelope);await exec('chmod',['0644',join(updates,'channel.json')]);
const control=await jsonFile(join(updates,'control/state.json'),{paused:false});
if(control.paused){console.log('Automatic installation paused by administrator');process.exit(0);}
if(current.releaseId===release.releaseId||state.failedRelease===release.releaseId){console.log('No new compatible release to install');process.exit(0);}
const terminal=await phase();
if(terminal.phase==='preparing'){console.log('Waiting for main PC installation');process.exit(0);}
if(terminal.phase==='active'&&!await sourceReady(release)){console.log('Release staged; waiting for terminal update and replication');process.exit(0);}
const result=await activate({host,target,release,operations});console.log('Cloud update:',result.stage);
if(result.stage==='installed'){
 // Use the accepted signed application, not an arbitrary working tree, for fresh installers.
 await exec('bash',[join(target,'deploy/prepare-terminal-support.sh')],{timeout:180000,maxBuffer:1024*1024});
 const versions=[];for(const name of await readdir(releaseRoot)){if(/^r-[a-f0-9]{12,40}$/.test(name))versions.push({name,time:(await stat(join(releaseRoot,name))).mtimeMs});}
 versions.sort((a,b)=>b.time-a.time);
 for(const version of versions.slice(3)){if(join(releaseRoot,version.name)!==target&&join(releaseRoot,version.name)!==current.application){await rm(join(releaseRoot,version.name),{recursive:true,force:true});await rm(join(updates,version.name+'.zip'),{force:true});}}
}
