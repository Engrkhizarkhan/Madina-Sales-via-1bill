import { validTerminalSlot } from "../../shared/terminal-slots.mjs";
import { createHmac, createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { fail, parseJson } from './helpers.js';

export const isOwner = user => user?.role === 'admin' && Boolean(user.is_owner);
export const canRemote = user => isOwner(user) || Boolean(user.remote_allowed);
export function requireOwner(user) {
  if (!isOwner(user)) fail('Only the main administrator can manage accounts, policies and system setup.', 403, 'owner_required');
}
export function permittedDevice(user, device) {
  if (canRemote(user)) return true;
  if (!config.restrictStaffDevices) return true;
  const slot = Number(device?.match(/^terminal-([1-9][0-9]?)(?::|$)/)?.[1]);
  const allowed = parseJson(user.terminal_slots, [1, 2, 3]);
  return Boolean(slot && allowed.includes(slot));
}
export function accessDetails(data) {
  if (data.remoteAllowed !== undefined && typeof data.remoteAllowed !== 'boolean') fail('Choose whether remote login is allowed.', 422, 'validation_error');
  const terminals = data.terminals === undefined ? [1, 2, 3] : data.terminals;
  if (!Array.isArray(terminals) || terminals.some(slot => !validTerminalSlot(slot))) fail('Choose a valid terminal PC.', 422, 'validation_error');
  if (!data.remoteAllowed && !terminals.length) fail('Select at least one terminal PC or allow remote access.', 422, 'validation_error');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail('Enter a valid optional email address.', 422, 'validation_error');
  return { remote: data.remoteAllowed === true, terminals: [...new Set(terminals)], email: email || null };
}
function encryptionKey() {
  if (!config.adminOtpKey) throw new Error('The account authenticator encryption key is not configured.');
  return Buffer.from(hkdfSync('sha256', config.adminOtpKey, 'madina-accounts-v1', 'authenticator-secrets', 32));
}
export function encryptMfa(secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(buffer => buffer.toString('base64')).join('.');
}
function decryptMfa(value) {
  const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(content), decipher.final()]);
}
export function base32(secret) {
  let bits = 0, value = 0, out = '';
  for (const byte of secret) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value >>> bits) & 31]; } }
  if (bits) out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value << (5 - bits)) & 31];
  return out;
}
export function newAuthenticator(username) {
  const secret = randomBytes(20), encoded = base32(secret);
  return { encrypted: encryptMfa(secret), secret: encoded,
    uri: `otpauth://totp/${encodeURIComponent('Madina Express:' + username)}?secret=${encoded}&issuer=Madina%20Express&algorithm=SHA1&digits=6&period=30` };
}
function verifyCode(key,input,lastStep) {
  if (typeof input !== 'string' || !/^\d{6}$/.test(input)) return false;
  const counter = Buffer.alloc(8), current = Math.floor(Date.now()/30000);
  for (const step of [current,current-1,current+1]) {
    if (step <= Number(lastStep)) continue;
    counter.writeBigUInt64BE(BigInt(step));
    const digest=createHmac('sha1',key).update(counter).digest(),offset=digest.at(-1)&15;
    const expected=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
    if(timingSafeEqual(Buffer.from(expected),Buffer.from(input)))return step;
  }
  return false;
}
export function verifyUserCode(user,input) {
  if(isOwner(user)) return config.adminTotpPaused||!config.adminOtpKey?null:verifyCode(config.adminOtpKey,input,user.mfa_last_step);
  if(!user.mfa_required)return null;
  if(!user.mfa_secret)return false;
  return verifyCode(decryptMfa(user.mfa_secret),input,user.mfa_last_step);
}

export function accountVersion(user) {
  return JSON.stringify([user.id,user.role,user.password_hash,Number(user.session_version||0),Number(user.is_owner||0),Number(user.remote_allowed||0),user.terminal_slots,Number(user.mfa_required||0),user.mfa_secret]);
}
