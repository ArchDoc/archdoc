#!/usr/bin/env node
// Starts the ArchDoc MCP server: npx -y <the CLI named in .mcp.json> mcp.
// Claude Code starts an MCP server's command without a shell, and on Windows
// npx is npx.cmd, which Node runs only through one. Starting node (an .exe
// everywhere) on this script, and npx from here, works on every platform.
import { spawn } from "node:child_process";

const cli = process.argv[2];
if (!cli || !/^@archdoc\/cli@[\w.-]+$/.test(cli)) {
  console.error("Usage: mcp.mjs @archdoc/cli@<version>");
  process.exit(2);
}
const windows = process.platform === "win32";
const child = spawn(windows ? "npx.cmd" : "npx", ["-y", cli, "mcp"], {
  stdio: "inherit",
  // Node runs a .cmd only through a shell; the arguments are checked above.
  shell: windows,
});
child.on("error", (e) => {
  console.error(
    `Couldn't start npx (${e.message}). ArchDoc needs Node.js 22.12 or later, with npx on PATH.`,
  );
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
