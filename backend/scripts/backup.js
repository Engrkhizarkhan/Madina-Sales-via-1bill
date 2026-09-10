import dotenv from "dotenv";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

dotenv.config({ path: resolve("backend", ".env") });

const backupDirectory = resolve("backend", "backups");
await mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const destination = resolve(backupDirectory, `madina-express-${stamp}.sql`);
const executable = process.env.MYSQLDUMP_PATH || "C:\\xamppp\\mysql\\bin\\mysqldump.exe";
const child = spawn(executable, [
  `--host=${process.env.DB_HOST || "127.0.0.1"}`,
  `--port=${process.env.DB_PORT || "3306"}`,
  `--user=${process.env.DB_USER}`,
  "--single-transaction",
  "--routines",
  "--triggers",
  "--default-character-set=utf8mb4",
  process.env.DB_NAME,
], {
  windowsHide: true,
  env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" },
  stdio: ["ignore", "pipe", "pipe"],
});

const output = createWriteStream(destination, { encoding: "utf8" });
child.stdout.pipe(output);
const outputFinished = new Promise((resolveOutput, rejectOutput) => {
  output.once("finish", resolveOutput);
  output.once("error", rejectOutput);
});
let errorOutput = "";
child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
const exitCode = await new Promise((resolveExit, rejectExit) => {
  child.once("error", rejectExit);
  child.once("close", resolveExit);
});
if (exitCode !== 0) throw new Error(errorOutput.trim() || `mysqldump exited with code ${exitCode}`);
await outputFinished;
console.log(destination);
