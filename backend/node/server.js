import { app } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db.js";

const server = app.listen(config.port, config.host, () => {
  console.log(`Madina Express Node API listening on http://${config.host}:${config.port}`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
