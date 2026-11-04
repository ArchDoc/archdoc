import { subscriptionOf } from "../data/flows.js";
import type {
  Deployment,
  DeploymentNode,
  ElementNode,
  EnvironmentNode,
  Model,
  Relationship,
} from "../model.js";

/**
 * Where an element runs: its own deployments, or those of the nearest
 * enclosing element that has some (a component runs where its container does).
 */
export function deploymentsOf(
  model: Model,
  elementId: string,
): { from: string; deployments: Deployment[] } | undefined {
  for (let id: string | undefined = elementId; id; id = model.elements.get(id)?.parentId) {
    const own = model.deployments.filter((d) => d.element === id);
    if (own.length) return { from: id, deployments: own };
  }
  return undefined;
}

/** Where a deployment runs, outermost first: environment, then each node down to its own. */
export function deploymentPath(model: Model, d: Deployment): string[] {
  const out: string[] = [];
  for (let id = d.node; id; id = model.deploymentNodes.get(id)?.parentId) out.unshift(id);
  return [d.environment, ...out];
}

/** A deployed element as the infrastructure view draws it. */
export interface PlacedElement {
  element: ElementNode;
  /** The node it runs on, or undefined when it's deployed to the environment as a whole. */
  node?: string | undefined;
  deployment: Deployment;
}

/** A use between two boxes in the infrastructure view: lifted from what's inside them. */
export interface DeploymentLink {
  /** `element:<id>` or `actor:<id>`. */
  from: string;
  to: string;
  relationships: Relationship[];
  /** A subscription: drawn from the publisher to the subscriber, the way its messages go. */
  subscription?: { channel: string; transport?: string | undefined } | undefined;
}

/** What one environment's infrastructure view shows. */
export interface DeploymentView {
  environment: EnvironmentNode;
  /** Its nodes, outermost first. */
  nodes: DeploymentNode[];
  placed: PlacedElement[];
  /**
   * Things the deployed elements talk to that aren't deployed here: actors,
   * externals, and elements deployed elsewhere or nowhere.
   */
  outside: string[];
  links: DeploymentLink[];
  /** Containers that say nothing about this environment. */
  missing: ElementNode[];
}

/**
 * One environment's deployment view: its nodes, the elements deployed on
 * them, and the uses between those elements, lifted from their parts (a
 * component's call to another container is its container's). Pure, so the
 * explorer and the CLI draw the same thing.
 */
export function deploymentView(model: Model, environment: string): DeploymentView | undefined {
  const env = model.environments.get(environment);
  if (!env) return undefined;
  const nodes = [...model.deploymentNodes.values()].filter((n) => n.environment === environment);
  const placed: PlacedElement[] = [];
  const seen = new Set<string>();
  for (const d of model.deployments) {
    if (d.environment !== environment) continue;
    const element = model.elements.get(d.element);
    // The same element on two nodes is drawn once, on the first; the details list both.
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    placed.push({ element, node: d.node, deployment: d });
  }

  // Each element stands for itself and everything inside it, unless a part is deployed on its own.
  const boxOf = (id: string): string | undefined => {
    for (let p: string | undefined = id; p; p = model.elements.get(p)?.parentId) {
      if (seen.has(p)) return `element:${p}`;
    }
    return undefined;
  };
  const outsideKey = (id: string): string => {
    // An element deployed nowhere here is shown by its outermost deployable ancestor, or itself.
    let key = id;
    for (let p: string | undefined = id; p; p = model.elements.get(p)?.parentId) {
      const k = model.elements.get(p)?.spec.kind;
      if (k === "container" || k === "datastore" || k === "queue" || k === "external") key = p;
    }
    return `element:${key}`;
  };

  const links = new Map<string, DeploymentLink>();
  const outside = new Set<string>();
  for (const r of model.relationships) {
    const source = r.from.type === "actor" ? `actor:${r.from.id}` : boxOf(r.from.id);
    const target =
      r.to.type === "external"
        ? `external:${r.to.ref}`
        : r.to.type === "element"
          ? boxOf(r.to.id)
          : undefined;
    // A subscription goes from the publisher to the subscriber.
    const sub = subscriptionOf(model, r);
    const from = sub ? target : source;
    const to = sub ? source : target;
    const fromInside = from?.startsWith("element:") ?? false;
    const toInside = to !== undefined && !to.startsWith("external:");
    // Only uses that touch something deployed here.
    if (!fromInside && !toInside) continue;
    const fromOutside = r.from.type === "element" ? outsideKey(r.from.id) : undefined;
    const toOutside = r.to.type === "element" ? outsideKey(r.to.id) : undefined;
    const a = from ?? (sub ? toOutside : fromOutside);
    const b = to ?? (sub ? fromOutside : toOutside);
    if (!a || !b || a === b) continue;
    if (!a.startsWith("element:") || !seen.has(a.slice(8))) outside.add(a);
    if (!b.startsWith("element:") || !seen.has(b.slice(8))) outside.add(b);
    const key = `${a}->${b}`;
    const link: DeploymentLink = links.get(key) ?? { from: a, to: b, relationships: [] };
    link.relationships.push(r);
    if (sub) link.subscription = { channel: sub.channel, transport: sub.transport };
    links.set(key, link);
  }

  const missing = [...model.elements.values()].filter(
    (e) => e.spec.kind === "container" && e.spec.status !== "planned" && !boxOf(e.id),
  );

  return {
    environment: env,
    nodes,
    placed,
    outside: [...outside],
    links: [...links.values()],
    missing,
  };
}

