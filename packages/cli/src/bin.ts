#!/usr/bin/env node
// Checked before anything else loads, so an older Node gets this message
// rather than a syntax or module error from deep inside a dependency.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `ArchDoc needs Node.js 22.12 or later, and this is Node.js ${process.versions.node}. Install a newer Node.js from https://nodejs.org, then run the command again.`,
  );
  process.exit(1);
}

const { createProgram } = await import("./program.js");
const program = createProgram();
await program.parseAsync(process.argv);
process.exitCode = program.exitCode ?? 0;
