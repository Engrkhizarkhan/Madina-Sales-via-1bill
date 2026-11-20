export type ReceiptLayout = {
  businessName: string;
  brandMark: string;
  contact: string;
  terminal: string;
  website: string;
  tokenTitle: string;
  urduTerms: string;
  tokenNote: string;
  font: string;
  fontSize: number;
  headingSize: number;
  seatSize: number;
  urduSize: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  qrSize: number;
  showQr: boolean;
  showWebsite: boolean;
  websiteFont: string;
  websiteBox: boolean;
  websiteInverted: boolean;
  websitePadding: number;
  websiteBorderWidth: number;
  voucherFont: string;
  voucherFontSize: number;
  voucherHeadingSize: number;
  voucherPaddingX: number;
  voucherPaddingY: number;
  voucherLineHeight: number;
  voucherRowPadding: number;
  voucherShowNetCollected: boolean;
  voucherShowContact: boolean;
  voucherShowCrew: boolean;
  websiteLabel: string;
  websiteSize: number;
  websiteBold: boolean;
  websiteAlign: "left" | "center" | "right";
  boardingBusinessName: string;
  boardingFont: string;
  boardingFontSize: number;
  boardingHeadingSize: number;
  boardingTitleSize: number;
  boardingSeatSize: number;
  boardingLabelSize: number;
  boardingUrduSize: number;
  boardingPaddingX: number;
  boardingPaddingY: number;
  boardingLineHeight: number;
  boardingUrduLineHeight: number;
  boardingRowPadding: number;
  boardingBorderWidth: number;
  boardingHeadingBold: boolean;
  boardingTitleBold: boolean;
  boardingNoteBold: boolean;
  boardingLabelBold: boolean;
  boardingValueBold: boolean;
  boardingShowPaid: boolean;
  boardingShowSeller: boolean;
  boardingShowNote: boolean;
  boardingNoteAlign: "left" | "center" | "right";
  boardingHeaderLayout: "row" | "stacked";
  boardingHeaderAlign: "left" | "center" | "right";
  boardingValueAlign: "left" | "center" | "right";
  boardingSeatLabel: string;
  boardingBusLabel: string;
  boardingDestinationLabel: string;
  boardingDateLabel: string;
  boardingDepartureLabel: string;
  boardingTicketLabel: string;
  boardingPaidLabel: string;
  boardingSellerLabel: string;
};
export const receiptDefaults: Readonly<ReceiptLayout>;
export const receiptFonts: string[];
export const receiptNumberBounds: Record<
  | "fontSize"
  | "headingSize"
  | "seatSize"
  | "urduSize"
  | "paddingX"
  | "paddingY"
  | "lineHeight"
  | "qrSize"
  | "websiteSize"
  | "websitePadding"
  | "websiteBorderWidth",
  number
>;
export const voucherNumberFields: Record<
  | "voucherFontSize"
  | "voucherHeadingSize"
  | "voucherPaddingX"
  | "voucherPaddingY"
  | "voucherLineHeight"
  | "voucherRowPadding",
  string
>;
export function voucherStyle(layout: ReceiptLayout): Record<string, string>;
export const boardingNumberFields: Record<
  | "boardingFontSize"
  | "boardingHeadingSize"
  | "boardingTitleSize"
  | "boardingSeatSize"
  | "boardingLabelSize"
  | "boardingUrduSize"
  | "boardingLineHeight"
  | "boardingUrduLineHeight"
  | "boardingPaddingX"
  | "boardingPaddingY"
  | "boardingRowPadding"
  | "boardingBorderWidth",
  string
>;
export const boardingTextFields: Record<
  | "boardingBusinessName"
  | "tokenTitle"
  | "tokenNote"
  | "boardingSeatLabel"
  | "boardingBusLabel"
  | "boardingDestinationLabel"
  | "boardingDateLabel"
  | "boardingDepartureLabel"
  | "boardingTicketLabel"
  | "boardingPaidLabel"
  | "boardingSellerLabel",
  string
>;
export const boardingFlags: Record<
  | "boardingHeadingBold"
  | "boardingTitleBold"
  | "boardingNoteBold"
  | "boardingLabelBold"
  | "boardingValueBold"
  | "boardingShowPaid"
  | "boardingShowSeller"
  | "boardingShowNote",
  string
>;
export function isBoardingField(key: string): boolean;
export function receiptLayoutWithDefaults(
  input?: Partial<ReceiptLayout>,
): ReceiptLayout;
export function boardingStyle(layout: ReceiptLayout): Record<string, string>;
