import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {X509Certificate} from 'node:crypto';
import https from 'node:https';
import {repairCertificateDates} from '../../deploy/windows/Repair-Certificate-Dates.mjs';
Object.assign(process.env,{DB_NAME:'certificate_repair_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone'});
const {createTerminalCertificates}=await import('../terminal/certificates.js');
const request=(port,ca)=>new Promise((resolveResponse,reject)=>{const req=https.get({hostname:'127.0.0.1',servername:'localhost',port,ca},res=>{res.resume();res.on('end',()=>resolveResponse(res.statusCode));});req.on('error',reject);});
const listen=options=>new Promise(resolveServer=>{const server=https.createServer(options,(_req,res)=>res.end('ok'));server.listen(0,'127.0.0.1',()=>resolveServer(server));});
const close=server=>new Promise(done=>server.close(done));
test('clock repair makes future-dated HTTPS trusted without replacing keys or changing the IP',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'madina-clock-cert-qa-'));
 const now=Date.now;let server;
 try{
  Date.now=()=>now()+13*3600000;
  try{await createTerminalCertificates(directory,'192.168.1.50');}finally{Date.now=now;}
  const originalCa=await readFile(join(directory,'ca.crt')),originalServer=await readFile(join(directory,'server.crt'));
  const caKey=await readFile(join(directory,'ca.key')),serverKey=await readFile(join(directory,'server.key'));
  server=await listen({key:serverKey,cert:originalServer});
  await assert.rejects(request(server.address().port,originalCa),e=>e.code==='CERT_NOT_YET_VALID');
  await close(server);server=null;
  const check=await repairCertificateDates(resolve('.'),directory,'192.168.1.50',{checkOnly:true});
  assert.ok(check.futureCa&&check.futureServer);assert.equal(check.changed,false);
  assert.deepEqual(await readFile(join(directory,'ca.crt')),originalCa);
  const result=await repairCertificateDates(resolve('.'),directory,'192.168.1.50');assert.equal(result.changed,true);
  assert.deepEqual(await readFile(join(directory,'ca.key')),caKey);assert.deepEqual(await readFile(join(directory,'server.key')),serverKey);
  const caPem=await readFile(join(directory,'ca.crt')),serverPem=await readFile(join(directory,'server.crt'));
  const ca=new X509Certificate(caPem),leaf=new X509Certificate(serverPem);
  assert.ok(leaf.verify(ca.publicKey));assert.equal(leaf.checkIP('192.168.1.50'),'192.168.1.50');assert.equal(leaf.checkIP('192.168.1.51'),undefined);
  assert.equal(leaf.validTo,new X509Certificate(originalServer).validTo);
  server=await listen({key:serverKey,cert:serverPem});assert.equal(await request(server.address().port,caPem),200);
  await assert.rejects(request(server.address().port,originalCa),e=>e.code==='CERT_NOT_YET_VALID');
  assert.equal((await repairCertificateDates(resolve('.'),directory,'192.168.1.50')).changed,false);
  await assert.rejects(repairCertificateDates(resolve('.'),directory,'192.168.1.51'),/does not match/);
  await assert.rejects(repairCertificateDates(resolve('.'),directory,'8.8.8.8'),/private IPv4/);
  await writeFile(join(directory,'ca.key'),serverKey);
  await assert.rejects(repairCertificateDates(resolve('.'),directory,'192.168.1.50',{now:now()-3600000}),/does not match/);
 }finally{Date.now=now;if(server)await close(server);await rm(directory,{recursive:true,force:true});}
});
