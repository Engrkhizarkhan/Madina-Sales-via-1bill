export type ReceiptLayout = {
  businessName:string;brandMark:string;contact:string;terminal:string;website:string;tokenTitle:string;
  urduTerms:string;tokenNote:string;font:string;fontSize:number;headingSize:number;seatSize:number;urduSize:number;
  paddingX:number;paddingY:number;lineHeight:number;qrSize:number;showQr:boolean;showWebsite:boolean;
  websiteFont:string;websiteBox:boolean;websiteInverted:boolean;websitePadding:number;websiteBorderWidth:number;
  voucherFont:string;voucherFontSize:number;voucherHeadingSize:number;voucherPaddingX:number;voucherPaddingY:number;voucherLineHeight:number;voucherRowPadding:number;voucherShowNetCollected:boolean;voucherShowContact:boolean;voucherShowCrew:boolean;
  websiteLabel:string;websiteSize:number;websiteBold:boolean;websiteAlign:'left'|'center'|'right';
};
export const receiptDefaults: Readonly<ReceiptLayout>;
export const receiptFonts: string[];
export const receiptNumberBounds: Record<'fontSize'|'headingSize'|'seatSize'|'urduSize'|'paddingX'|'paddingY'|'lineHeight'|'qrSize'|'websiteSize'|'websitePadding'|'websiteBorderWidth',number>;
export const voucherNumberFields: Record<'voucherFontSize'|'voucherHeadingSize'|'voucherPaddingX'|'voucherPaddingY'|'voucherLineHeight'|'voucherRowPadding',string>;
export function voucherStyle(layout:ReceiptLayout): Record<string,string>;
