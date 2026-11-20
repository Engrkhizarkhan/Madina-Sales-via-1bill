import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
Object.assign(process.env,{MADINA_ENV_FILE:'/nonexistent-madina-web-qa.env',DB_NAME:'terminal_web_qa',DB_USER:'qa',DB_PASSWORD:'unused',TERMINAL_ROLE:'standalone'});
const {createTerminalWeb}=await import('../terminal/web.js');

test('local counters reuse only fingerprinted files while HTML and customer data remain private',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'madina-web-qa-'));
  let server;
  try{
    const assets=join(directory,'retained-assets');
    await mkdir(assets);await mkdir(join(directory,'assets'));
    const bytes='/* complete build file */'+ 'x'.repeat(512000);
    await writeFile(join(assets,'index-ABCD1234.js'),bytes);
    await writeFile(join(directory,'assets','index-EFGH5678.css'),'body{color:green}');
    await writeFile(join(assets,'unversioned.js'),'not fingerprinted');
    await writeFile(join(directory,'index.html'),'<div id="root">fresh release</div>');
    await writeFile(join(directory,'startup.js'),'/* startup recovery */');
    const api=express();api.get('/health',(_req,res)=>res.json({status:'ok'}));
    api.get('/customer',(_req,res)=>res.json({passenger:'Private customer'}));
    server=createTerminalWeb(api,{directory,assets}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    const asset=await fetch(origin+'/assets/index-ABCD1234.js');
    assert.equal(await asset.text(),bytes);assert.match(asset.headers.get('content-type'),/javascript/);
    assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable');
    const unchanged=await new Promise((resolve,reject)=>{
      const request=http.get(origin+'/assets/index-ABCD1234.js',{headers:{'If-None-Match':asset.headers.get('etag')}},response=>{
        let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>resolve({status:response.statusCode,text}));
      });request.on('error',reject);
    });
    assert.equal(unchanged.status,304);assert.equal(unchanged.text,'');
    const nextBuild=await fetch(origin+'/assets/index-EFGH5678.css');
    assert.equal(nextBuild.status,200);assert.equal(await nextBuild.text(),'body{color:green}');
    assert.match(nextBuild.headers.get('cache-control'),/immutable/);
    for(const path of ['/manage','/login','/print/report','/index.html','/startup.js','/api/health','/api/customer','/assets/unversioned.js']){
      const response=await fetch(origin+path);await response.text();
      assert.equal(response.status,200,path);assert.match(response.headers.get('cache-control'),/no-store/,path);
    }
    const missing=await fetch(origin+'/assets/index-MISSING1.js');
    assert.equal(missing.status,404);assert.doesNotMatch(await missing.text(),/fresh release/);
    assert.match(missing.headers.get('cache-control'),/no-store/);
    const embedded=await fetch(origin+'/browser-recovery');assert.equal(embedded.status,404);assert.equal(embedded.headers.get('clear-site-data'),null);
    const repair=await fetch(origin+'/browser-recovery',{headers:{'X-Madina-Recovery':'startup'}});assert.equal(repair.status,204);assert.equal(repair.headers.get('clear-site-data'),'"cache"');assert.match(repair.headers.get('cache-control'),/no-store/);assert.equal(repair.headers.get('set-cookie'),null);
    const concurrent=await Promise.all(Array.from({length:12},async()=>{
      const response=await fetch(origin+'/assets/index-ABCD1234.js');
      assert.equal(response.status,200);assert.equal(await response.text(),bytes);
    }));assert.equal(concurrent.length,12);
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await rm(directory,{recursive:true,force:true});
  }
});
