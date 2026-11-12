import { type CodeMap, locate, resolveCodeMap } from "../codemap/codemap.js";
import { compileGlob, normalizePath } from "../codemap/glob.js";
import { findSnippet, isSnippet, snippetLabel } from "../codemap/snippet.js";
import { evaluateDataRules } from "../data/rules.js";
import { type ImportedSchema, schemaDrift } from "../data/schemas.js";
import type { Diagnostic, Severity, SourceLocation } from "../diagnostics.js";
import type { ModelSource } from "../load/build.js";
import type { ElementNode, Model } from "../model.js";
import { nodeKey } from "../model.js";
import { checkPlan } from "../plan/check.js";
import type { Plan } from "../plan/plan.js";
import type { CodeIndex } from "../query/code-index.js";
import { fingerprints, parseSum, sealFindings, sealStatuses } from "../seal/seal.js";
import { checkTrace } from "../trace/check.js";
import type { Trace } from "../trace/trace.js";
import { evidenceOf, isDevTooling, type ObservedDependency } from "./observed.js";
import { evaluateRules, type RuleEdge } from "./rules.js";

export interface Finding {
  severity: Severity;
  /** drift/undeclared-dependency, rule/violation, drift/stale-path, drift/schema-*, model/orphan-element, model/component-outside-container, model/code-outside-component, or a validation code. */
  code: string;
  message: string;
  /** The element the finding is about, if any. */
  element?: string | undefined;
  rule?: string | undefined;
  /** Where the evidence is, such as packages/web/src/x.ts:12 (@archdoc/cli). */
  evidence: string[];
  /** What the message sums up, line by line, such as what changed under a seal. */
  details?: string[] | undefined;
  /** Repository files involved, to tell whether a change introduced the finding. */
  files: string[];
  location?: SourceLocation | undefined;
}

/** An element-level dependency seen in the code. */
export interface ObservedEdge {
  from: string;
  to: string;
  dependencies: ObservedDependency[];
  /** Every dependency behind it is type-only or a devDependency. */
  typeOnly: boolean;
  declared: boolean;
}

export interface CheckOptions {
  /** What analyzers saw in the code. Without it, only the model is checked. */
  observed?: ObservedDependency[];
  /** Repository files, for stale code paths. */
  files?: readonly string[];
  /** A repository file's text, for code snippets that no longer match it. */
  read?: (path: string) => string | undefined;
  /** What schema importers read for data entries' sources, for schema drift. */
  schemas?: readonly ImportedSchema[];
  /**
   * The repository's archdoc.sum, for facts whose code changed since they were
   * sealed. `text` is undefined when the repository doesn't keep one.
   */
  seals?: { file: string; text: string | undefined; index?: CodeIndex | undefined } | undefined;
  /** Traces in .archdoc/traces/, checked against the model and the code. */
  traces?: { traces: readonly Trace[]; diagnostics: readonly Diagnostic[] } | undefined;
  /**
   * Plans in .archdoc/plans/, checked against the model, with the model's
   * sources (and root file) to make each plan on a copy of.
   */
  plans?:
    | {
        plans: readonly Plan[];
        diagnostics: readonly Diagnostic[];
        sources: readonly ModelSource[];
        root?: string | undefined;
      }
    | undefined;
}

