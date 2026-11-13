import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../node/config.js";

export async function terminalState() {
  if (!config.terminal.cloud) return { phase: "standalone" };
  let state={phase:"standalone"};
  try {state=JSON.parse(await readFile(join(config.terminal.directory,"state.json"),"utf8"));}
  catch(error){if(error.code!=="ENOENT")throw error;}
  try {await readFile(join(config.terminal.directory,"require-main.json"));state.requiresMain=true;}
  catch(error){if(error.code!=="ENOENT")throw error;}
  return state;
}

export const cloudNeedsMain = state => Boolean(state.requiresMain) || ["awaiting-main","provisioned","preparing","active"].includes(state.phase);

export async function cloudAuthorityGuard(req, _res, next) {
  try {
    const state = await terminalState();
    req.cloudReadOnly = cloudNeedsMain(state);
    if (req.cloudReadOnly && !["GET", "HEAD"].includes(req.method) &&
        !["/auth/login", "/auth/logout", "/auth/finance-unlock", "/public/ticket-lookup", "/terminal/package", "/terminal/cancel-setup", "/updates/control"].includes(req.path)) {
      const { ApiError } = await import("../node/helpers.js");
      return next(new ApiError("The main PC is offline or being set up. You can view synced data here; make changes at the terminal's local address until it reconnects.", 503, "terminal_unavailable"));
    }
    next();
  } catch (error) { next(error); }
}
