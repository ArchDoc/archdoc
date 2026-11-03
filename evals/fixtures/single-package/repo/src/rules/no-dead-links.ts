import type { Doc } from "../parser/doc.js";
import type { Problem } from "./index.js";

export function noDeadLinks(doc: Doc): Problem[] {
  return doc.links.filter((l) => l === "" || l === "#").map(() => ({ message: "Empty link" }));
}
