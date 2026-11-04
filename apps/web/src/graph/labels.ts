import type { Graph, GraphEdge } from "./graph.js";
import type { Box, Point } from "./layout.js";

/** A line's description, wrapped to fit beside it, and the room it takes. */
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

/**
 * Moves a label placed against its line until it's at least `gap` pixels off
 * it, the way it already sits (above or below a level stretch, beside an
 * upright one), so what a journey puts on the line doesn't cover it.
 */
export function clearOf(box: Box, points: readonly Point[] | undefined, gap: number): Box {
  if (!points || points.length < 2) return box;
  let best: { d: number; dx: number; dy: number } | undefined;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const level = Math.abs(a.y - b.y) < 0.5;
    const upright = Math.abs(a.x - b.x) < 0.5;
    if (level && box.x < Math.max(a.x, b.x) && box.x + box.width > Math.min(a.x, b.x)) {
      const above = box.y + box.height <= a.y + 0.5;
      const d = above ? a.y - (box.y + box.height) : box.y - a.y;
      if (d >= -0.5 && (!best || d < best.d)) best = { d, dx: 0, dy: above ? -1 : 1 };
    } else if (upright && box.y < Math.max(a.y, b.y) && box.y + box.height > Math.min(a.y, b.y)) {
      const left = box.x + box.width <= a.x + 0.5;
      const d = left ? a.x - (box.x + box.width) : box.x - a.x;
      if (d >= -0.5 && (!best || d < best.d)) best = { d, dx: left ? -1 : 1, dy: 0 };
    }
  }
  if (!best || best.d >= gap) return box;
  const by = gap - Math.max(0, best.d);
  return { ...box, x: box.x + best.dx * by, y: box.y + best.dy * by };
}
