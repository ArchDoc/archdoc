import {
  Document,
  isCollection,
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  YAMLMap,
  YAMLSeq,
} from "yaml";

/**
 * Writes a changed YAML document back over the text it was parsed from,
 * rewriting only the lines whose values changed. Keys, items, and comments
 * that didn't change keep their text exactly, so an edit by ID makes the same
 * small diff a person would.
 */
export function patchYaml(original: string, before: Document, after: Document): string {
  padded = /\[ [^\s\]]/.test(original);
  const edits: Splice[] = [];
  const a = before.contents;
  const b = after.contents;
  if (!sameValue(a, b)) {
    if (isBlockMap(a) && isBlockMap(b)) diffMap(original, a, b, edits);
    else if (isBlockSeq(a) && isBlockSeq(b)) diffSeq(original, a, b, edits);
    else return stringify(after);
  }
  let out = original;
  const order = edits.map((e, i) => ({ ...e, i }));
  for (const e of order.sort((x, y) => y.start - x.start || y.end - x.end || y.i - x.i)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Parses YAML for editing: the document and a copy to change, which patchYaml compares. */
export function parseForEdit(text: string): { before: Document; after: Document } {
  const before = parseDocument(text, { keepSourceTokens: false });
  return { before, after: before.clone() };
}

/** A whole document, the way patchYaml writes new parts. */
export function stringify(doc: Document): string {
  return unpad(doc.toString(OPTIONS));
}

/** Whether the file being patched writes flow lists with spaces inside the brackets. */
let padded = false;

/**
 * Flow lists as people write them, [a, b], while flow maps keep their
 * spaces, { a: 1 }. The yaml library pads both or neither.
 */
function unpad(text: string): string {
  if (padded) return text;
  return text.replace(/\[ ([^[\]\n"']*?) \]/g, "[$1]");
}

const OPTIONS = { lineWidth: 0, minContentWidth: 0 } as const;

interface Splice {
  start: number;
  end: number;
  text: string;
}

function diffMap(text: string, a: YAMLMap, b: YAMLMap, edits: Splice[]): void {
  const indent = columnOf(text, start(a.items[0]?.key));
  const aPairs = new Map(a.items.map((p) => [keyOf(p), p]));
  const bKeys = new Set(b.items.map(keyOf));
  // Where the next new key goes: after the last pair that is still there.
  let anchor: number = lineStart(text, start(a.items[0]?.key));
  for (const p of b.items) {
    const key = keyOf(p);
    const old = aPairs.get(key);
    if (!old) {
      edits.push({ start: anchor, end: anchor, text: indentLines(pairText(p), indent) });
      continue;
    }
    const span = pairSpan(text, a, old);
    anchor = span.end;
    if (sameValue(old.value, p.value)) continue;
    const ov = old.value as Node | null;
    const nv = p.value as Node | null;
    if (isBlockMap(ov) && isBlockMap(nv) && ov.items.length && nv.items.length) {
      diffMap(text, ov, nv, edits);
    } else if (isBlockSeq(ov) && isBlockSeq(nv) && ov.items.length && nv.items.length) {
      diffSeq(text, ov, nv, edits);
    } else {
      edits.push({ ...span, text: indentLines(pairText(p), indent) });
    }
  }
  for (const [key, old] of aPairs) {
    if (!bKeys.has(key)) edits.push({ ...withComments(text, pairSpan(text, a, old)), text: "" });
  }
}

function diffSeq(text: string, a: YAMLSeq, b: YAMLSeq, edits: Splice[]): void {
  const indent = columnOf(text, dashOf(text, start(a.items[0])));
  const spans = a.items.map((_, i) => itemSpan(text, a, i));
  // Between items that didn't change, old items that did are paired with new
  // ones in order: changed in place, then the rest removed or added.
  const matched = [...align(a.items, b.items)].sort((x, y) => x[0] - y[0]);
  let ai = 0;
  let bi = 0;
  for (const [bm, am] of [...matched, [b.items.length, a.items.length] as const]) {
    const olds = range(ai, am);
    const news = range(bi, bm);
    let anchor = ai > 0 ? (spans[ai - 1] as Span).end : (spans[0]?.start ?? 0);
    for (const [k, n] of news.entries()) {
      const item = b.items[n] as Node;
      const o = olds[k];
      if (o === undefined) {
        edits.push({ start: anchor, end: anchor, text: indentLines(itemText(item), indent) });
        continue;
      }
      const span = spans[o] as Span;
      const was = a.items[o] as Node;
      if (isBlockMap(was) && isBlockMap(item) && was.items.length && item.items.length) {
        diffMap(text, was, item, edits);
      } else {
        edits.push({ ...span, text: indentLines(itemText(item), indent) });
      }
      anchor = span.end;
    }
    for (const o of olds.slice(news.length)) {
      edits.push({ ...withComments(text, spans[o] as Span), text: "" });
    }
    ai = am + 1;
    bi = bm + 1;
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

/** Which old item each new item is, by equal value, in order (a longest common subsequence). */
function align(a: unknown[], b: unknown[]): Map<number, number> {
  const av = a.map(jsonOf);
  const bv = b.map(jsonOf);
  const n = av.length;
  const m = bv.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] =
        av[i] === bv[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const out = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (av[i] === bv[j]) {
      out.set(j, i);
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number))
      i++;
    else j++;
  }
  return out;
}

interface Span {
  start: number;
  end: number;
}

/** A pair's lines: from its key's line to the end of its value's last line. */
function pairSpan(text: string, map: YAMLMap, pair: Pair): Span {
  const i = map.items.indexOf(pair);
  const from = lineStart(text, start(pair.key));
  const next = map.items[i + 1];
  const end = next ? lineStart(text, start(next.key)) : lineEnd(text, valueEnd(pair, map));
  return { start: from, end: trimTrailingComments(text, from, end, next !== undefined) };
}

function itemSpan(text: string, seq: YAMLSeq, i: number): Span {
  const item = seq.items[i] as Node;
  const from = lineStart(text, start(item));
  const next = seq.items[i + 1] as Node | undefined;
  const end = next ? lineStart(text, start(next)) : lineEnd(text, end3(item) ?? end3(seq) ?? from);
  return { start: from, end: trimTrailingComments(text, from, end, next !== undefined) };
}

/**
 * Comment lines and blank lines just before the next key belong to it, not to
 * the pair before: keep them when that pair changes.
 */
function trimTrailingComments(
  text: string,
  from: number,
  end: number,
  beforeNext: boolean,
): number {
  if (!beforeNext) return end;
  const lines = text.slice(from, end).split("\n");
  // The last element is "" (the text ends at a line start).
  let keep = lines.length - 1;
  while (keep > 1 && /^\s*(#.*)?$/.test(lines[keep - 1] as string)) keep--;
  return from + lines.slice(0, keep).join("\n").length + (keep < lines.length ? 1 : 0);
}

/** A span with the comment lines just above it, which go when it goes. */
function withComments(text: string, span: Span): Span {
  let start = span.start;
  while (start > 0) {
    const prev = lineStart(text, start - 1);
    if (!/^\s*#/.test(text.slice(prev, start))) break;
    start = prev;
  }
  return { start, end: span.end };
}

function valueEnd(pair: Pair, map: YAMLMap): number {
  const v = pair.value as Node | null;
  return (
    (v && isNode(v) ? v.range?.[1] : undefined) ?? end3(pair.key as Node) ?? map.range?.[1] ?? 0
  );
}

function end3(node: Node | undefined): number | undefined {
  return node?.range?.[1];
}

function start(node: unknown): number {
  return (node as Node | undefined)?.range?.[0] ?? 0;
}

function isNode(v: unknown): v is Node {
  return isScalar(v) || isCollection(v);
}

/** The dash before a block sequence item that starts at `at`. */
function dashOf(text: string, at: number): number {
  const i = text.lastIndexOf("-", at);
  return i >= 0 ? i : at;
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
  // `at` may already be the start of the next line (a block value's end).
  if (at > 0 && text[at - 1] === "\n") return at;
  const i = text.indexOf("\n", at);
  return i === -1 ? text.length : i + 1;
}

function columnOf(text: string, at: number): number {
  return at - lineStart(text, at);
}

function indentLines(block: string, indent: number): string {
  const pad = " ".repeat(indent);
  const body = block.endsWith("\n") ? block : `${block}\n`;
  return body
    .split("\n")
    .map((l, i, all) => (i === all.length - 1 || l === "" ? l : pad + l))
    .join("\n");
}

function pairText(pair: Pair): string {
  const map = new YAMLMap();
  map.items.push(pair);
  return stringifyNode(map);
}

function itemText(item: Node): string {
  const seq = new YAMLSeq();
  seq.items.push(item);
  return stringifyNode(seq);
}

function stringifyNode(node: Node): string {
  const doc = new Document();
  doc.contents = node;
  return unpad(doc.toString(OPTIONS));
}

function keyOf(p: Pair): string {
  return String(isScalar(p.key) ? p.key.value : p.key);
}

function isBlockMap(v: unknown): v is YAMLMap {
  return isMap(v) && !v.flow;
}

function isBlockSeq(v: unknown): v is YAMLSeq {
  return isSeq(v) && !v.flow;
}

function jsonOf(v: unknown): string {
  return JSON.stringify(isNode(v) ? v.toJSON() : v);
}

function sameValue(a: unknown, b: unknown): boolean {
  return jsonOf(a) === jsonOf(b);
}
