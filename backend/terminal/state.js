import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../node/config.js";

export async function terminalState() {
  if (!config.terminal.cloud) return { phase: "standalone" };
  try {
    return JSON.parse(await readFile(join(config.terminal.directory, "state.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { phase: "standalone" };
    throw error;
  }
}

export async function cloudAuthorityGuard(req, _res, next) {
  try {
    const state = await terminalState();
    req.cloudReadOnly = ["preparing", "active"].includes(state.phase);
    if (req.cloudReadOnly && !["GET", "HEAD"].includes(req.method) &&
        !["/auth/login", "/auth/logout", "/auth/finance-unlock", "/public/ticket-lookup", "/terminal/cancel-setup"].includes(req.path)) {
      const { ApiError } = await import("../node/helpers.js");
      return next(new ApiError("The main PC is offline or being set up. You can view synced data here; make changes at the terminal's local address until it reconnects.", 503, "terminal_unavailable"));
    }
    next();
  } catch (error) { next(error); }
}
