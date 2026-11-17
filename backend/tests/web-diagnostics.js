import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import express from 'express';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
Object.assign(process.env,{MADINA_ENV_FILE:'/nonexistent-madina-diag-qa.env',DB_NAME:'web_diagnostics_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone'});
const {createTerminalCertificates}=await import('../terminal/certificates.js');
const {createTerminalWeb}=await import('../terminal/web.js');
const {diagnosticsAllowed,inspectTerminalWeb,probeWebFile,webDiagnosticsHandler}=await import('../terminal/web-diagnostics.js');
const terminal={local:true,relayKey:'a'.repeat(64)};
const req=(key=terminal.relayKey,socket={remoteAddress:'127.0.0.1',encrypted:false})=>({socket,get:name=>name==='X-Madina-Diagnostic-Key'?key:undefined});

test('diagnostics require an independent secret and the authenticated local relay transport',()=>{
  assert.ok(diagnosticsAllowed(req(),terminal));
  for(const request of [req(''),req('b'.repeat(64)),req('é'.repeat(64)),req(undefined,{remoteAddress:'192.168.7.42',encrypted:false}),req(undefined,{remoteAddress:'127.0.0.1',encrypted:true})])assert.equal(diagnosticsAllowed(request,terminal),false);
  assert.equal(diagnosticsAllowed(req(),{...terminal,local:false}),false);
  assert.equal(diagnosticsAllowed(req(),{...terminal,relayKey:''}),false);
  assert.equal(diagnosticsAllowed({socket:{remoteAddress:'192.168.7.42'},get:()=>terminal.relayKey,ip:'127.0.0.1'},terminal),false);
});
test('unauthorized requests cannot run checks and concurrent checks share one bounded result',async()=>{
  let calls=0;
  const handler=webDiagnosticsHandler({terminal,inspect:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return {files:[{bytes:451354,matches:true}]};}});
  const response=()=>({statusCode:200,headers:{},status(code){this.statusCode=code;return this;},set(name,value){this.headers[name]=value;return this;},json(value){this.value=value;return this;}});
  const denied=response();await handler(req(''),denied,error=>{throw error;});assert.equal(denied.statusCode,403);assert.equal(calls,0);
  const results=await Promise.all(Array.from({length:12},async()=>{const res=response();await handler(req(),res,error=>{throw error;});return res;}));
  assert.equal(calls,1);
  for(const result of results){assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.value.files[0].bytes,451354);assert.ok(!JSON.stringify(result.value).includes(terminal.relayKey));}
  await handler(req(),response(),error=>{throw error;});assert.equal(calls,1);
});
test('HTTPS diagnostics verify full large-file transfers and report the exact partial transfer on timeout',async()=>{
  const base=await mkdtemp(join(tmpdir(),'madina-https-diag-qa-'));
  let server,stalled;
  try{
    const directory=join(base,'dist'),tls=join(base,'tls');await mkdir(join(directory,'assets'),{recursive:true});
    await createTerminalCertificates(tls,'192.168.7.243');
    const key=await readFile(join(tls,'server.key')),cert=await readFile(join(tls,'server.crt')),ca=await readFile(join(tls,'ca.crt'));
    const options={key,cert,ca,requestCert:true,rejectUnauthorized:false,minVersion:'TLSv1.2'};
    const expected=randomBytes(451354);
    await writeFile(join(directory,'assets','index-DIAGTEST.js'),expected);
    await writeFile(join(directory,'assets','index-DIAGTEST.css'),'/* CSS */'+ 'x'.repeat(100000));
    await writeFile(join(directory,'startup.js'),'/* small startup */');
    await writeFile(join(directory,'index.html'),'<script type="module" src="/assets/index-DIAGTEST.js"></script><link rel="stylesheet" href="/assets/index-DIAGTEST.css">');
    server=https.createServer(options,createTerminalWeb(express(),{directory,assets:join(directory,'assets')})).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const state={...terminal,directory:base,localOrigin:'https://192.168.7.243:8443',httpsPort:server.address().port};
    const report=await inspectTerminalWeb({directory,terminal:state});
    assert.equal(report.files.length,5);
    assert.ok(report.files.every(file=>file.matches&&file.complete&&file.bytes===file.expectedBytes));
    assert.deepEqual(report.files.filter(file=>file.path.endsWith('.js')&&file.path.startsWith('/assets/')).map(file=>file.protocol).sort(),['TLSv1.2','TLSv1.3','TLSv1.3']);
    assert.equal(report.files.find(file=>file.readDelay===20).matches,true);
    const untrusted=await probeWebFile({port:state.httpsPort,ca:Buffer.from(''),path:'/assets/index-DIAGTEST.js',expected,version:'TLSv1.2'});
    assert.equal(untrusted.matches,false);assert.equal(untrusted.bytes,0);assert.ok(untrusted.error);
    stalled=https.createServer(options,(_req,res)=>{res.writeHead(200,{'Content-Length':expected.length});res.write(expected.subarray(0,65536));}).listen(0,'127.0.0.1');
    await new Promise(resolve=>stalled.once('listening',resolve));
    const partial=await probeWebFile({port:stalled.address().port,ca,path:'/assets/index-DIAGTEST.js',expected,version:'TLSv1.2',timeout:1000});
    assert.equal(partial.status,200);assert.equal(partial.bytes,65536);assert.equal(partial.expectedBytes,451354);
    assert.equal(partial.error,'TRANSFER_TIMEOUT');assert.equal(partial.complete,false);assert.equal(partial.matches,false);
  }finally{
    for(const instance of [server,stalled])if(instance){instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));}
    await rm(base,{recursive:true,force:true});
  }
});
