import { canRemote } from "./account-access.js";
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
  if (config.terminal.local) return req.verifiedTerminal || "";
  if (req.socket.remoteAddress !== "127.0.0.1") return "";
  const device = req.get("X-Madina-Device") || "";
  return /^terminal-[1-9][0-9]?$/.test(device) ? device : "";
}

export function sessionHash(token, role, device) {
  if (role === "admin" && config.adminTotpPaused) return tokenHash(`${token}:admin-totp-paused`);
  return tokenHash(config.restrictStaffDevices && role !== "admin" ? `${token}:${device}` : token);
}

export const accountSessionHash = (token,user,device) => sessionHash(token,canRemote(user)?"admin":"counter",device);
