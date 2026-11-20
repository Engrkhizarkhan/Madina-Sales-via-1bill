import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {presenceSummary,qualityBars,startCounterPresence} from '../../shared/terminal-presence.mjs';
import {validateReportTree} from '../../shared/report-print.mjs';
import {receiptDefaults,voucherStyle} from '../../shared/receipt-layout.mjs';
const contact=(extra={})=>({ageMs:1000,lastSeen:'2026-11-20T00:00:00Z',phase:'ready',transport:'lan',rtt_ms:12,download_mbps:24,loss_pct:0,probe_ok:1,version:'3.5.0',...extra});
test('PC status distinguishes a stalled tab, recent working tab, stale browser and unavailable main PC',()=>{
 assert.equal(presenceSummary([],true,false).status,'not-enrolled');
 assert.equal(presenceSummary([],true,true).status,'never-seen');
 assert.equal(presenceSummary([contact({ageMs:90001})],true,true).status,'offline');
 const value=presenceSummary([contact({ageMs:100,phase:'opening'}),contact({ageMs:1000,transport:'online'})],true,true);
 assert.equal(value.status,'online');assert.equal(value.localOpening,true);assert.equal(value.transport,'online');
 const unknown=presenceSummary([contact()],false,true);assert.equal(unknown.status,'unknown');assert.equal(qualityBars(unknown),0);
 assert.equal(presenceSummary([contact({phase:'opening'})],true,true).status,'opening');
 for(const [changes,bars] of [[{},4],[{rtt_ms:150},3],[{loss_pct:10},2],[{probe_ok:0},1],[{loss_pct:50},1],[{download_mbps:.2},1],[{download_mbps:1},2],[{download_mbps:4},3]])assert.equal(qualityBars(presenceSummary([contact(changes)],true,true)),bars);
});
function client({href='https://192.168.7.243:8443/manage',phase='opening',fetcher}={}){
 let time=0,id=0;const timers=new Map(),calls=[];
 const context={URL,AbortController,location:{href},crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789abc'},sessionStorage:{getItem:()=>null,setItem:()=>{}},performance:{now:()=>time},Date:{now:()=>time},document:{visibilityState:'visible',getElementById:()=>({children:phase==='opening'?[{hasAttribute:()=>true}]:[{hasAttribute:()=>false}]})},addEventListener:()=>{},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(path,options)=>{calls.push({path,options});return fetcher?fetcher(path,options):{status:200,ok:true,arrayBuffer:async()=>new ArrayBuffer(path.includes('probe')?98304:11)};}};
 vm.runInNewContext('('+startCounterPresence.toString()+')("3.5.0")',context);
 return {calls,async tick(ms){time+=ms;const due=[...timers.entries()].filter(([,t])=>t.at<=time);for(const [id,t]of due){timers.delete(id);t.fn();}for(let n=0;n<12;n++)await Promise.resolve();}};
}
test('the startup contact runs even when the app bundle never opens, without a reload or form mutation',async()=>{
 const page=client();await page.tick(250);assert.equal(page.calls.length,1);
 const body=JSON.parse(page.calls[0].options.body);assert.equal(body.phase,'opening');assert.equal(body.version,'3.5.0');assert.equal(body.instance.length,32);assert.equal(body.slot,undefined);
 await page.tick(5000);assert.ok(page.calls.some(call=>call.path.includes('/probe')));
 await page.tick(15000);assert.equal(JSON.parse(page.calls.at(-1).options.body).probeOk,true);
 const ready=client({phase:'ready'});await ready.tick(250);assert.equal(JSON.parse(ready.calls[0].options.body).phase,'ready');
 const publicPage=client({href:'https://madinaexpress.pk/'});await publicPage.tick(10000);assert.equal(publicPage.calls.length,0);
});
test('a response body stalled after headers is aborted, then a later contact can recover',async()=>{
 let aborted=false;
 const page=client({fetcher:async(_path,{signal})=>({status:200,ok:true,arrayBuffer:()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('deadline'));},{once:true}))})});
 await page.tick(250);await page.tick(4000);assert.equal(aborted,true);await page.tick(15000);assert.equal(page.calls.filter(call=>call.path.includes('heartbeat')).length,2);
});
test('A4 voucher snapshots preserve only approved layout variables and reject arbitrary styles or URLs',()=>{
 const style=Object.entries(voucherStyle(receiptDefaults)).map(([key,value])=>`${key}: ${value}`).join('; ');
 const tree={tag:'article',attrs:{class:'print-document document-terminal-a4',style},children:['Urdu and collection totals stay in the report']};
 assert.deepEqual(validateReportTree(tree),tree);
 for(const style of ['background:url(https://evil.invalid)','--voucher-font:Arial;display:none','--voucher-font-size:NaNpx','--voucher-font-size:12px;--voucher-font-size:20px','--voucher-font:Arial; color:red'])assert.throws(()=>validateReportTree({...tree,attrs:{style}}));
});

test('temporary cloud fallback during a main-PC restart retries instead of permanently stopping reporting',async()=>{
 let count=0;
 const page=client({fetcher:async()=>{const ok=++count>1;return {status:ok?200:503,ok,arrayBuffer:async()=>new ArrayBuffer(0)};}});
 await page.tick(250);await page.tick(15000);
 assert.equal(page.calls.filter(call=>call.path.includes('heartbeat')).length,2);
 const restored=JSON.parse(page.calls.filter(call=>call.path.includes('heartbeat'))[1].options.body);assert.equal(restored.lossPct,100);
});
