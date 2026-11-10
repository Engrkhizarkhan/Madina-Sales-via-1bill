import { app } from "./app.js";
import { config } from "./config.js";
import { releaseExpiredReservations } from "./operations.js";
import { closePool } from "./db.js";

const server = app.listen(config.port, config.host, () => {
  console.log(`Madina Express Node API listening on http://${config.host}:${config.port}`);
});

const expireReservations = () => releaseExpiredReservations().catch(error => {
  console.error("Could not release expired web reservations:", error.code || error.message);
});
void expireReservations();
const expiryTimer = setInterval(expireReservations, 60_000).unref();

const shutdown = async (signal) => {
  clearInterval(expiryTimer);
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
