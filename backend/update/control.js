import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
export const updateDirectory=process.env.CLOUD_UPDATE_DIRECTORY||resolve('backend','.updates');
async function read(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export const updateControl=()=>read(join(updateDirectory,'control/state.json'),{paused:false});
export async function saveUpdateControl(paused){
 if(typeof paused!=='boolean')throw new Error('Choose whether updates are paused');
 const directory=join(updateDirectory,'control');await mkdir(directory,{recursive:true,mode:0o700});
 const temp=join(directory,'state.next');await writeFile(temp,JSON.stringify({paused,changedAt:new Date().toISOString()}),{mode:0o600});await rename(temp,join(directory,'state.json'));return {paused};
}
export async function updateChannel(){const control=await updateControl();const manifest=await read(join(updateDirectory,'channel.json'),null);return {paused:control.paused===true,manifest};}
export async function recordTerminalUpdate(value){
 const directory=join(updateDirectory,'control');await mkdir(directory,{recursive:true,mode:0o700});
 const allowed={stage:String(value.stage||'unknown').slice(0,40),checkedAt:new Date().toISOString(),current:value.current&&{releaseId:String(value.current.releaseId||'').slice(0,50),version:String(value.current.version||'').slice(0,30)},message:typeof value.message==='string'?value.message.slice(0,300):undefined};
 const temp=join(directory,'terminal.next');await writeFile(temp,JSON.stringify(allowed),{mode:0o600});await rename(temp,join(directory,'terminal.json'));
}
export const terminalUpdateStatus=()=>read(join(updateDirectory,'control/terminal.json'),null);
