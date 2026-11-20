export const epsonUsbId={vendorId:0x04b8,productId:0x0202};
export function isEpsonTicketPrinter(device){return device.vendorId===epsonUsbId.vendorId&&device.productId===epsonUsbId.productId;}
export async function openEpsonPrinter(device){
 if(!device.opened)await device.open();
 const configurations=[device.configuration,...(device.configurations||[])].filter(Boolean);
 for(const configuration of configurations)for(const iface of configuration.interfaces)for(const alternate of iface.alternates||[iface.alternate]){
  const endpoint=alternate.endpoints.find(item=>item.direction==='out'&&item.type==='bulk');
  if(!endpoint)continue;
  if(device.configuration?.configurationValue!==configuration.configurationValue)await device.selectConfiguration(configuration.configurationValue);
  await device.claimInterface(iface.interfaceNumber);
  if(iface.alternate.alternateSetting!==alternate.alternateSetting)await device.selectAlternateInterface(iface.interfaceNumber,alternate.alternateSetting);
  return endpoint.endpointNumber;
 }
 throw Error('No compatible USB print interface was found. Choose 80 mm thermal portrait to use the installed Epson driver.');
}
export function epsonRasterBands(width,height,pixels){
 if(!Number.isInteger(width)||width<=0||width%8||!Number.isInteger(height)||height<=0||pixels.length!==width*height*4)throw Error('The receipt image could not be prepared.');
 const bands=[],rowBytes=width/8;
 for(let top=0;top<height;top+=256){
  const rows=Math.min(256,height-top),bytes=new Uint8Array(8+rowBytes*rows);
  bytes.set([0x1d,0x76,0x30,0,rowBytes&255,rowBytes>>8,rows&255,rows>>8]);
  for(let pixel=0;pixel<width*rows;pixel++){
   const offset=(top*width+pixel)*4;
   if((pixels[offset]*299+pixels[offset+1]*587+pixels[offset+2]*114)/1000<180)bytes[8+(pixel>>3)]|=0x80>>(pixel&7);
  }
  bands.push(bytes);
 }
 return bands;
}
export async function writeEpsonSlips(device,endpoint,slips,signal,timeout=15000){
 const send=async bytes=>{
  signal.throwIfAborted();let timer;
  try{
   const result=await Promise.race([device.transferOut(endpoint,bytes),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The printer stopped responding. Some slips may already have printed; reprint only missing slips.')),timeout);})]);
   if(result.status!=='ok'||result.bytesWritten!==bytes.length)throw Error('USB printing stopped before all slips finished. Check paper and connection, then reprint only missing slips.');
  }finally{clearTimeout(timer);}
 };
 await send(Uint8Array.of(0x1b,0x40));
 for(const bands of slips){
  for(const raster of bands)for(let offset=0;offset<raster.length;offset+=4096)await send(raster.subarray(offset,offset+4096));
  await send(Uint8Array.of(0x1d,0x56,66,0));
 }
}
