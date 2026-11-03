import { readFile } from "node:fs/promises";
import { micromark } from "micromark";
import { type Doc, toDoc } from "./doc.js";

export async function parse(file: string): Promise<Doc> {
  return toDoc(micromark(await readFile(file, "utf8")));
}
