const FUNCTIONS = ["up", "latency"];

/** The functions a partial query could be completing. */
export function complete(q: string): string[] {
  if (q.includes("(")) return [];
  return FUNCTIONS.filter((f) => f.startsWith(q) && f !== q);
}
