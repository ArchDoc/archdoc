import type { PlanUnreadSpec } from "@archdoc/spec";
import { formatDiagnostic } from "../diagnostics.js";
import type { PlanCheck } from "../plan/check.js";
import {
  changeOp,
  describeChange,
  isAgreed,
  openIntents,
  type Plan,
  planStatusOf,
} from "../plan/plan.js";

// Plans as text, shared by `archdoc plan` and the archdoc_plan MCP tool.

const ICON = { error: "✗", warning: "!", info: "i" } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Plans, one line each. */
export function formatPlanList(checks: readonly PlanCheck[]): string {
  if (!checks.length)
    return "No plans. Start one with archdoc plan start (or archdoc_plan with action start) and the idea in a sentence.";
  return checks
    .map((c) => {
      const o = c.open;
      const parts = [
        c.status,
        ...(c.plan.spec.intents.length ? [plural(c.plan.spec.intents.length, "intent")] : []),
        plural(c.plan.spec.changes.length, "change"),
        plural(c.plan.spec.sequences.length, "sequence"),
      ];
      if (o.intents) parts.push(`${plural(o.intents, "intent")} to work out`);
      if (o.questions) parts.push(plural(o.questions, "open question"));
      if (o.suggestions) parts.push(plural(o.suggestions, "suggestion"));
      if (o.unread) parts.push(`${o.unread} unread`);
      if (o.tasks.total) parts.push(`tasks ${o.tasks.done}/${o.tasks.total}`);
      return `${c.plan.id} · ${c.plan.spec.title}\n    ${parts.join(" · ")}`;
    })
    .join("\n");
}

function mark(item: { status?: string | undefined; by?: string | undefined }): string {
  if (item.status === "suggested") return " [suggested]";
  if (item.status === "dismissed") return " [dismissed]";
  return "";
}

/**
 * A plan to read: its goal, every change and sequence with the intent behind
 * it, the notes and their threads, what it reaches, what the check found,
 * and the tasks. With `unread`, what the person changed since the last read
 * comes first.
 */
export function formatPlan(
  check: PlanCheck,
  options: { unread?: readonly PlanUnreadSpec[] | undefined } = {},
): string {
  const { plan } = check;
  const s = plan.spec;
  const out = [`${plan.id}: ${s.title}`, `Status: ${planStatusOf(s)} · ${plan.file}`];
  if (s.goal)
    out.push(
      "",
      "Goal:",
      ...s.goal
        .trim()
        .split("\n")
        .map((l) => `  ${l}`),
    );

  const unread = options.unread ?? [];
  if (unread.length) {
    out.push("", `Changed by the person since your last read (${unread.length}):`);
    for (const u of unread) out.push(`  ${u.what} ${u.id}${describeItem(plan, u.id)}`);
  }

  if (s.intents.length) {
    const open = new Set(openIds(check));
    out.push("", "Intents (what the person wants, where they clicked):");
    for (const n of s.intents) {
      const carried = [...s.changes, ...s.sequences]
        .filter((x) => x.status !== "dismissed" && x.for?.includes(n.id))
        .map((x) => x.id);
      const state = n.resolved
        ? "settled"
        : open.has(n.id)
          ? "to work out"
          : `carried out by ${carried.join(", ")}`;
      out.push(`  ${n.id}${n.on ? ` on ${n.on}` : " on the system"} (${state}): ${n.text.trim()}`);
    }
  }

  // Once it's agreed, each change as the archdoc edit op that makes it.
  const building = ["ready", "executing"].includes(planStatusOf(s));
  if (s.changes.length) {
    out.push("", "Changes:");
    for (const c of s.changes) {
      out.push(
        `  ${c.id} ${describeChange(c)}${mark(c)}${c.by ? ` · ${c.by}` : ""}${c.for?.length ? ` · for ${c.for.join(", ")}` : ""}`,
      );
      out.push(`      intent: ${c.intent?.trim() || "(none yet)"}`);
      const fields = c.add ?? c.set;
      if (building && isAgreed(c)) out.push(`      archdoc edit: ${JSON.stringify(changeOp(c))}`);
      else if (fields) {
        const { id: _i, type: _t, ...rest } = fields;
        if (Object.keys(rest).length) out.push(`      ${JSON.stringify(rest)}`);
      }
    }
  }
  if (s.sequences.length) {
    out.push("", "Sequences:");
    for (const q of s.sequences) {
      out.push(
        `  ${q.id} journey ${q.journey}${q.name ? ` (${q.name})` : ""}${mark(q)}${q.actor ? ` · ${q.actor}` : ""}${q.for?.length ? ` · for ${q.for.join(", ")}` : ""}${q.goal ? `: ${q.goal}` : ""}`,
      );
      for (const [i, st] of q.steps.entries()) {
        out.push(
          `    ${i + 1}. ${st.from} → ${st.to}${st.action ? `: ${st.action}` : ""}${mark(st)}${st.sends ? ` (sends ${[st.sends].flat().join(", ")})` : ""}`,
        );
        out.push(`         intent: ${st.intent?.trim() || "(none yet)"}`);
      }
    }
  }
  if (s.notes.length) {
    out.push("", "Notes:");
    for (const n of s.notes) {
      out.push(
        `  ${n.id} ${n.kind ?? "note"}${n.on ? ` on ${n.on}` : ""}${n.resolved ? " (resolved)" : ""} · ${n.by ?? "?"}: ${n.text}`,
      );
      for (const r of n.replies ?? [])
        out.push(`      ↳ ${r.kind ?? "reply"} · ${r.by ?? "?"}: ${r.text}`);
    }
  }

  const r = check.reach;
  out.push("", "Reaches:");
  out.push(`  elements: ${r.elements.join(", ") || "none yet"}`);
  out.push(
    `  journeys: ${
      r.journeys
        .map(
          (j) =>
            `${j.id}${j.added ? " (new)" : j.changed ? " (changed)" : ""}${j.importance !== "normal" ? ` [${j.importance}]` : ""}`,
        )
        .join(", ") || "none"
    }`,
  );
  out.push(`  actors: ${r.actors.join(", ") || "none"}`);
  if (r.owners.length) out.push(`  owners: ${r.owners.join(", ")}`);
  if (r.elsewhere.length) out.push(`  other repos: ${r.elsewhere.join(", ")}`);
  const critical = r.journeys.filter((j) => j.importance === "critical");
  if (critical.length)
    out.push(
      `  Critical journeys (${critical.map((j) => j.id).join(", ")}): ask the person before changing them.`,
    );

  if (s.tasks.length) {
    out.push("", `Tasks (${check.open.tasks.done}/${check.open.tasks.total} done):`);
    for (const t of s.tasks) {
      out.push(
        `  ${t.id} [${t.status ?? "todo"}] ${t.title}${t.from?.length ? ` (${t.from.join(", ")})` : ""}`,
      );
      if (t.files?.length) out.push(`      files: ${t.files.join(", ")}`);
      if (t.tests?.length) out.push(`      tests: ${t.tests.join(", ")}`);
      if (t.after?.length) out.push(`      after: ${t.after.join(", ")}`);
    }
  }

  out.push("", "Check:");
  if (!check.findings.length) out.push("  ✓ Nothing to fix.");
  for (const f of check.findings) out.push(`  ${ICON[f.severity]} ${formatDiagnostic(f)}`);
  out.push("", nextStep(check));
  return out.join("\n");
}

