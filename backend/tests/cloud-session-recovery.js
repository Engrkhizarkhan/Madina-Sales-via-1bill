import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
Object.assign(process.env, {
  DB_NAME: "cloud_session_qa",
  DB_USER: "qa",
  DB_PASSWORD: "unused",
});
const { CloudSessions } = await import("../node/cloud-sessions.js");
const user = {
  id: 1,
  role: "admin",
  is_owner: 1,
  active: 1,
  password_hash: "not-a-production-secret",
  session_version: 1,
};
test("damaged cloud sessions fail closed, stop shadowing login, and cannot revive replicated SQL sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "madina-session-qa-"));
  const sessions = new CloudSessions(dir),
    bad = "a".repeat(64),
    good = "b".repeat(64);
  try {
    await writeFile(sessions.file(bad), "\0".repeat(100));
    const invalid = await sessions.read(bad);
    assert.equal(invalid.revoked, true);
    assert.equal(sessions.valid(invalid, user), false);
    assert.equal(
      JSON.parse(await readFile(sessions.file(bad), "utf8")).revoked,
      true,
    );
    await sessions.create(good, user, "csrf");
    assert.equal(sessions.valid(await sessions.read(good), user), true);
    await sessions.revoke(good);
    assert.equal(sessions.valid(await sessions.read(good), user), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("one damaged file cannot deny every cloud login during expired-session cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "madina-session-qa-"));
  const sessions = new CloudSessions(dir);
  try {
    await writeFile(sessions.file("a".repeat(64)), "{broken");
    await sessions.create("c".repeat(64), user, "csrf");
    assert.equal(
      sessions.valid(await sessions.read("c".repeat(64)), user),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("damaged OTP state conservatively waits for the next code, then still rejects replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "madina-session-qa-"));
  const sessions = new CloudSessions(dir);
  try {
    const { createHash } = await import("node:crypto"),
      hash = createHash("sha256").update("otp:1").digest("hex"),
      step = Math.floor(Date.now() / 30000);
    await writeFile(sessions.file(hash), "\0");
    await assert.rejects(
      sessions.consumeOtp(1, step),
      (error) => error.code === "authenticator_required",
    );
    await sessions.consumeOtp(1, step + 1);
    await assert.rejects(
      sessions.consumeOtp(1, step + 1),
      (error) => error.code === "authenticator_required",
    );
    assert.equal((await sessions.consumedOtpSteps())[0].step, step + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
