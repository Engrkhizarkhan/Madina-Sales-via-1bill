import { spawn } from "node:child_process";
import { createConnection } from "node:net";

export function runProcess(command, args, { input, cwd, timeout = 120000, maxOutput = 1024 * 1024, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    let size = 0;
    let errorOutput = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", data => {
      size += data.length;
      if (size > maxOutput) child.kill();
      else output.push(data);
    });
    child.stderr.on("data", data => {
      if (errorOutput.length < 8192) errorOutput += data.toString();
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0 && size <= maxOutput) resolve(Buffer.concat(output).toString());
      else reject(new Error(`The setup operation failed (${code ?? "timeout"}). ${errorOutput.slice(-600)}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

export function terminalControl(action, payload = {}) {
  const actions = ["prepare", "register", "freeze", "activate", "abort", "status", "reset"];
  if (!actions.includes(action) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Promise.reject(new Error("Invalid terminal-control request."));
  }
  const request = JSON.stringify({ action, payload }) + "\n";
  if (Buffer.byteLength(request) > 16384) return Promise.reject(new Error("The setup request is too large."));
  return new Promise((resolve, reject) => {
    const socket = createConnection("/run/madina-terminal-control.sock");
    let response = "";
    const timer = setTimeout(() => socket.destroy(new Error("The terminal setup request timed out.")), 185000);
    socket.on("connect", () => socket.end(request));
    socket.on("data", chunk => {
      response += chunk.toString();
      if (Buffer.byteLength(response) > 32768) socket.destroy(new Error("Invalid terminal-control response."));
    });
    socket.on("error", error => { clearTimeout(timer); reject(error); });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(response);
        if (!result.ok) throw new Error(result.error || "Terminal setup could not finish.");
        resolve(result.result);
      } catch (error) { reject(error); }
    });
  });
}
