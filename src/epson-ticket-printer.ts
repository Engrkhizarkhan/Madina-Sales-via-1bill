import {epsonUsbId,isEpsonTicketPrinter,openEpsonPrinter,epsonRasterBands,writeEpsonSlips} from '../shared/epson-usb.mjs';
const printableDots=512;
let deviceQueue=Promise.resolve();
function withPrinter<T>(task:()=>Promise<T>):Promise<T>{const value=deviceQueue.then(task);deviceQueue=value.then(()=>undefined,()=>undefined);return value;}
function usbError(error:unknown):Error{
 if(error instanceof DOMException&&['NotSupportedError','SecurityError','NetworkError','InvalidStateError'].includes(error.name))return Error('The browser or installed driver cannot access this USB interface. Choose “80 mm thermal portrait” and print through the Counter shortcut using the Epson driver.');
 return error instanceof Error?error:Error('The USB printer could not finish. Check its paper and connection.');
}
export async function connectEpsonTicketPrinter(){
 if(!navigator.usb)throw Error('Direct USB printing is unavailable in this browser. In Firefox, choose 80 mm thermal portrait and use the Counter shortcut.');
 const printer=await navigator.usb.requestDevice({filters:[epsonUsbId]});
 if(!isEpsonTicketPrinter(printer))throw Error('Select the Epson TM-T88IV.');
 await withPrinter(async()=>{try{await openEpsonPrinter(printer);}catch(error){throw usbError(error);}finally{if(printer.opened)await printer.close().catch(()=>undefined);}});
}
export async function printEpsonTickets(source:HTMLElement,signal:AbortSignal){
 if(!navigator.usb)throw Error('Direct USB printing is unavailable here. Choose 80 mm thermal portrait for the installed Epson driver.');
 const printer=(await navigator.usb.getDevices()).find(isEpsonTicketPrinter);
 if(!printer)throw Error('The USB printer is not connected to this browser. Reconnect it in Settings, or choose 80 mm thermal portrait for the installed driver.');
 signal.throwIfAborted();
 const {getFontEmbedCSS,toCanvas}=await import('html-to-image');
 const slips:Uint8Array<ArrayBuffer>[][]=[];
 source.style.cssText='position:fixed;left:-10000px;top:0;max-width:none;margin:0;box-shadow:none;';document.body.append(source);
 try{
  await document.fonts.ready;const fontEmbedCSS=await getFontEmbedCSS(source);
  for(const slip of source.querySelectorAll<HTMLElement>('article')){
   signal.throwIfAborted();const {width,height}=slip.getBoundingClientRect();
   if(!width||!height)throw Error('The receipt has no printable size. Review its design settings.');
   const canvas=await toCanvas(slip,{backgroundColor:'white',canvasWidth:printableDots,canvasHeight:Math.ceil(height*printableDots/width),pixelRatio:1,fontEmbedCSS});
   const context=canvas.getContext('2d');if(!context)throw Error('The receipt image could not be prepared.');
   slips.push(epsonRasterBands(canvas.width,canvas.height,context.getImageData(0,0,canvas.width,canvas.height).data));
  }
 }finally{source.remove();}
 await withPrinter(async()=>{try{signal.throwIfAborted();const endpoint=await openEpsonPrinter(printer);await writeEpsonSlips(printer,endpoint,slips,signal);}catch(error){throw usbError(error);}finally{if(printer.opened)await printer.close().catch(()=>undefined);}});
}
