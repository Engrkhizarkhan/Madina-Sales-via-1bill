import { fail } from "./helpers.js";
import { accountVersion, canRemote } from "./account-access.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import {atomicJson} from '../../deploy/updater/engine.mjs';
import { join } from "node:path";
const pending = new Map();

// Cloud authentication must remain writable while the business database is a replica.
// Tokens are never stored, and a changed password/role invalidates every saved session.
export class CloudSessions {
  constructor(directory) { this.directory = directory; }
  version(user) {
    return createHash("sha256").update(accountVersion(user)).digest("hex");
  }
  file(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid session hash.");
    return join(this.directory, hash + ".json");
  }
  async read(hash) {
    try {
      const value=JSON.parse(await readFile(this.file(hash), "utf8"));
      if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isFinite(value.expires))throw new SyntaxError('Invalid cloud session state');
      return value;
    }
    catch (error) {
      if (error.code === "ENOENT") return null;
      if (!(error instanceof SyntaxError)) throw error;
      // A power interruption must not break all logins, or fall back to a
      // replicated SQL session that this file may already have revoked.
      const invalid={revoked:true,step:Math.floor(Date.now()/30000),expires:Date.now()+24*3600000};
      await this.save(hash,invalid);
      return invalid;
    }
  }
  async save(hash, value) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicJson(this.file(hash),value,0o600);
  }
  async prune() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const value = await this.read(file.slice(0, 64));
      if (value?.expires <= Date.now()) await unlink(join(this.directory, file)).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
  async create(hash, user, csrf) {
    await this.prune();
    await this.save(hash, { userId: user.id, version: this.version(user), csrf, expires: Date.now() + 8 * 3600000 });
  }
  valid(value, user) {
    return value && !value.revoked && value.expires > Date.now() && user?.active &&
      canRemote(user) && Number(value.userId) === Number(user.id) && value.version === this.version(user);
  }
  async revoke(hash) {
    // A tombstone also prevents a replicated SQL session from being reused here.
    await this.change(hash, () => ({ revoked: true, expires: Date.now() + 24 * 3600000 }));
  }
  async change(hash, update) {
    const key = this.file(hash);
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const value = await update(await this.read(hash));
      if (value) await this.save(hash, value);
      return value;
    });
    pending.set(key, current);
    try { return await current; }
    finally { if (pending.get(key) === current) pending.delete(key); }
  }
  async consumeOtp(userId, step) {
    const hash = createHash('sha256').update(`otp:${userId}`).digest('hex');
    await this.change(hash,current => {
      if (current && Number(current.step) >= step) fail('Use the next authenticator code.',401,'authenticator_required');
      return { kind:'otp',userId:Number(userId),step, expires:Date.now()+86400000 };
    });
  }
  async consumedOtpSteps() {
    await this.prune();const result=[];
    for(const file of await readdir(this.directory)) {
      if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
      const value=await this.read(file.slice(0,64));
      if(value?.kind==='otp')result.push({userId:value.userId,step:value.step});
    }
    return result;
  }
  async revokedHashes() {
    await this.prune();
    const result = [];
    for (const file of await readdir(this.directory)) {
      if (/^[a-f0-9]{64}\.json$/.test(file) && (await this.read(file.slice(0, 64)))?.revoked) result.push(file.slice(0, 64));
    }
    return result;
  }
}
