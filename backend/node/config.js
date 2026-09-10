import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve("backend", ".env") });

const required = (key, fallback) => {
  const value = process.env[key] || fallback;
  if (!value) throw new Error(`Required configuration ${key} is missing.`);
  return value;
};

export const config = {
  env: process.env.APP_ENV || "production",
  port: Number(process.env.NODE_API_PORT || 3101),
  host: process.env.NODE_API_HOST || "localhost",
  trustProxy: process.env.TRUST_PROXY === "1" ? 1 : "loopback",
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
