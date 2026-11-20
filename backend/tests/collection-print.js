import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionPrintAction} from '../../shared/collection-print.mjs';
import {isEpsonTicketPrinter,openEpsonPrinter,epsonRasterBands,writeEpsonSlips} from '../../shared/epson-usb.mjs';
test('collection switches independently select all four printing workflows',()=>{
 assert.equal(collectionPrintAction(false,false),'none');assert.equal(collectionPrintAction(false,true),'preview');
 assert.equal(collectionPrintAction(true,false),'print');assert.equal(collectionPrintAction(true,true),'preview-and-print');
});
test('Epson identification and alternate USB interface do not depend on the driver product name',async()=>{
 assert.equal(isEpsonTicketPrinter({vendorId:0x04b8,productId:0x0202,productName:'USB Printer'}),true);
 assert.equal(isEpsonTicketPrinter({vendorId:1,productId:0x0202}),false);
 const calls=[],alternate={alternateSetting:1,endpoints:[{direction:'out',type:'bulk',endpointNumber:3}]};
 const device={opened:false,configuration:null,configurations:[{configurationValue:2,interfaces:[{interfaceNumber:4,alternate:{alternateSetting:0,endpoints:[]},alternates:[alternate]}]}],
  open:async()=>calls.push('open'),selectConfiguration:async n=>calls.push(['configuration',n]),claimInterface:async n=>calls.push(['claim',n]),selectAlternateInterface:async(i,n)=>calls.push(['alternate',i,n])};
 assert.equal(await openEpsonPrinter(device),3);assert.deepEqual(calls,['open',['configuration',2],['claim',4],['alternate',4,1]]);
 await assert.rejects(openEpsonPrinter({opened:true,configurations:[]}),/No compatible USB print interface/);
});
test('long receipts are rasterized in bounded bands and each slip ends with its own cutter command',async()=>{
 const pixels=new Uint8ClampedArray(8*257*4).fill(255);pixels.set([0,0,0,255]);
 const bands=epsonRasterBands(8,257,pixels);assert.equal(bands.length,2);
 assert.deepEqual([...bands[0].slice(0,9)],[29,118,48,0,1,0,0,1,128]);assert.equal(bands[1][6],1);
 const sent=[];await writeEpsonSlips({transferOut:async(_,bytes)=>{sent.push([...bytes]);return {status:'ok',bytesWritten:bytes.length};}},1,[bands,bands],new AbortController().signal);
 assert.equal(sent.filter(bytes=>String(bytes)==='29,86,66,0').length,2);assert.deepEqual(sent.at(-1),[29,86,66,0]);
});
test('failed/blocked USB transfers are not retried or followed by a cut',async()=>{
 let calls=0;await assert.rejects(writeEpsonSlips({transferOut:async()=>{calls++;return {status:'stall',bytesWritten:0};}},1,[[new Uint8Array(8)]],new AbortController().signal),/stopped before all slips/);assert.equal(calls,1);
 await assert.rejects(writeEpsonSlips({transferOut:()=>new Promise(()=>{})},1,[],new AbortController().signal,5),/stopped responding/);
 const abort=new AbortController();abort.abort();await assert.rejects(writeEpsonSlips({transferOut:()=>{throw Error('Must not write');}},1,[],abort.signal),{name:'AbortError'});
});
