import express from "express";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { config } from "../node/config.js";

export async function startTerminalWeb(app) {
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
  web.use("/api", app);
  web.get("/", (_req, res) => res.redirect("/manage"));
  web.get("/Madina-Express-Counter.cmd", async (_req, res, next) => {
    try {
      const template = await readFile(resolve("dist/Madina-Express-Counter.cmd"), "utf8");
      res.type("text/plain").attachment("Madina-Express-Counter.cmd")
        .send(template.replaceAll("https://staff.madinaexpress.duckdns.org", config.terminal.localOrigin));
    } catch (error) { next(error); }
  });
  web.use(express.static(resolve("dist"), { dotfiles: "deny", index: false }));
  web.get(["/login", "/manage"], (_req, res) => res.sendFile(resolve("dist/index.html")));
  web.use((_req, res) => res.sendStatus(404));
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
