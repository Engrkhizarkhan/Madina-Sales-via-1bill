import { receiptDefaults, receiptFonts, receiptNumberBounds } from "../../shared/receipt-layout.mjs";
import { pool } from "./db.js";
import { fail, parseJson } from "./helpers.js";

export function validateReceiptLayout(input,existing=receiptDefaults) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Enter receipt settings.",422,"validation_error");
  const result = {...receiptDefaults};
  const compatible={...input};
  for(const key of ['websiteLabel','websiteSize','websiteBold','websiteAlign'])if(compatible[key]===undefined)compatible[key]=existing[key]??receiptDefaults[key];
  for (const [key, max] of Object.entries({businessName:60,brandMark:12,contact:100,terminal:160,website:100,tokenTitle:40,urduTerms:600,tokenNote:200,websiteLabel:60})) {
    if (typeof compatible[key] !== "string" || compatible[key].trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(compatible[key])) fail(`Enter a valid ${key} (up to ${max} characters).`,422,"validation_error");
    result[key] = compatible[key].trim();
  }
  if (!result.businessName || !result.tokenTitle) fail("Business name and boarding token title are required.",422,"validation_error");
  if (!receiptFonts.includes(input.font)) fail("Choose a supported receipt font.",422,"validation_error");
  result.font = input.font;
  for (const [key,[min,max]] of Object.entries(receiptNumberBounds)) {
    if (typeof compatible[key] !== "number" || !Number.isFinite(compatible[key]) || compatible[key] < min || compatible[key] > max) fail(`Enter ${key} between ${min} and ${max}.`,422,"validation_error");
    result[key] = Math.round(compatible[key]*100)/100;
  }
  for (const key of ["showQr","showWebsite","websiteBold"]) {
    if (typeof compatible[key] !== "boolean") fail(`Choose ${key}.`,422,"validation_error");
    result[key] = compatible[key];
  }
  if(!['left','center','right'].includes(compatible.websiteAlign))fail('Choose a booking website alignment.',422,'validation_error');
  result.websiteAlign=compatible.websiteAlign;
  return result;
}
export async function getReceiptLayout(executor = pool) {
  const [[row]] = await executor.execute("SELECT setting_value FROM settings WHERE setting_key='receipt_layout'");
  return {...receiptDefaults,...parseJson(row?.setting_value,{})};
}
