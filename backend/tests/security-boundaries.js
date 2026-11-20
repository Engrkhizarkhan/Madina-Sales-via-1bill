import test from "node:test";
import assert from "node:assert/strict";
Object.assign(process.env, {
  DB_NAME: "security_boundary_qa",
  DB_USER: "qa",
  DB_PASSWORD: "unused",
  TERMINAL_ROLE: "standalone",
  ALLOWED_ORIGINS: "http://localhost",
  APP_ENV: "production",
});
const { app } = await import("../node/app.js");
const { pool } = await import("../node/db.js");
test("anonymous, forged-role and cross-origin requests cannot reach staff data or mutations", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const path of [
      "/admin/bootstrap",
      "/admin/recovery",
      "/admin/activity",
      "/admin/reconciliation",
      "/settings/receipt",
      "/users",
    ]) {
      const r = await fetch(base + path, {
        headers: { "X-Madina-Device": "terminal-1", "X-User-Role": "admin" },
      });
      assert.equal(r.status, 401, path);
      assert.equal((await r.json()).error.code, "unauthenticated");
      assert.match(r.headers.get("cache-control"), /no-store/);
      assert.match(r.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
    }
    const origin = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(origin.status, 403);
    assert.equal((await origin.json()).error.code, "origin_denied");
    const large = await fetch(base + "/public/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passenger: "x".repeat(140000) }),
    });
    assert.equal(large.status, 413);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("database overload is bounded and returns a recoverable response without query or passenger details", async () => {
  const original = pool.query;
  pool.query = async () => {
    throw new Error("Queue limit reached.");
  };
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const r = await fetch(
      "http://127.0.0.1:" + server.address().port + "/health",
    );
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("retry-after"), "2");
    const value = await r.json();
    assert.equal(value.error.code, "server_busy");
    assert.doesNotMatch(
      JSON.stringify(value),
      /SELECT|password|sqlState|stack/,
    );
  } finally {
    pool.query = original;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
