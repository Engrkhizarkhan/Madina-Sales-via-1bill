import "reflect-metadata";
import { webcrypto, randomBytes, X509Certificate as NodeCertificate, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as x509 from "@peculiar/x509";
import { config } from "../node/config.js";
import { pool } from "../node/db.js";
import { fail } from "../node/helpers.js";

const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const serialNumber = () => randomBytes(16).toString("hex");
const pem = (label, value) => `-----BEGIN ${label}-----\n${Buffer.from(value).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;
const fingerprint = certificate => new NodeCertificate(certificate).fingerprint256.replaceAll(":", "").toLowerCase();

export async function createTerminalCertificates(directory, ip) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialNumber(), name: "CN=Madina Express Local Terminal CA", keys,
    signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 300000),
    notAfter: new Date(Date.now() + 5 * 365 * 86400000),
    extensions: [new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)],
  });
  await writeFile(join(directory, "ca.key"), pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)), { mode: 0o600 });
  await writeFile(join(directory, "ca.crt"), ca.toString("pem"), { mode: 0o600 });
  await renewTerminalServerCertificate(directory, ip);
}

export async function renewTerminalServerCertificate(directory, ip) {
  const ca = new x509.X509Certificate(await readFile(join(directory, "ca.crt"), "utf8"));
  const keyPem = await readFile(join(directory, "ca.key"), "utf8");
  const privateKey = await webcrypto.subtle.importKey("pkcs8",
    Buffer.from(keyPem.replace(/-----[^-]+-----|\s/g, ""), "base64"), algorithm, false, ["sign"]);
  const serverKeys = await webcrypto.subtle.generateKey({ ...algorithm, modulusLength: 2048 }, true, ["sign", "verify"]);
  const server = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(), issuer: ca.subject, subject: "CN=Madina Express Terminal Server",
    publicKey: serverKeys.publicKey, signingKey: privateKey, signingAlgorithm: algorithm,
    notBefore: new Date(Date.now() - 300000), notAfter: new Date(Date.now() + 365 * 86400000),
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"], true),
      new x509.SubjectAlternativeNameExtension([{ type: "ip", value: ip }, { type: "dns", value: "localhost" }])],
  });
  await writeFile(join(directory, "server.key"), pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", serverKeys.privateKey)), { mode: 0o600 });
  await writeFile(join(directory, "server.crt"), server.toString("pem"), { mode: 0o600 });
}

export async function signTerminalRequest(requestPem, slot) {
  if (typeof requestPem !== "string" || requestPem.length > 16000) fail("Invalid terminal certificate request.", 422, "invalid_request");
  let request;
  try { request = new x509.Pkcs10CertificateRequest(requestPem); }
  catch { fail("Invalid terminal certificate request.", 422, "invalid_request"); }
  if (!(await request.verify())) fail("The certificate request signature is invalid.", 422, "invalid_request");
  const ca = new x509.X509Certificate(await readFile(join(config.terminal.directory, "tls", "ca.crt"), "utf8"));
  const keyPem = await readFile(join(config.terminal.directory, "tls", "ca.key"), "utf8");
  const key = await webcrypto.subtle.importKey("pkcs8",
    Buffer.from(keyPem.replace(/-----[^-]+-----|\s/g, ""), "base64"), algorithm, false, ["sign"]);
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(), issuer: ca.subject, subject: `CN=Madina Express Terminal ${slot}`,
    publicKey: request.publicKey, signingKey: key, signingAlgorithm: algorithm,
    notBefore: new Date(Date.now() - 300000), notAfter: new Date(Date.now() + 365 * 86400000),
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.2"], true)],
  });
  const certificatePem = certificate.toString("pem");
  return { pem: certificatePem, fingerprint: fingerprint(certificatePem), expiresAt: certificate.notAfter };
}

function trustedRelay(req) {
  if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return false;
  const received = req.get("X-Madina-Relay-Key") || "";
  const key = config.terminal.relayKey;
  return key && received.length === key.length && timingSafeEqual(Buffer.from(received), Buffer.from(key));
}

export async function localTerminalGuard(req, _res, next) {
  if (!config.terminal.local) return next();
  try {
    if (!req.socket.encrypted && !trustedRelay(req)) fail("This connection is not authorized.", 403, "relay_required");
    let encoded;
    if (req.socket.encrypted) encoded = req.socket.getPeerCertificate()?.raw;
    else {
      const header = req.get("X-Madina-Client-Cert");
      if (header && header.length < 18000) {
        try { encoded = decodeURIComponent(header); }
        catch { fail("The terminal certificate is invalid.", 403, "invalid_certificate"); }
      }
    }
    req.verifiedTerminal = "";
    if (encoded) {
      let certificate;
      try { certificate = new NodeCertificate(encoded); }
      catch { fail("The terminal certificate is invalid.", 403, "invalid_certificate"); }
      const now = Date.now();
      if (Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now) {
        const hash = fingerprint(certificate.raw);
        const [[device]] = await pool.execute("SELECT slot FROM terminal_devices WHERE fingerprint = ? AND expires_at > NOW()", [hash]);
        if (device) req.verifiedTerminal = `terminal-${device.slot}:${hash}`;
      }
    }
    next();
  } catch (error) { next(error); }
}
