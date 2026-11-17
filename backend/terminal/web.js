import express from "express";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { config } from "../node/config.js";
import {staffOrigin,legacyStaffOrigin} from '../../shared/domains.mjs';
import {transferMonitor} from './web-transfers.js';

export function createTerminalWeb(app, { directory = resolve("dist"), assets = resolve(process.env.TERMINAL_ASSET_DIRECTORY || "dist/assets") } = {}) {
  const web = express();
  web.disable("x-powered-by");
  web.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    next();
  });
  web.use(transferMonitor.observe);
  web.use("/api", app);
  web.get("/", (_req, res) => res.redirect("/manage"));
  web.get("/Madina-Express-Counter.cmd", async (_req, res, next) => {
    try {
      const template = await readFile(join(directory, "Madina-Express-Counter.cmd"), "utf8");
      res.type("text/plain").attachment("Madina-Express-Counter.cmd")
        .send(template.replaceAll(staffOrigin,config.terminal.localOrigin).replaceAll(legacyStaffOrigin,config.terminal.localOrigin));
    } catch (error) { next(error); }
  });
  const assetOptions = { dotfiles: "deny", index: false, setHeaders(res, file) {
    // Only content-addressed build files are reusable across visits/releases.
    // HTML, API responses and printable customer data retain no-store.
    if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9.]+$/i.test(basename(file))) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  } };
  web.use("/assets",express.static(assets,assetOptions));
  web.use("/assets",express.static(join(directory, "assets"),assetOptions));
  web.use(express.static(directory, { dotfiles: "deny", index: false }));
  web.get(["/login", "/manage", "/print/report"], (_req, res) => res.sendFile(join(directory, "index.html")));
  web.use((_req, res) => res.sendStatus(404));
  return web;
}

export async function startTerminalWeb(app) {
  const web = createTerminalWeb(app);
  const tlsDirectory = join(config.terminal.directory, "tls");
  const options = {
    key: await readFile(join(tlsDirectory, "server.key")),
    cert: await readFile(join(tlsDirectory, "server.crt")),
    ca: await readFile(join(tlsDirectory, "ca.crt")),
    requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.2",
  };
  return new Promise((resolveServer, reject) => {
    const server = https.createServer(options, web);
    server.once("error", reject);
    server.listen(config.terminal.httpsPort, "0.0.0.0", () => resolveServer(server));
  });
}
