import { type DeploymentView, deploymentView, type Model } from "@archdoc/core/browser";
import type { Graph, GraphNode } from "./graph.js";

/** Keys for the infrastructure view's own boxes. */
export const envKey = (id: string) => `env:${id}`;
export const deployKey = (id: string) => `deploy:${id}`;

/** One environment's infrastructure, as a graph the layout can place. */
export interface InfraGraph {
  view: DeploymentView;
  graph: Graph;
}

/**
 * The deployment view as boxes inside boxes: the environment, its nodes
 * (cloud, region, cluster...), and the containers, datastores, and queues on
 * them, with the uses between them lifted from their parts. What they talk to
 * outside the environment (actors, externals, elements deployed elsewhere) sits
 * around it.
 */
export function buildInfraGraph(model: Model, environment: string): InfraGraph | undefined {
  const view = deploymentView(model, environment);
  if (!view) return undefined;
  const nodes: GraphNode[] = [];
  const env = envKey(environment);
  const placedOn = new Map<string, number>();
  for (const p of view.placed) {
    const at = p.node ? deployKey(p.node) : env;
    placedOn.set(at, (placedOn.get(at) ?? 0) + 1);
  }
  // A node is a box around others when something is inside it, and a plain box otherwise.
  const hasInside = (id: string): boolean => {
    const n = model.deploymentNodes.get(id);
    return (placedOn.get(deployKey(id)) ?? 0) > 0 || (n?.childIds.some(hasInside) ?? false);
  };
  const group = (id: string, parentId: string | undefined, depth: number): GraphNode => ({
    id,
    kind: "group",
    parentId,
    isGroup: true,
    hiddenChildren: 0,
    depth,
  });
  const box = (
    id: string,
    kind: GraphNode["kind"],
    parentId: string | undefined,
    depth: number,
  ): GraphNode => ({ id, kind, parentId, isGroup: false, hiddenChildren: 0, depth });

  const anything = view.placed.length > 0 || view.nodes.length > 0;
  nodes.push(anything ? group(env, undefined, 0) : box(env, "group", undefined, 0));
  for (const n of view.nodes) {
    const parent = n.parentId ? deployKey(n.parentId) : env;
    nodes.push(
      hasInside(n.id)
        ? group(deployKey(n.id), parent, n.depth + 1)
        : box(deployKey(n.id), "group", parent, n.depth + 1),
    );
  }
  for (const p of view.placed) {
    const parent = p.node ? deployKey(p.node) : env;
    nodes.push(box(`element:${p.element.id}`, "element", parent, 0));
  }
  for (const key of view.outside) {
    const kind = key.startsWith("actor:")
      ? "actor"
      : key.startsWith("external:")
        ? "external"
        : "element";
    nodes.push(box(key, kind, undefined, 0));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = view.links
    .filter((l) => ids.has(l.from) && ids.has(l.to))
    .map((l) => ({
      id: `${l.from}->${l.to}`,
      source: l.from,
      target: l.to,
      relationships: l.relationships,
      planned: l.relationships.every((r) => r.status === "planned"),
      subscription: l.subscription,
    }));
  return { view, graph: { nodes, edges } };
}
