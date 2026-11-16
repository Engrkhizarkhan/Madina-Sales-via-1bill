import test from 'node:test';
import assert from 'node:assert/strict';
import {currentRoutePricing,seatFare} from '../../shared/service-pricing.mjs';
const bus={id:'standard49',seats:49};
const route=fare=>({id:'kohat',to:'Kohat',boarding:'Saved terminal',fare,destinations:[],services:[{busId:bus.id,times:['10:00'],fares:{Kohat:{}}}]});
test('existing Kohat departures quote the new base fare without rewriting the snapshot or old ticket',()=>{
 const snapshot=Object.freeze(route(550)),current=Object.freeze({...route(500),boarding:'Current terminal'}),ticket=Object.freeze({fare:550,paid:550});
 const priced=currentRoutePricing(snapshot,current);
 assert.equal(seatFare(priced,bus,'Kohat',1),500);
 assert.equal(priced.boarding,'Saved terminal');
 assert.equal(snapshot.fare,550);assert.deepEqual(ticket,{fare:550,paid:550});assert.equal(current.fare,500);
});
test('current explicit destination and class fares still override the base fare',()=>{
 const snapshot=route(550),current={...route(500),destinations:[{name:'Kohat',fare:510}],services:[{busId:bus.id,times:['10:00'],fares:{Kohat:{Standard:525}}}]};
 assert.equal(seatFare(currentRoutePricing(snapshot,current),bus,'Kohat',1),525);
 current.services=[];
 assert.equal(seatFare(currentRoutePricing(snapshot,current),bus,'Kohat',1),510);
});
test('removing a service override uses the current base fare instead of the old override',()=>{
 const snapshot=route(550);snapshot.services[0].fares.Kohat.Standard=550;
 assert.equal(seatFare(currentRoutePricing(snapshot,route(500)),bus,'Kohat',1),500);
});
test('unsaved departures and historical routes retain their existing fallback behavior',()=>{
 const snapshot=route(550),current=route(500);
 assert.equal(currentRoutePricing(undefined,current),current);
 assert.equal(currentRoutePricing(snapshot,undefined),snapshot);
 assert.equal(currentRoutePricing(undefined,undefined),undefined);
});
