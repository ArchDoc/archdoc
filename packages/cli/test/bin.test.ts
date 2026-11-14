import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
// Pretends to be another Node.js before the CLI's entry point runs.
const as = (version: string) =>
  `data:text/javascript,Object.defineProperty(process,"versions",{value:{...process.versions,node:"${version}"}})`;

describe("bin", () => {
  it("says which Node.js it needs on an older one, before loading anything", () => {
    const r = spawnSync(process.execPath, ["--import", as("20.11.0"), bin, "--version"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/needs Node\.js 22\.12 or later, and this is Node\.js 20\.11\.0/);
  });

  it("runs on 22.12", () => {
    const r = spawnSync(process.execPath, ["--import", as("22.12.0"), bin, "--version"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