/** What to do next, from where the plan stands. */
export function nextStep(check: PlanCheck): string {
  const o = check.open;
  switch (check.status) {
    case "drafting":
      return "Next: the person is writing what they want on the map in the explorer's Plan tab. Wait for them to send it (archdoc plan wait), or read what's there now.";
    case "reviewing": {
      const breaks = check.findings.filter(
        (f) => f.code === "plan/would-break" || f.code === "plan/cannot-apply",
      ).length;
      const left = [
        o.intents && `${plural(o.intents, "intent")} to work out`,
        o.missingIntent && `${plural(o.missingIntent, "item")} without intent`,
        o.questions && plural(o.questions, "open question"),
        o.suggestions && `${plural(o.suggestions, "suggestion")} waiting`,
        breaks && `${plural(breaks, "check finding")} the plan would add`,
      ].filter(Boolean);
      return `Next: check each intent against the code (archdoc_context on what it touches) and carry out what it says, no more, with archdoc plan respond: suggested changes and sequences, each with for: [the intent it carries out]. Where an intent leaves a design choice open, ask with a question on it naming the options instead of choosing; add insights and risks as notes; never edit the person's items.${left.length ? ` Still open: ${left.join(", ")}.` : " Nothing is open: tell the person it can be marked ready."}`;
    }
    case "ready":
      return check.plan.spec.tasks.length
        ? "Next: carry out the tasks in order (archdoc plan task <id> --status doing/done), making each change with archdoc edit as its code lands."
        : "Next: write the tasks that carry the plan out (archdoc plan respond with tasks), then set it executing.";
    case "executing":
      return `Next: ${o.tasks.total - o.tasks.done} task${o.tasks.total - o.tasks.done === 1 ? "" : "s"} left. Mark each done as it lands; set the plan done when they all are.`;
    default:
      return `This plan is ${check.status}.`;
  }
}

function openIds(check: PlanCheck): string[] {
  return openIntents(check.plan.spec).map((n) => n.id);
}

function describeItem(plan: Plan, id: string): string {
  const s = plan.spec;
  const intent = s.intents.find((x) => x.id === id);
  if (intent) return `: ${intent.on ? `on ${intent.on}: ` : ""}${intent.text.trim()}`;
  const c = s.changes.find((x) => x.id === id);
  if (c) return `: ${describeChange(c)}${c.intent ? ` (${c.intent.trim().split("\n")[0]})` : ""}`;
  const [seq, step] = id.split("#");
  const q = s.sequences.find((x) => x.id === seq);
  if (q && step) {
    const st = q.steps[Number(step) - 1];
    return st ? `: ${st.from} → ${st.to}${st.intent ? ` (${st.intent})` : ""}` : "";
  }
  if (q) return `: journey ${q.journey}${isAgreed(q) ? "" : mark(q)}`;
  const n = s.notes.find((x) => x.id === id);
  if (n) {
    const last = n.replies?.at(-1);
    return `: ${last ? `${last.by ?? "?"} replied "${last.text}"` : n.text}`;
  }
  return "";
}
