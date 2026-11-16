import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateReportTree,reportProtocol} from '../../shared/report-print.mjs';
Object.assign(process.env,{DB_NAME:'print_job_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone'});
const {createPrintJob,claimPrintJob,clearPrintJobs,printJobSnapshot}=await import('../node/print-jobs.js');
const {maintenance}=await import('../update/maintenance.js');
const document={tag:'article',attrs:{class:'print-document operations-document report-a4'},children:[{tag:'h1',attrs:{},children:['MADINA EXPRESS']},{tag:'p',attrs:{lang:'ur',dir:'rtl'},children:['مدینہ ایکسپریس']},{tag:'table',attrs:{},children:[{tag:'colgroup',attrs:{},children:[{tag:'col',attrs:{style:'width: 17%;'},children:[]}]}]}]};
test('maintenance clears only bounded print snapshots and blocks new snapshots until cleanup finishes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'madina-print-reset-'));process.env.PRINT_JOB_DIRECTORY=directory;
 try{
  const body={title:'CNIC sheet',orientation:'landscape',document};await createPrintJob(body,1);
  await writeFile(join(directory,'unrelated.json'),'keep');
  assert.equal((await printJobSnapshot()).length,1);
  assert.ok(maintenance.beginOwnerMaintenance(0));
  try{await assert.rejects(createPrintJob(body,1),error=>error.status===503);assert.equal(await clearPrintJobs(),1);}finally{maintenance.endOwnerMaintenance();}
  assert.deepEqual(await readdir(directory),['unrelated.json']);
  assert.equal(await readFile(join(directory,'unrelated.json'),'utf8'),'keep');
 }finally{await rm(directory,{recursive:true,force:true});delete process.env.PRINT_JOB_DIRECTORY;}
});
test('report snapshots remain inert and retain Urdu/table layout',()=>{assert.deepEqual(validateReportTree(document),document);for(const bad of [{...document,tag:'script'},{...document,attrs:{onclick:'alert(1)'}},{...document,children:[{tag:'img',attrs:{src:'https://evil'},children:[]}]},{...document,attrs:{style:'background:url(https://evil)'}},{...document,attrs:{class:'bad" onclick="x'}}])assert.throws(()=>validateReportTree(bad));const text={...document,children:['<script>secret()</script>']};assert.equal(validateReportTree(text).children[0],text.children[0]);});
test('A4 handoff is expiring, one-use, private and cannot create account sessions',async()=>{const directory=await mkdtemp(join(tmpdir(),'madina-print-qa-'));process.env.PRINT_JOB_DIRECTORY=directory;try{const body={title:'CNIC sheet',orientation:'landscape',document};const job=await createPrintJob(body,1);const url=reportProtocol('https://192.168.1.50:8443',job.id,job.key);assert.ok(url.startsWith('madina-report://print/'));await assert.rejects(claimPrintJob(job.id,'0'.repeat(64)),e=>e.status===403);assert.deepEqual((await claimPrintJob(job.id,job.key)).document,document);await assert.rejects(claimPrintJob(job.id,job.key),e=>e.status===410);const expired=await createPrintJob(body,1),file=join(directory,expired.id+'.json'),value=JSON.parse(await readFile(file,'utf8'));value.expiresAt=0;await writeFile(file,JSON.stringify(value));await assert.rejects(claimPrintJob(expired.id,expired.key),e=>e.status===410);for(let n=0;n<8;n++)await createPrintJob(body,1);assert.equal((await readdir(directory)).length,5);const race=await createPrintJob(body,1);const outcomes=await Promise.allSettled([claimPrintJob(race.id,race.key),claimPrintJob(race.id,race.key)]);assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);await assert.rejects(claimPrintJob('../config','a'.repeat(64)),e=>e.status===404);}finally{await rm(directory,{recursive:true,force:true});delete process.env.PRINT_JOB_DIRECTORY;}});
