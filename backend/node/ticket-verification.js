import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

function signature(booking, reference = booking.reservation_no || booking.ticket_no) {
  const key = process.env.PUBLIC_TICKET_KEY || config.adminOtpKey;
  if (!key) return "";
  return createHmac("sha256",key).update(`madina-ticket-view-v1:${booking.id}:${reference}`).digest("base64url");
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
  return [...new Set([booking.reservation_no || booking.ticket_no,booking.ticket_no])].some(reference => {
    const expected=signature(booking,reference);
    return expected.length===input.length&&timingSafeEqual(Buffer.from(input),Buffer.from(expected));
  });
}
