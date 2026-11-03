import type { Doc } from "../parser/doc.js";
import type { Problem } from "./index.js";

export function headingCase(doc: Doc): Problem[] {
  return doc.headings
    .filter((h) => h !== h.charAt(0).toUpperCase() + h.slice(1))
    .map((h) => ({ message: `Capitalize "${h}"` }));
}
