export type ReceiptLayout = {
  businessName:string;brandMark:string;contact:string;terminal:string;website:string;tokenTitle:string;
  urduTerms:string;tokenNote:string;font:string;fontSize:number;headingSize:number;seatSize:number;urduSize:number;
  paddingX:number;paddingY:number;lineHeight:number;qrSize:number;showQr:boolean;showWebsite:boolean;
};
export const receiptDefaults: Readonly<ReceiptLayout>;
export const receiptFonts: string[];
export const receiptNumberBounds: Record<'fontSize'|'headingSize'|'seatSize'|'urduSize'|'paddingX'|'paddingY'|'lineHeight'|'qrSize',[number,number]>;
