import type { Doc } from "../parser/doc.js";
import type { Problem } from "./index.js";

export function noEmptyLinks(doc: Doc): Problem[] {
  return doc.links.filter((l) => l.trim() === "").map(() => ({ message: "Link has no target" }));
}