/** `archdoc show <environment or node>`: its infrastructure and what runs on it. */
export function formatEnvironment(model: Model, id: string): string | undefined {
  const env = model.environments.get(id);
  const node = env ? undefined : model.deploymentNodes.get(id);
  if (!env && !node) return undefined;
  const spec = env?.spec ?? node?.spec;
  const out: string[] = [
    env
      ? `${id} (environment)${env.spec.name ? ` · ${env.spec.name}` : ""}`
      : `${id} (${node?.spec.kind ?? "node"})${node?.spec.name ? ` · ${node.spec.name}` : ""}`,
  ];
  if (spec?.status && spec.status !== "active") out.push(`Status: ${spec.status}`);
  if (node?.spec.technology) out.push(`Technology: ${node.spec.technology}`);
  if (spec?.description) out.push(spec.description);
  if (spec?.owners?.length) out.push(`Owners: ${spec.owners.join(", ")}`);
  if (node?.code.length) out.push(`Code: ${node.code.map((c) => c.path).join(", ")}`);
  if (node?.parentId) out.push(`Inside: ${node.parentId}`);
  const children = env ? env.nodeIds : (node?.childIds ?? []);
  if (children.length) {
    out.push(
      `Contains: ${children
        .map((c) => {
          const n = model.deploymentNodes.get(c);
          return `${n?.key ?? c}${n?.spec.kind ? ` (${n.spec.kind})` : ""}`;
        })
        .join(", ")}`,
    );
  }
  // What runs here: on this node or anywhere inside it.
  const under = (d: Deployment) =>
    env ? d.environment === id : d.node === id || (d.node?.startsWith(`${id}.`) ?? false);
  const runs = model.deployments.filter(under);
  if (runs.length) {
    out.push("Runs:");
    for (const d of runs) out.push(`  ${formatDeployment(d)}`);
  }
  return out.join("\n");
}

/** One deployment on a line: the element, where it runs, and what's true of it there. */
export function formatDeployment(d: Deployment): string {
  const head = `${d.element} on ${d.node ?? d.environment}`;
  const extra = [
    d.technology,
    d.replicas !== undefined ? `${d.replicas} replica${d.replicas === 1 ? "" : "s"}` : undefined,
    d.url,
    d.status !== "active" ? d.status : undefined,
    d.code.length ? d.code.map((c) => c.path).join(", ") : undefined,
  ].filter(Boolean);
  return `${head}${extra.length ? ` (${extra.join(", ")})` : ""}`;
}
