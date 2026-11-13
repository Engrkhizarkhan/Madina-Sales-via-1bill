import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function signature(booking) {
  const key = process.env.PUBLIC_TICKET_KEY || config.adminOtpKey;
  if (!key) return "";
  return createHmac("sha256",key).update(`madina-ticket-view-v1:${booking.id}:${booking.ticket_no}`).digest("base64url");
}
export function ticketVerificationUrl(booking) {
  const url = new URL("/check", "https://madinaexpress.duckdns.org");
  url.searchParams.set("reference",booking.ticket_no);
  const key = signature(booking);
  // Keep the capability out of web-server access logs and referrer headers.
  if (key) url.hash = `key=${key}`;
  return url.href;
}
export function verifyTicketKey(booking,input) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input)) return false;
  const expected = signature(booking);
  return expected.length === input.length && timingSafeEqual(Buffer.from(input),Buffer.from(expected));
}
