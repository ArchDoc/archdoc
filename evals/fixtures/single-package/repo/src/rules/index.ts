import type { Config } from "../config.js";
import type { Doc } from "../parser/doc.js";
import { headingCase } from "./heading-case.js";
import { noDeadLinks } from "./no-dead-links.js";

export interface Problem {
  message: string;
  fix?: () => void;
}

export function runRules(doc: Doc, config: Config): Problem[] {
  return [headingCase, noDeadLinks]
    .filter((r) => !config.off.includes(r.name))
    .flatMap((r) => r(doc));
}