export interface CheckResult {
  findings: Finding[];
  edges: ObservedEdge[];
  codemap?: CodeMap | undefined;
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Compares the model with the code and with its own rules: undeclared
 * dependencies, rule violations, stale code paths, orphan elements, and the
 * model's validation problems (broken journeys among them).
 */
export function check(model: Model, options: CheckOptions = {}): CheckResult {
  const findings: Finding[] = model.diagnostics
    .filter((d) => d.severity !== "info")
    .map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      evidence: d.location ? [`${d.location.file}:${d.location.line}`] : [],
      files: d.location ? [d.location.file] : [],
      location: d.location,
    }));

  const edges = observedEdges(model, options.observed ?? []);
  for (const e of edges) {
    if (e.declared) continue;
    const from = model.elements.get(e.from);
    const to = model.elements.get(e.to);
    findings.push({
      severity: e.typeOnly ? "warning" : "error",
      code: "drift/undeclared-dependency",
      message: `${e.from} depends on ${e.to}${e.typeOnly ? " (types or dev tooling only)" : ""}, but the model doesn't declare it. Add "${to?.key ?? e.to}" to the uses of ${e.from}, or remove the dependency.`,
      element: e.from,
      evidence: e.dependencies.map(evidenceOf),
      files: [...new Set(e.dependencies.map((d) => d.from))],
      location: from?.location,
    });
  }

  const ruleEdges: RuleEdge[] = [
    ...model.relationships.map((r) => ({
      from: nodeKey(r.from),
      to: nodeKey(r.to),
      source: "declared",
      evidence: r.location ? [`${r.location.file}:${r.location.line}`] : [],
      files: r.location ? [r.location.file] : [],
    })),
    ...edges.map((e) => ({
      from: `element:${e.from}`,
      to: `element:${e.to}`,
      source: "observed",
      evidence: e.dependencies.map(evidenceOf),
      files: [...new Set(e.dependencies.map((d) => d.from))],
    })),
  ];
  // Org rules from the landscape run here too, named landscape/rule.
  const org = (model.landscape?.model.rules ?? [])
    .filter((r) => r.scope === "org")
    .map((r) => ({ ...r, id: `${model.landscape?.namespace}/${r.id}` }));
  const rules = evaluateRules(
    model,
    ruleEdges,
    [...model.rules, ...org],
    new Set(org.map((r) => r.id)),
  );
  for (const v of rules.violations) {
    const severity = v.rule.severity === "warning" ? "warning" : "error";
    const what = v.edge.source === "declared" ? "The model declares" : "The code has";
    findings.push({
      severity,
      code: "rule/violation",
      message: `${what} ${short(v.edge.from)} → ${short(v.edge.to)}, which breaks rule "${v.rule.id}"${v.rule.description ? `: ${v.rule.description}` : "."}`,
      element: v.edge.from.startsWith("element:") ? v.edge.from.slice(8) : undefined,
      rule: v.rule.id,
      evidence: v.edge.evidence,
      files: v.edge.files,
    });
  }
  // An import the model doesn't declare and a rule forbids is one problem: the rule's.
  // Declaring it in the model wouldn't fix it, so drop the undeclared-dependency finding
  // (unless the rule is only a warning, which would hide an error).
  const forbidden = new Set(
    rules.violations
      .filter((v) => v.edge.source === "observed" && v.rule.severity !== "warning")
      .map((v) => `${v.edge.from}→${v.edge.to}`),
  );
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i];
    if (f?.code !== "drift/undeclared-dependency") continue;
    const edge = edges.find(
      (e) =>
        e.from === f.element &&
        !e.declared &&
        forbidden.has(`element:${e.from}→element:${e.to}`) &&
        f.message.startsWith(`${e.from} depends on ${e.to}`),
    );
    if (edge) findings.splice(i, 1);
  }
  const quiet = new Set(org.map((r) => r.id));
  const dataViolations = evaluateDataRules(model, [...model.rules, ...org], (rule, selector) => {
    if (!quiet.has(rule)) rules.unknownSelectors.push({ rule, selector });
  });
  for (const v of dataViolations) {
    findings.push({
      severity: v.rule.severity === "warning" ? "warning" : "error",
      code: "rule/violation",
      message: `The model says ${v.message}`,
      element: v.element,
      rule: v.rule.id,
      evidence: v.location ? [`${v.location.file}:${v.location.line}`] : [],
      files: v.location ? [v.location.file] : [],
      location: v.location,
    });
  }
  for (const u of rules.unknownSelectors) {
    findings.push({
      severity: "warning",
      code: "rule/unknown-selector",
      message: `Rule "${u.rule}" names "${u.selector}", which isn't an element or actor in this model.`,
      rule: u.rule,
      evidence: [],
      files: [],
    });
  }

  let codemap: CodeMap | undefined;
  if (options.files) {
    codemap = resolveCodeMap(model, options.files);
    for (const s of codemap.stale) {
      const e = model.elements.get(s.element);
      findings.push({
        severity: "warning",
        code: "drift/stale-path",
        message: `${s.element} maps "${s.pattern}", which matches no file. Update its code paths.`,
        element: s.element,
        evidence: [],
        files: e?.location ? [e.location.file] : [],
        location: e?.location,
      });
    }
  }

  // Deployment definitions: the infrastructure code a node or a deployment points at.
  if (options.files) {
    const files = options.files.map(normalizePath);
    const sites = [
      ...[...model.deploymentNodes.values()]
        .filter((n) => n.spec.status !== "planned")
        .map((n) => ({ what: `Deployment node ${n.id}`, code: n.code, location: n.location })),
      ...model.deployments
        .filter((d) => d.status !== "planned")
        .map((d) => ({
          what: `${d.element}'s deployment to ${d.to}`,
          code: d.code,
          location: d.location,
        })),
    ];
    for (const site of sites) {
      for (const ref of site.code) {
        const re = compileGlob(ref.path);
        if (files.some((f) => re.test(f))) continue;
        findings.push({
          severity: "warning",
          code: "drift/stale-path",
          message: `${site.what} maps "${ref.path}", which matches no file. Update its code paths.`,
          evidence: [],
          files: site.location ? [site.location.file] : [],
          location: site.location,
        });
      }
    }
  }

  // Snippets: the lines are still there, and the file still declares the symbol.
  if (options.read) {
    for (const e of model.elements.values()) {
      for (const ref of e.code) {
        if (!isSnippet(ref)) continue;
        const text = options.read(ref.path);
        // A file that's gone is a stale path, reported above.
        if (text === undefined) continue;
        const found = findSnippet(ref, text);
        if (!("problem" in found)) continue;
        findings.push({
          severity: "warning",
          code: "drift/stale-snippet",
          message: `${e.id} points at ${snippetLabel(ref)}, but ${ref.path} ${found.problem}. Update the snippet.`,
          element: e.id,
          evidence: [],
          files: [ref.path, ...(e.location ? [e.location.file] : [])],
          location: e.location,
        });
      }
    }
  }

  findings.push(...schemaDrift(model, options.schemas ?? []));

  // Seals: facts whose code changed since someone checked the model against it.
  if (options.seals?.text !== undefined) {
    const parsed = parseSum(options.seals.text);
    if (!parsed.sum) {
      findings.push({
        severity: "error",
        code: "seal/invalid",
        message: `${options.seals.file} isn't a valid seal file (${parsed.error}). Run archdoc seal --all to write it again.`,
        evidence: [],
        files: [options.seals.file],
      });
    } else {
      const current = fingerprints(model, {
        files: options.files ?? [],
        read: options.read ?? (() => undefined),
        index: options.seals.index,
        schemas: options.schemas,
      });
      findings.push(...sealFindings(sealStatuses(current, parsed.sum), options.seals.file));
    }
  }

  // Traces: evidence of one run, checked like the model so a stale one shows up.
  if (options.traces) {
    const traceFinding = (d: Diagnostic, step?: string): Finding => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      evidence: [step ?? (d.location ? `${d.location.file}:${d.location.line}` : "")].filter(
        Boolean,
      ),
      files: d.location ? [d.location.file] : [],
      location: d.location,
    });
    for (const d of options.traces.diagnostics) {
      if (d.severity !== "info") findings.push(traceFinding(d));
    }
    for (const t of options.traces.traces) {
      const checked = checkTrace(model, t, { files: options.files, read: options.read });
      for (const f of checked.findings) {
        if (f.severity === "info") continue;
        findings.push(traceFinding(f, f.step ? `${f.trace} step ${f.step}` : f.trace));
      }
    }
  }

  // Plans: proposals on top of the model, checked so what's still open shows up.
  if (options.plans) {
    for (const d of options.plans.diagnostics) {
      if (d.severity === "info") continue;
      findings.push({
        severity: d.severity,
        code: d.code,
        message: d.message,
        evidence: [],
        files: d.location ? [d.location.file] : [],
        location: d.location,
      });
    }
    for (const p of options.plans.plans) {
      const checked = checkPlan(model, options.plans.sources, p, { root: options.plans.root });
      for (const f of checked.findings) {
        if (f.severity === "info") continue;
        findings.push({
          severity: f.severity,
          code: f.code,
          message: f.message,
          evidence: [f.item ? `${f.plan} ${f.item}` : f.plan],
          files: [p.file],
          location: f.location,
        });
      }
    }
  }

  for (const e of orphanElements(model)) {
    findings.push({
      severity: "warning",
      code: "model/orphan-element",
      message: `${e.id} has no relationships and no journey passes through it. Connect it with a use the code shows, or remove it if it isn't part of the system (build tooling often isn't). Don't add a use to quiet this.`,
      element: e.id,
      evidence: [],
      files: e.location ? [e.location.file] : [],
      location: e.location,
    });
  }

  findings.push(...misplaced(model));

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code));
  return { findings, edges, codemap };
}

