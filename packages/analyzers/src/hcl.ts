// A small reader for Terraform's HCL: the blocks, their labels, and their
// attributes as source text. Enough to read what resources a configuration
// declares and how they reference each other, not to evaluate it.

/** A block such as `resource "aws_sqs_queue" "jobs" { ... }`. */
export interface HclBlock {
  type: string;
  labels: string[];
  /** Attributes by name, as their source text (strings keep their quotes). */
  attrs: Record<string, string>;
  blocks: HclBlock[];
  /** The block's whole text, for finding references in it. */
  text: string;
  /** 1-based line the block starts on. */
  line: number;
}

/** The top-level blocks of an HCL file. Unreadable parts are skipped. */
export function parseHcl(text: string): HclBlock[] {
  const src = stripComments(text);
  return parseBody(src, 0, src.length, lineStarts(src)).blocks;
}

/** A string attribute's value, without quotes; undefined when it isn't a plain string literal. */
export function hclString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(value.trim());
  return m ? (m[1] as string).replace(/\\"/g, '"') : undefined;
}

/** The references in some HCL text, such as aws_dynamodb_table.bookings. */
export function hclReferences(text: string): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  for (const m of text.matchAll(/\b((?:data\.)?[a-z][a-z0-9_]*)\.([A-Za-z_][\w-]*)\b/g)) {
    out.push({ type: m[1] as string, name: m[2] as string });
  }
  return out;
}

function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") out.push(i + 1);
  return out;
}

function lineAt(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Replaces comments with spaces, so offsets and lines stay where they were. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "#" || (c === "/" && text[i + 1] === "/")) {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "<" && text[i + 1] === "<") {
      // A heredoc: <<EOF or <<-EOF, up to the line that ends it.
      const m = /^<<-?([A-Za-z_]\w*)\n/.exec(text.slice(i, i + 80));
      if (!m) {
        out += c;
        i++;
        continue;
      }
      const end = new RegExp(`\\n\\s*${m[1]}\\s*(\\n|$)`).exec(text.slice(i + m[0].length - 1));
      const stop = end ? i + m[0].length - 1 + end.index + end[0].length : text.length;
      out += text.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Where a string that opens at `i` ends, past its closing quote, skipping ${...}. */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  let depth = 0;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") j += 2;
    else if (c === "$" && text[j + 1] === "{") {
      depth++;
      j += 2;
    } else if (c === "}" && depth > 0) {
      depth--;
      j++;
    } else if (c === '"' && depth === 0) return j + 1;
    else if (c === "\n" && depth === 0) return j;
    else j++;
  }
  return j;
}

/** Where the bracket that opens at `i` closes, past it. */
function closing(src: string, i: number): number {
  const open = src[i];
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"') {
      j = stringEnd(src, j);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return src.length;
}

function parseBody(
  src: string,
  start: number,
  end: number,
  starts: number[],
): { attrs: Record<string, string>; blocks: HclBlock[] } {
  const attrs: Record<string, string> = {};
  const blocks: HclBlock[] = [];
  let i = start;
  const ws = () => {
    while (i < end && /[\s,]/.test(src[i] as string)) i++;
  };
  while (i < end) {
    ws();
    if (i >= end) break;
    const at = i;
    const ident = /^[A-Za-z_][\w-]*/.exec(src.slice(i, Math.min(end, i + 200)));
    if (!ident) {
      // Something this reader doesn't know: skip to the next line.
      const nl = src.indexOf("\n", i);
      i = nl < 0 || nl > end ? end : nl + 1;
      continue;
    }
    const name = ident[0];
    i += name.length;
    // Labels, then = (an attribute) or { (a block).
    const labels: string[] = [];
    for (;;) {
      while (i < end && /[ \t]/.test(src[i] as string)) i++;
      if (src[i] === '"') {
        const e = stringEnd(src, i);
        labels.push(src.slice(i + 1, e - 1));
        i = e;
      } else if (/[A-Za-z_]/.test(src[i] ?? "") && labels.length) {
        const m = /^[A-Za-z_][\w-]*/.exec(src.slice(i));
        labels.push(m?.[0] ?? "");
        i += m?.[0].length ?? 1;
      } else break;
    }
    while (i < end && /[ \t]/.test(src[i] as string)) i++;
    if (src[i] === "=" && src[i + 1] !== "=") {
      i++;
      while (i < end && /[ \t]/.test(src[i] as string)) i++;
      const v0 = i;
      // A value runs to the end of the line, past any brackets it opens.
      while (i < end && src[i] !== "\n") {
        const c = src[i];
        if (c === '"') i = stringEnd(src, i);
        else if (c === "{" || c === "[" || c === "(") i = closing(src, i);
        else i++;
      }
      attrs[name] = src.slice(v0, i).trim();
    } else if (src[i] === "{") {
      const close = closing(src, i);
      const body = parseBody(src, i + 1, close - 1, starts);
      blocks.push({
        type: name,
        labels,
        ...body,
        text: src.slice(at, close),
        line: lineAt(starts, at),
      });
      i = close;
    } else {
      const nl = src.indexOf("\n", i);
      i = nl < 0 || nl > end ? end : nl + 1;
    }
  }
  return { attrs, blocks };
}
