import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getEventListeners } from "node:events";
import ts from "typescript";
const source = (
  await readFile(new URL("../../src/api.ts", import.meta.url), "utf8")
).replaceAll("import.meta.env", '({VITE_API_BASE:"/api"})');
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function client(run, { blocked = false } = {}) {
  const old = {
      window: globalThis.window,
      sessionStorage: globalThis.sessionStorage,
      fetch: globalThis.fetch,
    },
    store = new Map([
      ["madina-express-csrf", "old"],
      ["madina-counter-silent", "true"],
    ]);
  try {
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.sessionStorage = {
      getItem: (key) => {
        if (blocked) throw Error("storage blocked");
        return store.get(key) || null;
      },
      setItem: (key, value) => {
        if (blocked) throw Error("storage blocked");
        store.set(key, value);
      },
      removeItem: (key) => {
        if (blocked) throw Error("storage blocked");
        store.delete(key);
      },
    };
    const { api } = await import(
      "data:text/javascript;base64," +
        Buffer.from(js + "\n// " + Math.random()).toString("base64")
    );
    await run(api, store);
  } finally {
    Object.assign(globalThis, old);
  }
}
test("a stale tab refreshes only its CSRF token and executes the rejected payment exactly once", () =>
  client(async (api, store) => {
    let writes = 0,
      refreshes = 0,
      requests = 0;
    globalThis.fetch = async (url, options) => {
      requests++;
      assert.equal(options.cache, "no-store");
      if (url.endsWith("/auth/me")) {
        refreshes++;
        return response({ csrfToken: "fresh" });
      }
      if (options.headers.get("X-CSRF-Token") !== "fresh")
        return response({ error: { code: "csrf_failed" } }, 403);
      writes++;
      return response({ bookings: [{ id: "saved" }] });
    };
    assert.equal((await api.createBooking({})).bookings[0].id, "saved");
    assert.equal(writes, 1);
    assert.equal(refreshes, 1);
    assert.equal(requests, 3);
    assert.equal(store.get("madina-counter-silent"), "true");
  }));
test("parallel stale requests share one session-token refresh", () =>
  client(async (api) => {
    let writes = 0,
      refreshes = 0;
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/auth/me")) {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return response({ csrfToken: "fresh" });
      }
      if (options.headers.get("X-CSRF-Token") !== "fresh")
        return response({ error: { code: "csrf_failed" } }, 403);
      writes++;
      return response({ ok: true });
    };
    await Promise.all([api.createBooking({}), api.createBooking({})]);
    assert.equal(refreshes, 1);
    assert.equal(writes, 2);
  }));
test("a failed or timed-out connection never retries a payment, and permission failures do not refresh tokens", () =>
  client(async (api) => {
    let count = 0;
    globalThis.fetch = async () => {
      count++;
      throw new TypeError("connection lost after send");
    };
    await assert.rejects(api.createBooking({}));
    assert.equal(count, 1);
    count = 0;
    globalThis.fetch = async () => {
      count++;
      return response({ error: { code: "forbidden" } }, 403);
    };
    await assert.rejects(
      api.createBooking({}),
      (error) => error.code === "forbidden",
    );
    assert.equal(count, 1);
  }));
test("an expired session or invalid response cannot be mistaken for a successful mutation", () =>
  client(async (api, store) => {
    let count = 0;
    globalThis.fetch = async () => {
      count++;
      return response({ error: { code: "unauthenticated" } }, 401);
    };
    await assert.rejects(
      api.createBooking({}),
      (error) => error.code === "unauthenticated",
    );
    assert.equal(count, 1);
    assert.equal(store.has("madina-express-csrf"), false);
    globalThis.fetch = async () => new Response("<html>stale app shell</html>");
    await assert.rejects(
      api.createBooking({}),
      (error) => error.code === "invalid_response",
    );
  }));
test("blocked browser storage still permits login and authenticated actions in memory", () =>
  client(
    async (api) => {
      globalThis.fetch = async (url, options) => {
        if (url.endsWith("/auth/login"))
          return response({ csrfToken: "memory-token", user: { id: 1 } });
        assert.equal(options.headers.get("X-CSRF-Token"), "memory-token");
        return response({ ok: true });
      };
      await api.login("qa", "not-a-real-password");
      await api.createBooking({});
    },
    { blocked: true },
  ));
test("completed API calls remove abort listeners instead of accumulating them on a reused signal", () =>
  client(async (api) => {
    const controller = new AbortController();
    globalThis.fetch = async () =>
      response({ rows: [], total: 0, page: 1, size: 20, pages: 1 });
    for (let i = 0; i < 30; i++)
      await api.recordPage("/admin/booking-page", {}, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }));
