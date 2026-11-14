import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listRepoFiles, webUrlOf } from "../src/index.js";

describe("webUrlOf", () => {
  it.each([
    ["git@github.com:ArchDoc/archdoc.git", "https://github.com/ArchDoc/archdoc"],
    ["https://github.com/ArchDoc/archdoc.git", "https://github.com/ArchDoc/archdoc"],
    ["https://user:token@gitlab.com/group/sub/repo", "https://gitlab.com/group/sub/repo"],
    ["file:///tmp/repo", undefined],
  ])("%s", (remote, url) => {
    expect(webUrlOf(remote)).toBe(url);
  });
});

describe("listRepoFiles", () => {
  it("lists this repository's files, relative and sorted", async () => {
    const files = await listRepoFiles(fileURLToPath(new URL("../../../", import.meta.url)));
    expect(files).toContain("packages/core/src/codemap/glob.ts");
    expect(files.some((f) => f.includes("node_modules/"))).toBe(false);
    expect([...files].sort()).toEqual(files);
  });

  it("leaves out a tracked file deleted from the working tree before the deletion is staged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "archdoc-files-"));
    try {
      const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "kept.ts"), "");
      writeFileSync(join(dir, "gone.ts"), "");
      git("init", "-q");
      git("add", "-A");
      rmSync(join(dir, "gone.ts"));
      writeFileSync(join(dir, "new.ts"), "");
      expect(await listRepoFiles(dir)).toEqual(["kept.ts", "new.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
