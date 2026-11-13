import { receiptDefaults, receiptFonts, receiptNumberBounds } from "../../shared/receipt-layout.mjs";
import { pool } from "./db.js";
import { fail, parseJson } from "./helpers.js";

export function validateReceiptLayout(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Enter receipt settings.",422,"validation_error");
  const result = {...receiptDefaults};
  for (const [key, max] of Object.entries({businessName:60,brandMark:12,contact:100,terminal:160,website:100,tokenTitle:40,urduTerms:600,tokenNote:200})) {
    if (typeof input[key] !== "string" || input[key].trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key])) fail(`Enter a valid ${key} (up to ${max} characters).`,422,"validation_error");
    result[key] = input[key].trim();
  }
  if (!result.businessName || !result.tokenTitle) fail("Business name and boarding token title are required.",422,"validation_error");
  if (!receiptFonts.includes(input.font)) fail("Choose a supported receipt font.",422,"validation_error");
  result.font = input.font;
  for (const [key,[min,max]] of Object.entries(receiptNumberBounds)) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] < min || input[key] > max) fail(`Enter ${key} between ${min} and ${max}.`,422,"validation_error");
    result[key] = Math.round(input[key]*100)/100;
  }
  for (const key of ["showQr","showWebsite"]) {
    if (typeof input[key] !== "boolean") fail(`Choose ${key}.`,422,"validation_error");
    result[key] = input[key];
  }
  return result;
}
export async function getReceiptLayout(executor = pool) {
  const [[row]] = await executor.execute("SELECT setting_value FROM settings WHERE setting_key='receipt_layout'");
  return {...receiptDefaults,...parseJson(row?.setting_value,{})};
}