/**
 * The layers nest: a component is a part of a container, and code (a
 * function, class, or file) is a part of a component. One that isn't inside
 * its layer is usually a container or a component written at the wrong level.
 */
function misplaced(model: Model): Finding[] {
  const out: Finding[] = [];
  const within = (e: ElementNode, kind: string) => {
    for (let p = e.parentId; p; p = model.elements.get(p)?.parentId) {
      if (model.elements.get(p)?.spec.kind === kind) return true;
    }
    return false;
  };
  for (const e of model.elements.values()) {
    const where = e.parentId ? `inside ${e.parentId}` : "at the top of the model";
    if (e.spec.kind === "component" && !within(e, "container")) {
      out.push({
        severity: "warning",
        code: "model/component-outside-container",
        message: `${e.id} is a component ${where}, not inside a container. Move it into the container whose code it is part of, or make it a container if it runs or ships on its own.`,
        element: e.id,
        evidence: [],
        files: e.location ? [e.location.file] : [],
        location: e.location,
      });
    }
    // A lean container has no components: its code elements sit in it directly.
    const lean = (() => {
      for (let p = e.parentId; p; p = model.elements.get(p)?.parentId) {
        const c = model.elements.get(p);
        if (c?.spec.kind === "container")
          return !c.childIds.some((k) => model.elements.get(k)?.spec.kind === "component");
      }
      return false;
    })();
    if (e.spec.kind === "code" && !within(e, "component") && !lean) {
      out.push({
        severity: "warning",
        code: "model/code-outside-component",
        message: `${e.id} is code ${where}, not inside a component. Move it into the component it is part of (code sits directly in a container only when the container has no components).`,
        element: e.id,
        evidence: [],
        files: e.location ? [e.location.file] : [],
        location: e.location,
      });
    }
  }
  return out;
}

