import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: process.env.MADINA_ENV_FILE || resolve("backend", ".env") });

const required = (key, fallback) => {
  const value = process.env[key] || fallback;
  if (!value) throw new Error(`Required configuration ${key} is missing.`);
  return value;
};

const adminOtp = process.env.ADMIN_TOTP_HEX || "";
const adminTotpPaused = process.env.ADMIN_TOTP_PAUSED === "true";
const restrictStaffDevices = process.env.RESTRICT_STAFF_DEVICES === "true";
if ((adminOtp || restrictStaffDevices || adminTotpPaused) && !/^[0-9a-f]{40}$/i.test(adminOtp)) {
  throw new Error("ADMIN_TOTP_HEX must be a 20-byte hexadecimal key when production staff access is enabled.");
}

const terminalRole = process.env.TERMINAL_ROLE || "standalone";
if (!["standalone", "cloud", "terminal"].includes(terminalRole)) throw new Error("Invalid TERMINAL_ROLE.");
const terminalDirectory = process.env.TERMINAL_DIRECTORY || resolve("backend", ".terminal");
if (terminalRole === "terminal" && (!/^[0-9a-f]{64}$/.test(process.env.TERMINAL_RELAY_KEY || "") ||
    !process.env.TERMINAL_LOCAL_ORIGIN || !process.env.TERMINAL_CLOUD_ORIGIN)) {
  throw new Error("The local terminal configuration is incomplete.");
}

export const config = {
  terminal: {
    local: terminalRole === "terminal", cloud: terminalRole === "cloud", directory: terminalDirectory,
    localOrigin: process.env.TERMINAL_LOCAL_ORIGIN || "",
    cloudOrigin: process.env.TERMINAL_CLOUD_ORIGIN || "",
    relayKey: process.env.TERMINAL_RELAY_KEY || "",
    httpsPort: Number(process.env.TERMINAL_HTTPS_PORT || 8443),
  },
  restrictStaffDevices,
  adminTotpPaused,
  adminOtpKey: adminOtp ? Buffer.from(adminOtp, "hex") : null,
  env: process.env.APP_ENV || "production",
  port: Number(process.env.NODE_API_PORT || 3101),
  host: process.env.NODE_API_HOST || "localhost",
  trustProxy: process.env.TRUST_PROXY === "1" ? "127.0.0.1" : "loopback",
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "http://localhost")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  secureCookies: process.env.SESSION_SECURE === "true",
  paymentMode: process.env.PAYMENT_MODE || "disabled",
  publicSiteEnabled: process.env.PUBLIC_SITE_ENABLED === "true",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
  },
};
