import { parse } from "../parser/parse.js";
import { report } from "../render/report.js";
import { runRules } from "../rules/index.js";

export async function check(files: string[]) {
  for (const f of files) report(f, runRules(await parse(f)));
}
