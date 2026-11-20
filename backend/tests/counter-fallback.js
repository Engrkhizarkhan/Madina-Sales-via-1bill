import test from 'node:test';
import assert from 'node:assert/strict';
import {onlineCounterUrl,onlineCounterPreferences} from '../../shared/counter-fallback.mjs';
import {terminalOrigin} from '../../shared/domains.mjs';

test('only the private HTTPS counter can offer the fixed enrolled-device relay',()=>{
  for(const host of ['192.168.7.243','10.0.0.1','172.16.0.1','172.31.255.254']){
    for(const path of ['/manage','/login'])assert.equal(new URL(onlineCounterUrl(`https://${host}:8443${path}`)).origin,terminalOrigin);
  }
  for(const href of ['invalid','http://192.168.7.243:8443/manage','https://192.168.7.243/manage','https://127.0.0.1:8443/manage','https://172.32.0.1:8443/manage','https://staff.madinaexpress.pk/manage','https://example.com:8443/manage','https://192.168.7.243:8443/print/report','https://user:password@192.168.7.243:8443/manage'])assert.equal(onlineCounterUrl(href),null,href);
});
test('fallback excludes credentials, passenger data, arbitrary destinations and unknown query flags',()=>{
  const href=onlineCounterUrl('https://192.168.7.243:8443/manage?counterPrint=silent&a4Bridge=1&view=reports&next=https://evil.invalid&password=secret&trip=personal&fallbackPaper=evil#token',{autoPrint:false,paper:'a4'});
  const url=new URL(href);assert.equal(url.origin,terminalOrigin);assert.equal(url.pathname,'/login');assert.equal(url.hash,'');assert.equal(url.username,'');
  assert.deepEqual([...url.searchParams], [['counterFallback','lan'],['counterPrint','silent'],['a4Bridge','1'],['view','reports'],['fallbackAutoPrint','0'],['fallbackPaper','a4']]);
  const invalid=new URL(onlineCounterUrl('https://192.168.7.243:8443/manage?counterPrint=evil&a4Bridge=2&view=admin',{autoPrint:'true',paper:'arbitrary'}));
  assert.deepEqual([...invalid.searchParams],[['counterFallback','lan']]);
});
test('only a marked fallback on the approved origin restores non-secret print preferences',()=>{
  for(const paper of ['thermal','tm-t88iv','a4']){
    const href=onlineCounterUrl('https://192.168.7.243:8443/login?view=reports',{autoPrint:true,paper});
    assert.deepEqual(onlineCounterPreferences(href),{autoPrint:true,paper,reports:true});
  }
  assert.deepEqual(onlineCounterPreferences(terminalOrigin+'/login?counterFallback=lan&fallbackAutoPrint=evil&fallbackPaper=bad'),{autoPrint:undefined,paper:undefined,reports:false});
  for(const href of [terminalOrigin+'/login?fallbackAutoPrint=1','https://evil.invalid/login?counterFallback=lan&fallbackAutoPrint=1',terminalOrigin+'/check?counterFallback=lan'])assert.equal(onlineCounterPreferences(href),null);
});
