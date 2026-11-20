export const receiptDefaults = Object.freeze({
  businessName: "MADINA EXPRESS", brandMark: "SDK", contact: "0311-777-2299 / 0315-777-2299",
  terminal: "Madina Terminal, Peshawar", website: "MadinaExpress.pk", tokenTitle: "BOARDING TOKEN",
  urduTerms: "روانگی سے دس منٹ پہلے پہنچیں۔ ٹکٹ کی تاریخ، وقت اور سیٹ نمبر چیک کریں۔ اصل شناختی کارڈ ہمراہ رکھیں۔",
  tokenNote: "یہ ٹوکن کنڈکٹر کے حوالے کریں۔", font: "Arial", fontSize: 11, headingSize: 23,
  seatSize: 23, urduSize: 11, paddingX: 3, paddingY: 3, lineHeight: 1.3, qrSize: 26,
  showQr: true, showWebsite: true, websiteLabel: "Book online:", websiteSize: 12, websiteBold: true, websiteAlign: "center",
  websiteFont: "Arial", websiteBox: false, websiteInverted: false, websitePadding: 1, websiteBorderWidth: 1,
  voucherFont: "Arial", voucherFontSize: 9.5, voucherHeadingSize: 16, voucherPaddingX: 2, voucherPaddingY: 1,
  voucherLineHeight: 1.1, voucherRowPadding: 0.5, voucherShowNetCollected: true, voucherShowContact: false, voucherShowCrew: false,
});
export const receiptFonts = ["Arial", "Tahoma", "Georgia", "Times New Roman"];
export const receiptNumberBounds = {fontSize:0,headingSize:0,seatSize:0,urduSize:0,paddingX:0,paddingY:0,lineHeight:0,qrSize:0,websiteSize:0,websitePadding:0,websiteBorderWidth:0};
export const voucherNumberFields = {voucherFontSize:'Body font (px)',voucherHeadingSize:'Heading font (px)',voucherPaddingX:'Side padding (mm)',voucherPaddingY:'Top / bottom padding (mm)',voucherLineHeight:'Line spacing',voucherRowPadding:'Row padding (px)'};
export function voucherStyle(layout){
 return {'--voucher-font':layout.voucherFont,'--voucher-font-size':layout.voucherFontSize+'px','--voucher-heading-size':layout.voucherHeadingSize+'px','--voucher-padding-x':layout.voucherPaddingX+'mm','--voucher-padding-y':layout.voucherPaddingY+'mm','--voucher-line-height':String(layout.voucherLineHeight),'--voucher-row-padding':layout.voucherRowPadding+'px'};
}
