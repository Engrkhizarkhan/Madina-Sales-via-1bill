import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {onlineCounterUrl} from '../../shared/counter-fallback.mjs';
const template=await readFile(new URL('../../public/startup.js',import.meta.url),'utf8');
const source=template.replace('/*__COUNTER_FALLBACK_HELPER__*/',`var onlineCounterUrlForStartup = ${onlineCounterUrl.toString()};`);
function counter({active=false,retried=false,storageBlocked=false,href="https://staff.madinaexpress.pk/manage",online=true,preferences={}}={}){
  const timers=new Map(),listeners=new Map(),saved=new Map();
  if(retried)saved.set('madina-startup-retry:/manage','1');
  const node=()=>({children:[],attrs:{},style:{},setAttribute(name,value){this.attrs[name]=value;},hasAttribute(name){return Object.hasOwn(this.attrs,name);},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}});
  const root=node();const initial=node();if(!active)initial.setAttribute('data-madina-startup','');root.append(initial);
  let reloads=0,stops=0,mutate;const navigations=[],images=[];
  const context={URL,navigator:{onLine:online},Image:class{constructor(){images.push(this);}},localStorage:{getItem:key=>preferences[key]??null},location:{href,pathname:'/manage',reload(){reloads++;},assign(url){navigations.push(url);}},document:{documentElement:node(),getElementById:()=>root,createElement:node},Array,
    sessionStorage:{getItem:key=>saved.get(key)||null,setItem(key,value){if(storageBlocked)throw Error('blocked');saved.set(key,value);},removeItem:key=>saved.delete(key)},
    window:{stop(){stops++;},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}},
    MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){mutate=()=>{};}},
    setTimeout(fn,delay){timers.set(fn,delay);return fn;},clearTimeout(id){timers.delete(id);},
  };
  vm.runInNewContext(source,context);
  return {root,saved,listeners,timers,images,navigations,get reloads(){return reloads;},get stops(){return stops;},
    timeout(){const fn=[...timers.keys()][0];assert.ok(fn);timers.delete(fn);fn();},
    render(){root.replaceChildren(node());mutate();},
    error(target){listeners.get('error')?.({target});},
  };
}
test('a stalled startup retries once and preserves the current address',()=>{
  const page=counter();page.timeout();assert.equal(page.reloads,1);assert.equal(page.stops,1);
  assert.equal(page.saved.get('madina-startup-retry:/manage'),'1');
  assert.doesNotMatch(source,/location\.(?:href|search)\s*=/);
});
test('a second failed startup offers an explicit retry without a reload loop',()=>{
  const page=counter({retried:true});page.timeout();assert.equal(page.reloads,0);
  const panel=page.root.children[0];assert.equal(panel.attrs.role,'alert');
  assert.match(panel.children[0].textContent,/could not finish/);
  panel.children[2].onclick();assert.equal(page.reloads,1);assert.equal(page.saved.size,0);
});
test('an active counter is never reloaded by the watchdog or later resource errors',()=>{
  for(const alreadyRendered of [false,true]){
    const page=counter({active:alreadyRendered,retried:true});
    if(!alreadyRendered)page.render();
    assert.equal(page.timers.size,0);assert.equal(page.saved.size,0);assert.equal(page.listeners.size,0);
    page.error({tagName:'SCRIPT',type:'module'});assert.equal(page.reloads,0);assert.equal(page.stops,0);
  }
});
test('a failed entry script or stylesheet recovers promptly, but optional images do not reload',()=>{
  for(const target of [{tagName:'SCRIPT',type:'module'},{tagName:'LINK',rel:'stylesheet'}]){
    const page=counter();page.error(target);assert.deepEqual([...page.timers.values()],[500]);page.timeout();assert.equal(page.reloads,1);
  }
  const page=counter();page.error({tagName:'IMG'});assert.deepEqual([...page.timers.values()],[15000]);
});
test('disabled browser storage cannot cause repeated automatic reloads',()=>{
  const page=counter({storageBlocked:true});page.timeout();assert.equal(page.reloads,0);assert.equal(page.root.children[0].attrs.role,'alert');
});

test('a second stalled LAN startup uses only the approved online counter and retains printer preferences',()=>{
  const page=counter({retried:true,href:'https://192.168.7.243:8443/manage?counterPrint=silent&a4Bridge=1&token=secret',preferences:{'madina.autoPrintTickets':'true','madina.ticketPaper':'thermal'}});
  page.timeout();assert.equal(page.images.length,1);assert.match(page.images[0].src,/^https:\/\/staff\.madinaexpress\.duckdns\.org\/favicon.svg/);
  assert.equal(page.images[0].referrerPolicy,'no-referrer');page.images[0].onload();
  assert.equal(page.navigations.length,1);const target=new URL(page.navigations[0]);
  assert.equal(target.origin,'https://staff.madinaexpress.duckdns.org');assert.equal(target.pathname,'/login');
  assert.equal(target.searchParams.get('counterPrint'),'silent');assert.equal(target.searchParams.get('a4Bridge'),'1');
  assert.equal(target.searchParams.get('fallbackAutoPrint'),'1');assert.equal(target.searchParams.get('fallbackPaper'),'thermal');
  assert.equal(target.searchParams.has('token'),false);assert.equal(page.reloads,0);
});
test('offline or unreachable internet leaves a manual option without a redirect loop',()=>{
  const href='https://192.168.7.243:8443/manage';
  const offline=counter({retried:true,href,online:false});offline.timeout();
  assert.equal(offline.images.length,0);assert.equal(offline.navigations.length,0);assert.equal(offline.root.children[0].children[3].textContent,'Use online counter');
  const failed=counter({retried:true,href});failed.timeout();failed.images[0].onerror();assert.equal(failed.navigations.length,0);
  const timeout=counter({retried:true,href});timeout.timeout();timeout.timeout();assert.equal(timeout.images[0].onload,null);assert.equal(timeout.navigations.length,0);
});
test('a late app render cancels automatic fallback and active work never redirects',()=>{
  const href='https://192.168.7.243:8443/manage';
  const late=counter({retried:true,href});late.timeout();late.render();late.images[0].onload();assert.equal(late.navigations.length,0);
  const active=counter({active:true,retried:true,href});assert.equal(active.timers.size,0);assert.equal(active.images.length,0);
});
