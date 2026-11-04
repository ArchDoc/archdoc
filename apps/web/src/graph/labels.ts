import type { Graph, GraphEdge } from "./graph.js";

/** A line's description, wrapped to sit on it, and the room it takes. */
export interface EdgeLabel {
  /** The whole description, for the tooltip. */
  text: string;
  /** The lines drawn, the last one cut short when there's more. */
  lines: string[];
  width: number;
  height: number;
}

/** The widest a description gets before it wraps, in pixels. */
export const LABEL_WIDTH = 184;
/** How many lines of a description show; the rest is in the tooltip. */
export const LABEL_LINES = 3;
const CHAR = 6.9;
const LINE = 16;
const PAD_X = 12;
const PAD_Y = 6;

/**
 * What a use says: its description (or each description, when it stands for
 * several uses inside a closed box), and for a subscription, the channel and
 * how it travels. Lines between tables say nothing; their rows do.
 */
export function edgeText(e: GraphEdge): string {
  if (e.reference || e.rows) return "";
  const channel = e.subscription
    ? `${e.subscription.channel}${e.subscription.transport ? ` (${e.subscription.transport})` : ""}`
    : "";
  const said = [...new Set(e.relationships.map((r) => r.description).filter(Boolean))];
  if (said.length > 2) {
    // Lifted to a closed box: one description, and how many more there are.
    return [channel, `${said[0]} (+${said.length - 1} more)`].filter(Boolean).join(" · ");
  }
  return [channel, ...said].filter(Boolean).join(" · ");
}

/** Wraps text into lines of at most `max` characters, the last one cut short. */
export function wrap(text: string, max: number, lines = LABEL_LINES): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let word = words[i] as string;
    // A word longer than a line, such as a path, is cut where the line ends.
    while (word.length > max) {
      if (line) {
        out.push(line);
        line = "";
      }
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  const last = kept[lines - 1] as string;
  kept[lines - 1] = `${last.length >= max ? last.slice(0, max - 1) : last}…`;
  return kept;
}

/**
 * The label a line gets: its text wrapped, and the box it needs. Several parts,
 * such as the journey steps that go along one line, each start a line of their
 * own and get two lines each.
 */
export function labelFor(text: string | string[]): EdgeLabel | undefined {
  const parts = (Array.isArray(text) ? text : [text]).filter(Boolean);
  if (!parts.length) return undefined;
  const max = Math.floor((LABEL_WIDTH - PAD_X) / CHAR);
  const lines = parts.flatMap((p) => wrap(p, max, parts.length > 1 ? 2 : LABEL_LINES));
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    text: parts.join("\n"),
    lines,
    width: Math.ceil(Math.min(LABEL_WIDTH, longest * CHAR + PAD_X)),
    height: lines.length * LINE + PAD_Y,
  };
}

/** Each use's label, by edge, for the layout to make room for and the map to draw. */
export function edgeLabels(graph: Graph): Map<string, EdgeLabel> {
  const out = new Map<string, EdgeLabel>();
  for (const e of graph.edges) {
    const label = labelFor(edgeText(e));
    if (label) out.set(e.id, label);
  }
  return out;
}