/** Maps file-level dependencies onto elements, and marks which the model declares. */
export function observedEdges(model: Model, observed: ObservedDependency[]): ObservedEdge[] {
  const byPair = new Map<string, ObservedEdge>();
  for (const d of observed) {
    if (isDevTooling(d)) continue;
    const from = locate(model, d.from).element;
    const to = locate(model, d.to).element;
    if (!from || !to || related(from.id, to.id)) continue;
    const key = `${from.id}->${to.id}`;
    const edge = byPair.get(key) ?? {
      from: from.id,
      to: to.id,
      dependencies: [],
      typeOnly: true,
      declared: false,
    };
    edge.dependencies.push(d);
    edge.typeOnly &&= d.typeOnly === true;
    byPair.set(key, edge);
  }
  const declared = model.relationships.flatMap((r) =>
    r.from.type === "element" && r.to.type === "element" ? [{ from: r.from.id, to: r.to.id }] : [],
  );
  for (const e of byPair.values()) {
    const fromChain = selfAndAncestors(model, e.from);
    const toChain = selfAndAncestors(model, e.to);
    // A declaration on a parent covers its parts, and a declaration to a part covers the whole.
    e.declared = declared.some(
      (r) => fromChain.has(r.from) && (toChain.has(r.to) || isInside(r.to, e.to)),
    );
  }
  return [...byPair.values()].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
}

/** Elements with no relationships that no journey passes through. */
export function orphanElements(model: Model): ElementNode[] {
  const touched = new Set<string>();
  const mark = (id: string) => {
    for (const a of selfAndAncestors(model, id)) touched.add(a);
  };
  for (const r of model.relationships) {
    if (r.from.type === "element") mark(r.from.id);
    if (r.to.type === "element") mark(r.to.id);
  }
  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      for (const t of [s.from, s.to]) if (t?.type === "element") mark(t.id);
    }
  }
  // Code is a part of its component, judged with it: it needs no relationships of its own,
  // and a component made only of code is still a leaf.
  const isCode = (id: string) => model.elements.get(id)?.spec.kind === "code";
  return [...model.elements.values()].filter(
    (e) =>
      !touched.has(e.id) &&
      e.spec.kind !== "code" &&
      e.childIds.every(isCode) &&
      e.spec.kind !== "external" &&
      e.spec.status !== "planned" &&
      e.spec.status !== "deprecated",
  );
}

function selfAndAncestors(model: Model, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId) out.add(p);
  return out;
}

function related(a: string, b: string): boolean {
  return a === b || isInside(a, b) || isInside(b, a);
}

function isInside(id: string, ancestor: string): boolean {
  return id.startsWith(`${ancestor}.`);
}

function short(key: string): string {
  return key.replace(/^(element|actor|external):/, "");
}
