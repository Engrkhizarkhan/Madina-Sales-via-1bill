import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../node/config.js';
import { requireOwner } from '../node/account-access.js';
import { fail } from '../node/helpers.js';
import { releaseInfo } from './version.js';
import { updateChannel,saveUpdateControl,terminalUpdateStatus } from './control.js';
export const updateAdminRouter=Router();
const route=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
updateAdminRouter.get('/status',route(async(req,res)=>{
 requireOwner(req.user);
 let channel,terminal=null,cloudAvailable=true;
 if(config.terminal.local){
  try{const response=await fetch(config.terminal.cloudOrigin+'/api/terminal-sync/update-channel',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();channel=await response.json();}catch{cloudAvailable=false;channel={paused:false,manifest:null};}
  try{terminal=JSON.parse(await readFile(join(config.terminal.directory,'update-status.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 }else{channel=await updateChannel();terminal=await terminalUpdateStatus();}
 let available=null;try{const payload=channel.manifest&&JSON.parse(channel.manifest.payload);if(payload)available={version:payload.version,releaseId:payload.releaseId,createdAt:payload.createdAt};}catch{/* unavailable metadata */}
 res.json({current:releaseInfo,available,paused:channel.paused,cloudAvailable,terminal});
}));
updateAdminRouter.post('/control',route(async(req,res)=>{
 requireOwner(req.user);
 if(typeof req.body?.paused!=='boolean')fail('Choose whether updates are paused.',422,'validation_error');
 if(config.terminal.local){
  const response=await fetch(config.terminal.cloudOrigin+'/api/terminal-sync/update-control',{method:'POST',headers:{'Content-Type':'application/json','X-Terminal-Token':process.env.TERMINAL_INSTALL_TOKEN},body:JSON.stringify({paused:req.body.paused,installationId:process.env.TERMINAL_INSTALLATION_ID}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)fail('The cloud update control is unavailable. Try again when connected.',503,'cloud_unavailable');
  return res.json(await response.json());
 }
 res.json(await saveUpdateControl(req.body.paused));
}));
