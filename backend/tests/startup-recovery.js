import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../public/startup.js',import.meta.url),'utf8');
function counter({active=false,retried=false,storageBlocked=false}={}){
  const timers=new Map(),listeners=new Map(),saved=new Map();
  if(retried)saved.set('madina-startup-retry:/manage','1');
  const node=()=>({children:[],attrs:{},style:{},setAttribute(name,value){this.attrs[name]=value;},hasAttribute(name){return Object.hasOwn(this.attrs,name);},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}});
  const root=node();const initial=node();if(!active)initial.setAttribute('data-madina-startup','');root.append(initial);
  let reloads=0,stops=0,mutate;
  const context={location:{pathname:'/manage',reload(){reloads++;}},document:{documentElement:node(),getElementById:()=>root,createElement:node},Array,
    sessionStorage:{getItem:key=>saved.get(key)||null,setItem(key,value){if(storageBlocked)throw Error('blocked');saved.set(key,value);},removeItem:key=>saved.delete(key)},
    window:{stop(){stops++;},addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}},
    MutationObserver:class{constructor(fn){mutate=fn;}observe(){}disconnect(){mutate=()=>{};}},
    setTimeout(fn,delay){timers.set(fn,delay);return fn;},clearTimeout(id){timers.delete(id);},
  };
  vm.runInNewContext(source,context);
  return {root,saved,listeners,timers,get reloads(){return reloads;},get stops(){return stops;},
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
