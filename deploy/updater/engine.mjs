import { readFile,writeFile,rename,mkdir,unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
export async function jsonFile(file,fallback=null){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export async function atomicJson(file,value,mode=0o600){const temp=file+'.'+randomBytes(6).toString('hex');await writeFile(temp,JSON.stringify(value),{mode});await rename(temp,file);}
export async function activate({host,target,release,operations}){
 const pointer=join(host,'current.json'),journalFile=join(host,'transaction.json'),stateFile=join(host,'update-state.json');
 const previous=await jsonFile(pointer);
 if(!previous?.application)throw new Error('No installed application pointer');
 const activity=await operations.activity();
 if(activity.activeWrites||activity.quietSeconds<60)return {stage:'waiting',message:'Waiting for a quiet counter'};
 await operations.drain();
 const transaction={previous,target,release,stage:'backing-up'};
 await atomicJson(journalFile,transaction);
 const heartbeat=setInterval(()=>{operations.drain().catch(()=>undefined);},30000).unref();
 let stopped=false;
 try{
  transaction.backup=await operations.backup();
  await atomicJson(journalFile,transaction);
  await operations.stop();stopped=true;
  transaction.stage='migrating';await atomicJson(journalFile,transaction);
  await operations.migrate(target);
  transaction.stage='switching';await atomicJson(journalFile,transaction);
  await atomicJson(pointer,{application:target,releaseId:release.releaseId,sequence:release.sequence,version:release.version},0o644);
  await operations.start();
  if(!await operations.healthy(release.releaseId))throw new Error('The new application did not pass its health checks');
  await atomicJson(stateFile,{releaseId:release.releaseId,sequence:release.sequence,highestSequence:release.sequence,commit:release.commit,version:release.version,stage:'installed',updatedAt:new Date().toISOString()});
  await unlink(journalFile);
  await operations.resume().catch(()=>undefined);
  return {stage:'installed',releaseId:release.releaseId};
 }catch(error){
  if(stopped){
   await operations.stop().catch(()=>undefined);
   await atomicJson(pointer,previous,0o644);
   await operations.start();
   if(!await operations.healthy(previous.releaseId))throw new Error('Update failed and the previous application needs recovery');
  }else await operations.resume().catch(()=>undefined);
  const before=await jsonFile(stateFile,{});
  await atomicJson(stateFile,{...before,stage:'rolled-back',failedRelease:stopped?release.releaseId:undefined,message:error.message,updatedAt:new Date().toISOString()});
  await unlink(journalFile);
  await operations.resume().catch(()=>undefined);
  throw error;
 }finally{clearInterval(heartbeat);}
}
export async function recover({host,operations}){
 const file=join(host,'transaction.json'),transaction=await jsonFile(file);
 if(!transaction)return false;
 const current=await jsonFile(join(host,'current.json'));
 if(current?.application===transaction.target&&await operations.healthy(transaction.release.releaseId)){
  await atomicJson(join(host,'update-state.json'),{...transaction.release,highestSequence:transaction.release.sequence,stage:'installed',updatedAt:new Date().toISOString()});
 }else{
  await operations.stop().catch(()=>undefined);
  await atomicJson(join(host,'current.json'),transaction.previous,0o644);
  await operations.start();
  if(!await operations.healthy(transaction.previous.releaseId))throw new Error('An interrupted update requires recovery');
  const state=await jsonFile(join(host,'update-state.json'),{});
  await atomicJson(join(host,'update-state.json'),{...state,stage:'rolled-back',failedRelease:transaction.release.releaseId,message:'Recovered an interrupted update',updatedAt:new Date().toISOString()});
 }
 await unlink(file);await operations.resume().catch(()=>undefined);return true;
}
export async function acquireLock(host){
 await mkdir(host,{recursive:true});const file=join(host,'update.lock');
 try{await mkdir(file);}catch(error){if(error.code==='EEXIST')return null;throw error;}
 return async()=>{const {rmdir}=await import('node:fs/promises');await rmdir(file);};
}
