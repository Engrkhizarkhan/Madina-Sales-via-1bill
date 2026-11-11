import { spawn } from "node:child_process";

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

export async function terminalControl(action, payload) {
  const result = await runProcess("sudo", ["-n", "/usr/local/libexec/madina-terminal-control", action], {
    input: JSON.stringify(payload || {}), timeout: 180000,
  });
  return JSON.parse(result);
}
