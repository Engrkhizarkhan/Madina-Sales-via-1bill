import { createHash, randomBytes } from "node:crypto";

export class ApiError extends Error {
  constructor(message, status = 400, code = "request_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (message, status = 400, code = "request_error") => {
  throw new ApiError(message, status, code);
};

export function requireFields(data, fields) {
  for (const field of fields) {
    if (!(field in data) || (typeof data[field] === "string" && !data[field].trim())) {
      fail(`${field} is required.`, 422, "validation_error");
    }
  }
}

export function decimal(value, field, minimum = 0) {
  const number = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(number)) fail(`${field} must be a number.`, 422, "validation_error");
  if (number < minimum) fail(`${field} must be at least ${minimum}.`, 422, "validation_error");
  return number;
}

export function allowed(value, values, field) {
  if (!values.includes(value)) fail(`${field} is invalid.`, 422, "validation_error");
  return value;
}

export const uuid = (prefix = "") => `${prefix}${randomBytes(16).toString("hex")}`;
export const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");

export function isoDateTime(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T").replace(/Z$|[+-]\d\d:\d\d$/, "");
  return `${normalized}+05:00`;
}

export function pakistanDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function sqlDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export const trimTime = (value) => String(value || "").slice(0, 5);
export const parseJson = (value, fallback = []) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
