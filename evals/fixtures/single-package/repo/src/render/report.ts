import type { Problem } from "../rules/index.js";

export function report(file: string, problems: Problem[]) {
  for (const p of problems) console.log(`${file}: ${p.message}`);
}
