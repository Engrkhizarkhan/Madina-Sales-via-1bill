import { terminalState } from "../terminal/state.js";
import { startTerminalRuntime, stopTerminalRuntime, terminalReady } from "../terminal/runtime.js";
import { startTerminalWeb } from "../terminal/web.js";
import { app } from "./app.js";
import { config } from "./config.js";
import { releaseExpiredReservations } from "./operations.js";
import { closePool } from "./db.js";

const server = app.listen(config.port, config.host, () => {
  console.log(`Madina Express Node API listening on http://${config.host}:${config.port}`);
});

const expireReservations = async () => {
  if (!(await terminalReady()) || ["preparing", "active"].includes((await terminalState()).phase)) return;
  await releaseExpiredReservations();
};
const releaseHolds = () => expireReservations().catch(error => {
  console.error("Could not release expired web reservations:", error.code || error.message);
});
void releaseHolds();
const expiryTimer = setInterval(releaseHolds, 60_000).unref();
const terminalWeb = config.terminal.local ? await startTerminalWeb(app) : null;
if (terminalWeb) console.log(`Madina Express local HTTPS listening at ${config.terminal.localOrigin}`);
startTerminalRuntime();

const shutdown = async (signal) => {
  clearInterval(expiryTimer);
  stopTerminalRuntime();
  terminalWeb?.close();
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
