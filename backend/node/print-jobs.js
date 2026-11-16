import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import express from 'express';
import {config} from './config.js';
import {fail} from './helpers.js';
import {maintenance} from '../update/maintenance.js';
import {validateReportTree} from '../../shared/report-print.mjs';
const lifetime=5*60000;
const directory=()=>process.env.PRINT_JOB_DIRECTORY||join(config.terminal.cloud?(process.env.CLOUD_SESSION_DIRECTORY||resolve('backend','.cloud-sessions')):config.terminal.directory,'print-jobs');
const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const printFile=name=>/^[a-f0-9]{64}\.json(?:\.claimed)?$/.test(name);
export async function printJobSnapshot(){
 let names;try{names=await readdir(directory());}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const files=[];
 for(const name of names.filter(printFile))try{files.push({name,content:await readFile(join(directory(),name),'utf8')});}catch(error){if(error.code!=='ENOENT')throw error;}
 return files;
}
export async function clearPrintJobs(){
 let names;try{names=await readdir(directory());}catch(error){if(error.code==='ENOENT')return 0;throw error;}
 let count=0;
 for(const name of names.filter(printFile))try{await rm(join(directory(),name));count++;}catch(error){if(error.code!=='ENOENT')throw error;}
 return count;
}
export async function prunePrintJobs(now=Date.now()){
 let names;try{names=await readdir(directory());}catch(e){if(e.code==='ENOENT')return;throw e;}
 for(const name of names){if(!/^[a-f0-9]{64}\.json(?:\.claimed)?$/.test(name))continue;const file=join(directory(),name);try{if((await stat(file)).mtimeMs<now-lifetime)await rm(file,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}}
}
export async function createPrintJob(body,userId){
 if(maintenance.draining())fail('Maintenance is in progress. Print again in a moment.',503,'updating');
 if(!body||!['portrait','landscape'].includes(body.orientation)||typeof body.title!=='string'||body.title.length>120||!body.title.trim())fail('Choose a valid A4 report.',422,'invalid_report');
 let tree;try{tree=validateReportTree(body.document);}catch(e){fail(e.message,422,'invalid_report');}
 await mkdir(directory(),{recursive:true,mode:0o700});await prunePrintJobs();
 // A private, short-lived snapshot is enough to print; it cannot log into the app.
 const id=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
 const value={userId,hash:digest(key),expiresAt:Date.now()+lifetime,title:body.title,orientation:body.orientation,document:tree};
 await writeFile(join(directory(),id+'.json'),JSON.stringify(value),{mode:0o600,flag:'wx'});
 const own=[];
 for(const name of await readdir(directory())){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;try{const item=JSON.parse(await readFile(join(directory(),name),'utf8'));if(item.userId===userId)own.push({name,expiresAt:item.expiresAt});}catch(e){if(e.code!=='ENOENT')throw e;}}
 own.sort((a,b)=>a.name===id+'.json'?-1:b.name===id+'.json'?1:b.expiresAt-a.expiresAt);
 for(const item of own.slice(5))await rm(join(directory(),item.name),{force:true});
 return {id,key,expiresAt:value.expiresAt};
}
export async function claimPrintJob(id,key){
 if(!validId(id)||!validId(key))fail('This print link is invalid or expired. Print again from the Counter.',404,'print_job_unavailable');
 const file=join(directory(),id+'.json');let value;
 try{value=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')fail('This report was already opened or expired. Print again from the Counter.',410,'print_job_expired');throw e;}
 if(!timingSafeEqual(Buffer.from(value.hash),Buffer.from(digest(key))))fail('This print link is invalid.',403,'print_job_denied');
 if(value.expiresAt<=Date.now()){await rm(file,{force:true});fail('This print link expired. Print again from the Counter.',410,'print_job_expired');}
 try{await rename(file,file+'.claimed');}catch(e){if(e.code==='ENOENT')fail('This report was already opened.',410,'print_job_expired');throw e;}
 await rm(file+'.claimed',{force:true});
 return {title:value.title,orientation:value.orientation,document:validateReportTree(value.document)};
}
export const printJobClaimRouter=express.Router();
printJobClaimRouter.get('/jobs/:id',async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await claimPrintJob(req.params.id,req.get('X-Print-Token')));}catch(e){next(e);}});

setInterval(()=>void prunePrintJobs().catch(()=>console.error('Print snapshot cleanup could not complete.')),60000).unref();
