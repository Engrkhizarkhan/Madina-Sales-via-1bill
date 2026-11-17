import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {networkInterfaces} from 'node:os';
import {createTransferMonitor} from '../terminal/web-transfers.js';
import {readWindowsNetwork} from '../terminal/windows-network.js';
const fake=()=>{
  const socket={remoteAddress:'192.168.7.42',bytesWritten:100,writableLength:64000,writableNeedDrain:true,destroyed:false,getProtocol:()=> 'TLSv1.3'};
  const req={path:'/assets/index-DIAGTEST.js',method:'GET',socket,headers:{cookie:'private-cookie'},url:'/assets/index-DIAGTEST.js?key=private-key'};
  const res=Object.assign(new EventEmitter(),{statusCode:200,getHeader:()=>451354,writableLength:65536,writableFinished:false});
  return {req,res,socket};
};
test('observation identifies pending remote files without touching response writes or saving session data',()=>{
  let time=1000,next=0;const monitor=createTransferMonitor({clock:()=>time});const {req,res,socket}=fake();
  monitor.observe(req,res,()=>{next++;});res.emit('pipe',{bytesRead:131072,readableLength:65536,readableFlowing:false,readableEnded:false,destroyed:false,path:'private-file-path'});
  req.path='/index-DIAGTEST.js';time=3000;socket.bytesWritten=65636;
  const pending=monitor.snapshot().active[0];
  assert.equal(next,1);assert.equal(pending.path,'/assets/index-DIAGTEST.js');assert.equal(pending.socketBytesWritten,65536);
  assert.equal(pending.waitingForDrain,true);assert.equal(pending.milliseconds,2000);assert.equal(pending.expectedBytes,451354);
  assert.equal(pending.source.bytesRead,131072);assert.equal(pending.source.bufferBytes,65536);assert.equal(pending.source.flowing,false);
  assert.ok(!JSON.stringify(monitor.snapshot()).includes('private-'));
  res.writableFinished=true;res.writableLength=0;socket.writableLength=0;socket.bytesWritten=451454;
  res.emit('finish');res.emit('close');assert.equal(monitor.snapshot().active.length,0);
  assert.equal(monitor.snapshot().recent.length,1);assert.equal(monitor.snapshot().recent[0].event,'finish');
  assert.equal(monitor.snapshot().recent[0].socketBytesWritten,451354);
});
test('observation is bounded and excludes APIs, customer documents and local operator probes',()=>{
  const monitor=createTransferMonitor({limit:2});
  for(const path of ['/api/bookings','/manage','/reservation.pdf']){const {req,res}=fake();req.path=path;monitor.observe(req,res,()=>{});}
  for(const ip of ['127.0.0.1','::ffff:127.0.0.1','::1']){const {req,res,socket}=fake();socket.remoteAddress=ip;monitor.observe(req,res,()=>{});}
  assert.equal(monitor.snapshot().active.length,0);
  const [a,b,c]=[fake(),fake(),fake()];for(const f of [a,b,c])monitor.observe(f.req,f.res,()=>{});
  assert.equal(monitor.snapshot().active.length,2);a.res.emit('close');b.res.emit('close');
  assert.equal(monitor.snapshot().recent.length,2);monitor.observe(c.req,c.res,()=>{});c.res.emit('close');assert.equal(monitor.snapshot().recent.length,2);
});
test('Windows networking inspection invokes only the fixed read-only script with a validated LAN address',async()=>{
  const calls=[];const run=async(...args)=>{calls.push(args);return {stdout:'\uFEFF{"address":"192.168.7.243","adapters":[]}'};};
  assert.equal((await readWindowsNetwork('192.168.7.243',{platform:'win32',run})).available,true);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'powershell.exe');
  assert.ok(calls[0][1].some(arg=>arg.endsWith('Read-Terminal-Network.ps1')));
  assert.deepEqual(calls[0][1].slice(-2),['-Address','192.168.7.243']);assert.equal(calls[0][2].timeout,12000);
  for(const address of ['192.168.7.243; Get-Content secrets','127.0.0.1','https://evil.invalid','8.8.8.8'])assert.equal((await readWindowsNetwork(address,{platform:'win32',run})).available,false);
  assert.equal((await readWindowsNetwork('192.168.7.243',{platform:'linux',run})).available,false);assert.equal(calls.length,1);
  const failed=await readWindowsNetwork('192.168.7.243',{platform:'win32',run:async()=>{throw Error('private process detail');}});
  assert.deepEqual(failed,{available:false,reason:'diagnostic-unavailable'});
});
test('Windows reader produces a real bounded network report',{skip:process.platform!=='win32'},async()=>{
  const adapter=Object.values(networkInterfaces()).flat().find(row=>row.family==='IPv4'&&!row.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(row.address));
  assert.ok(adapter,'Windows CI must have its private LAN interface');
  const result=await readWindowsNetwork(adapter.address);
  assert.equal(result.available,true);assert.equal(result.report.address,adapter.address);
  assert.ok(result.report.interfaces.some(row=>row.IPAddress===adapter.address));
  assert.ok(Array.isArray(result.report.adapters));assert.ok(Array.isArray(result.report.warnings));
});
