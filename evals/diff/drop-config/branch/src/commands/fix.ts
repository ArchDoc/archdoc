import { parse } from "../parser/parse.js";
import { runRules } from "../rules/index.js";

export async function fix(files: string[]) {
  for (const f of files) for (const p of runRules(await parse(f))) p.fix?.();
}
