import {readFile,mkdtemp,mkdir,readdir,copyFile,rm,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname,basename} from 'node:path';
import {zipEntries,maxPackageBytes} from './release.mjs';
const exec=promisify(execFile);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>typeof name==='string'&&name&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes(':')&&!/[\x00-\x1f]/.test(name)&&!name.split('/').some(part=>!part||part==='..'||part==='.'||part.startsWith('.env')||part==='.git');
export const releaseTreeHash=entries=>hash(Object.entries(entries).filter(([name])=>!name.endsWith('/')&&name!=='release-metadata.json').map(([name,bytes])=>[name,hash(bytes)]).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,digest])=>name+'\0'+digest+'\n').join(''));

// A tiny, signed configuration bridge reuses one exact previously signed ZIP.
// Only release code is materialized; database, host/config and data are outside
// this directory. The old updater can execute this before it loads npm modules.
export async function materializeBridge(target,{archiveDirectory=dirname(target)}={}) {
 let metadata;
 try{metadata=JSON.parse(await readFile(join(target,'domain-bridge.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
 const build=JSON.parse(await readFile(join(target,'build-info.json'),'utf8'));
 if(metadata.project!=='madina-express'||metadata.kind!=='domain-bridge'||!/^r-[a-f0-9]{12,40}$/.test(metadata.baseReleaseId)||!(/^[a-f0-9]{64}$/).test(metadata.baseSha256)||basename(target)!==build.releaseId||!/^r-[a-f0-9]{12,40}$/.test(build.releaseId)||!Array.isArray(metadata.overlay)||metadata.overlay.length>1000)throw new Error('Invalid domain bridge identity.');
 const overlay=new Set();
 for(const file of metadata.overlay){
  if(!safe(file.path)||overlay.has(file.path)||!(/^[a-f0-9]{64}$/).test(file.sha256))throw new Error('Unsafe domain bridge overlay.');
  const path=join(target,file.path);
  if(!(await lstat(path)).isFile()||hash(await readFile(path))!==file.sha256)throw new Error('Domain bridge overlay is incomplete or corrupted.');
  overlay.add(file.path);
 }
 for(const name of ['package.json','backend/node/server.js','dist/index.html','build-info.json','backend/update/migrate-release.mjs','deploy/updater/materialize-bridge.mjs'])if(!overlay.has(name))throw new Error('Domain bridge is missing a required file.');
 const archive=join(archiveDirectory,metadata.baseReleaseId+'.zip');
 let cached=true;
 try{
  if((await lstat(archive)).size>maxPackageBytes||hash(await readFile(archive))!==metadata.baseSha256)throw new Error('The previously signed base package is missing or corrupted.');
  zipEntries(await readFile(archive));
 }catch(error){if(error.code==='ENOENT')cached=false;else throw error;}
 const temporary=await mkdtemp(join(dirname(target),'.domain-base-'));
 try{
  let directory=temporary;
  if(!cached){
   directory=join(dirname(target),metadata.baseReleaseId);
   const entries={};
   async function inspect(folder,prefix=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
     const name=prefix+entry.name;if(!safe(name))throw new Error('Unsafe installed base path.');
     if(entry.isDirectory())await inspect(join(folder,entry.name),name+'/');
     else if(entry.isFile()&&name!=='release-metadata.json')entries[name]=await readFile(join(folder,entry.name));
     else if(!entry.isFile())throw new Error('Unexpected installed base file.');
    }
   }
   await inspect(directory);
   if(!/^[a-f0-9]{64}$/.test(metadata.baseTreeSha256||'')||releaseTreeHash(entries)!==metadata.baseTreeSha256)throw new Error('The installed base does not match the previously signed application.');
  }else if(process.platform==='win32'){
   const quote=value=>"'"+value.replaceAll("'","''")+"'";
   const script="$ErrorActionPreference='Stop';Expand-Archive -LiteralPath "+quote(archive)+' -DestinationPath '+quote(temporary)+' -Force';
   await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:120000,maxBuffer:65536});
  }else await exec('unzip',['-q',archive,'-d',temporary],{timeout:120000,maxBuffer:65536});
  const base=JSON.parse(await readFile(join(directory,'build-info.json'),'utf8'));
  if(base.releaseId!==metadata.baseReleaseId)throw new Error('The base package identity does not match.');
  async function copy(directory,prefix=''){
   for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=prefix+entry.name;if(!safe(path))throw new Error('Unsafe base release path.');
    if(entry.isDirectory()){await mkdir(join(target,path),{recursive:true});await copy(join(directory,entry.name),path+'/');}
    else if(entry.isFile()){if(!overlay.has(path)&&path!=='release-metadata.json')await copyFile(join(directory,entry.name),join(target,path));}
    else throw new Error('Unexpected base release file.');
   }
  }
  await copy(directory);
  return true;
 }finally{await rm(temporary,{recursive:true,force:true});}
}
