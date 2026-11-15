import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {run} from '../../deploy/updater/windows-agent.mjs';

for(const cloudReachable of [true,false])test(`Windows reports a damaged state locally and preserves its release history (cloud ${cloudReachable?'available':'offline'})`,{skip:process.platform!=='win32'},async()=>{
 const base=await mkdtemp(join(tmpdir(),'madina-windows-update-')),originalFetch=globalThis.fetch;
 const previous={application:join(base,'application'),releaseId:'r-123456789abc',sequence:33,version:'3.2.3'},damaged=Buffer.alloc(128),reports=[],requests=[];
 try{
  for(const name of ['host','config','data/tls'])await mkdir(join(base,name),{recursive:true});
  await writeFile(join(base,'host/updater.json'),JSON.stringify({project:'madina-express',cloudOrigin:'https://example.invalid'}));
  await writeFile(join(base,'host/current.json'),JSON.stringify(previous));
  await writeFile(join(base,'host/update-state.json'),damaged);
  await writeFile(join(base,'host/release-public-key.pem'),await readFile(resolve('deploy/updater/release-public-key.pem')));
  await writeFile(join(base,'config/backend.env'),'NODE_API_PORT=43101\nTERMINAL_INSTALL_TOKEN=fixture\nTERMINAL_INSTALLATION_ID=fixture\nUPDATE_CONTROL_KEY=fixture\n');
  await writeFile(join(base,'data/tls/ca.crt'),'unused fixture: no application restart is permitted');
  globalThis.fetch=async(url,options={})=>{
   requests.push(String(url));
   if(String(url).endsWith('/internal-update/status'))return Response.json({draining:false,activeWrites:0,quietSeconds:100});
   if(String(url).endsWith('/terminal-sync/update-channel'))return Response.json({paused:false,manifest:{}});
   if(String(url).endsWith('/terminal-sync/update-status')){
    reports.push(JSON.parse(options.body));
    if(!cloudReachable)throw new Error('cloud connection lost');
    return Response.json({ok:true});
   }
   throw new Error('Unexpected updater operation: '+url);
  };
  await assert.rejects(run(base),error=>error.code==='INVALID_UPDATER_JSON'&&error.file===join(base,'host/update-state.json'));
  const status=JSON.parse(await readFile(join(base,'data/update-status.json'),'utf8'));
  assert.equal(status.stage,'deferred');assert.match(status.message,/update-state\.json/);
  assert.equal(reports.length,1);assert.equal(reports[0].stage,'deferred');assert.equal(reports[0].message,status.message);
  assert.deepEqual(await readFile(join(base,'host/update-state.json')),damaged);
  assert.deepEqual(JSON.parse(await readFile(join(base,'host/current.json'),'utf8')),previous);
  assert.equal(requests.some(url=>url.endsWith('/drain')),false);
 }finally{globalThis.fetch=originalFetch;await rm(base,{recursive:true,force:true});}
});
