export const epsonUsbId:{vendorId:number;productId:number};
export function isEpsonTicketPrinter(device:USBDevice):boolean;
export function openEpsonPrinter(device:USBDevice):Promise<number>;
export function epsonRasterBands(width:number,height:number,pixels:Uint8ClampedArray):Uint8Array<ArrayBuffer>[];
export function writeEpsonSlips(device:USBDevice,endpoint:number,slips:Uint8Array<ArrayBuffer>[][],signal:AbortSignal,timeout?:number):Promise<void>;
