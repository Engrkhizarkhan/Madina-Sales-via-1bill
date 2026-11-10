import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { fail, tokenHash } from "./helpers.js";

const attempts = new Map();

export function limitAttempts(scope, req, limit, windowMs) {
  const now = Date.now();
  if (attempts.size >= 4096) {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size >= 4096) attempts.delete(attempts.keys().next().value);
  }
  const key = `${scope}:${req.ip}`;
  const recent = attempts.get(key);
  const entry = recent?.until > now ? recent : { count: 0, until: now + windowMs };
  if (entry.count >= limit) fail("Too many attempts. Please try again in a few minutes.", 429, "rate_limited");
  entry.count++;
  attempts.set(key, entry);
}

export function terminalDevice(req) {
  if (req.socket.remoteAddress !== "127.0.0.1") return "";
  const device = req.get("X-Madina-Device") || "";
  return /^terminal-[1-3]$/.test(device) ? device : "";
}

export function sessionHash(token, role, device) {
  if (role === "admin" && config.adminTotpPaused) return tokenHash(`${token}:admin-totp-paused`);
  return tokenHash(config.restrictStaffDevices && role !== "admin" ? `${token}:${device}` : token);
}

let lastAdminStep = -1;

export function verifyAdminCode(input) {
  if (config.adminTotpPaused || !config.adminOtpKey) return true;
  if (typeof input !== "string" || !/^\d{6}$/.test(input)) return false;
  const currentStep = Math.floor(Date.now() / 30_000);
  const counter = Buffer.alloc(8);
  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    if (step <= lastAdminStep) continue;
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac("sha1", config.adminOtpKey).update(counter).digest();
    const offset = digest.at(-1) & 15;
    const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(code), Buffer.from(input))) {
      lastAdminStep = step;
      return true;
    }
  }
  return false;
}
