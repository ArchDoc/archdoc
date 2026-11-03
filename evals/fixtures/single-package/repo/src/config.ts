import { readFile } from "node:fs/promises";

export interface Config {
  off: string[];
}

export async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(".mdlintrc.json", "utf8"));
  } catch {
    return { off: [] };
  }
}
