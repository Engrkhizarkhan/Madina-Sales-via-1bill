import {
  receiptDefaults,
  receiptFonts,
  receiptNumberBounds,
  voucherNumberFields,
  boardingNumberFields,
  boardingTextFields,
  boardingFlags,
  receiptLayoutWithDefaults,
} from "../../shared/receipt-layout.mjs";
import { pool } from "./db.js";
import { fail, parseJson } from "./helpers.js";

export function validateReceiptLayout(input, existing = receiptDefaults) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Enter receipt settings.", 422, "validation_error");
  const result = { ...receiptDefaults };
  const compatible = { ...receiptLayoutWithDefaults(existing), ...input };
  for (const key of new Set([
    "businessName",
    "brandMark",
    "contact",
    "terminal",
    "website",
    "urduTerms",
    "websiteLabel",
    ...Object.keys(boardingTextFields),
  ])) {
    if (
      typeof compatible[key] !== "string" ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(compatible[key])
    )
      fail(`Enter a valid ${key}.`, 422, "validation_error");
    result[key] = compatible[key].trim();
  }
  if (!result.businessName || !result.tokenTitle)
    fail(
      "Business name and boarding token title are required.",
      422,
      "validation_error",
    );
  for (const key of ["font", "websiteFont", "voucherFont", "boardingFont"]) {
    if (!receiptFonts.includes(compatible[key]))
      fail("Choose a supported receipt font.", 422, "validation_error");
    result[key] = compatible[key];
  }
  const nonnegative = [
    "paddingX",
    "paddingY",
    "websitePadding",
    "websiteBorderWidth",
    "voucherPaddingX",
    "voucherPaddingY",
    "voucherRowPadding",
    "boardingPaddingX",
    "boardingPaddingY",
    "boardingRowPadding",
    "boardingBorderWidth",
  ];
  for (const key of [
    ...Object.keys(receiptNumberBounds),
    ...Object.keys(voucherNumberFields),
    ...Object.keys(boardingNumberFields),
  ]) {
    if (
      typeof compatible[key] !== "number" ||
      !Number.isFinite(compatible[key]) ||
      (nonnegative.includes(key) ? compatible[key] < 0 : compatible[key] <= 0)
    )
      fail(
        `Enter a valid ${key}. Sizes must be positive; padding can be zero.`,
        422,
        "validation_error",
      );
    result[key] = compatible[key];
  }
  for (const key of [
    "showQr",
    "showWebsite",
    "websiteBold",
    "websiteBox",
    "websiteInverted",
    "voucherShowNetCollected",
    "voucherShowContact",
    "voucherShowCrew",
    ...Object.keys(boardingFlags),
  ]) {
    if (typeof compatible[key] !== "boolean")
      fail(`Choose ${key}.`, 422, "validation_error");
    result[key] = compatible[key];
  }
  if (!["left", "center", "right"].includes(compatible.websiteAlign))
    fail("Choose a booking website alignment.", 422, "validation_error");
  result.websiteAlign = compatible.websiteAlign;
  for (const key of [
    "boardingHeaderAlign",
    "boardingValueAlign",
    "boardingNoteAlign",
  ]) {
    if (!["left", "center", "right"].includes(compatible[key]))
      fail("Choose a valid boarding pass alignment.", 422, "validation_error");
    result[key] = compatible[key];
  }
  if (!["row", "stacked"].includes(compatible.boardingHeaderLayout))
    fail(
      "Choose a valid boarding pass header layout.",
      422,
      "validation_error",
    );
  result.boardingHeaderLayout = compatible.boardingHeaderLayout;
  return result;
}
export async function getReceiptLayout(executor = pool) {
  const [[row]] = await executor.execute(
    "SELECT setting_value FROM settings WHERE setting_key='receipt_layout'",
  );
  return receiptLayoutWithDefaults(parseJson(row?.setting_value, {}));
}
