import type { Doc } from "../parser/doc.js";
import { headingCase } from "./heading-case.js";
import { noDeadLinks } from "./no-dead-links.js";
import { noEmptyLinks } from "./no-empty-links.js";

export interface Problem {
  message: string;
  fix?: () => void;
}

export function runRules(doc: Doc): Problem[] {
  return [headingCase, noEmptyLinks, noDeadLinks].flatMap((r) => r(doc));
}
