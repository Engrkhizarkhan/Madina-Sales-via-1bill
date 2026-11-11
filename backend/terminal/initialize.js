import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTerminalCertificates, renewTerminalServerCertificate } from "./certificates.js";
import { config } from "../node/config.js";

const ip = process.argv[2];
if (!ip || isIP(ip) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
  throw new Error("Enter the main PC’s private IPv4 address.");
}
const directory = join(config.terminal.directory, "tls");
try {
  await Promise.all(["ca.key", "ca.crt", "server.key", "server.crt"].map(file => access(join(directory, file))));
  const certificate = new X509Certificate(await readFile(join(directory, "server.crt")));
  if (!certificate.checkIP(ip) || Date.parse(certificate.validTo) < Date.now() + 30 * 86400000) {
    if (!process.argv.includes("--renew")) throw new Error("Use Change-Main-PC-Network.cmd to update the local address.");
    await renewTerminalServerCertificate(directory, ip);
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // This runs before the first activation; child certificates have not been issued yet.
  await createTerminalCertificates(directory, ip);
}
console.log("Local HTTPS certificates are ready.");
