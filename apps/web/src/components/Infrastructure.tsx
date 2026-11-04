import {
  type Deployment,
  deploymentPath,
  deploymentsOf,
  type Model,
  toReview,
} from "@archdoc/core/browser";
import { Background, Controls, MarkerType, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { buildInfraGraph, deployKey, envKey } from "../graph/infra.js";
import { layoutGraph, type UntangledLayout } from "../graph/layout.js";
import { describe } from "./Canvas.js";
import { edgeTypes, type RoutedEdge } from "./edges.js";
import { type CardNode, nodeTypes, type Shape } from "./nodes.js";

/** The environment to show first: one called production, or else the first declared. */
export function defaultEnvironment(model: Model): string | undefined {
  const ids = [...model.environments.keys()];
  return ids.find((id) => /^prod/i.test(id)) ?? ids[0];
}

export interface InfraCanvasProps {
  model: Model;
  environment: string;
  selected?: string | undefined;
  onSelect: (key: string | undefined) => void;
}

/**
 * Where the system runs: one environment's infrastructure, outermost first,
 * with the containers, datastores, and queues deployed on each node and the
 * uses between them. What they talk to outside the environment sits around it.
 */
export function InfraCanvas({ model, environment, selected, onSelect }: InfraCanvasProps) {
  const infra = useMemo(() => buildInfraGraph(model, environment), [model, environment]);
  const [layout, setLayout] = useState<UntangledLayout>();
  const [hoverNode, setHoverNode] = useState<string>();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const flow = useReactFlow();

  useEffect(() => {
    if (!infra) return;
    let cancelled = false;
    void layoutGraph(infra.graph, {
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.nodeNode": "48",
    }).then((result) => {
      if (!cancelled) setLayout(result);
    });
    return () => {
      cancelled = true;
    };
  }, [infra]);

  useEffect(() => {
    if (!layout) return;
    requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.08, duration: 0, maxZoom: 1 });
    });
  }, [layout, flow]);

  const nodes = useMemo<CardNode[]>(() => {
    if (!layout || !infra) return [];
    const placed = new Map(infra.view.placed.map((p) => [`element:${p.element.id}`, p]));
    return layout.graph.nodes.flatMap((n): CardNode[] => {
      const box = layout.boxes.get(n.id);
      if (!box) return [];
      const base = {
        id: n.id,
        type: "card" as const,
        position: { x: box.x, y: box.y },
        parentId: n.parentId,
        width: box.width,
        height: box.height,
        selectable: false,
        draggable: false,
        zIndex: n.isGroup ? 0 : 1,
      };
      const common = {
        hiddenChildren: 0,
        isGroup: n.isGroup,
        selected: n.id === selected,
        emphasis: "normal" as const,
      };
      if (n.id.startsWith("env:") || n.id.startsWith("deploy:")) {
        const isEnv = n.id.startsWith("env:");
        const spec = isEnv
          ? model.environments.get(n.id.slice(4))?.spec
          : model.deploymentNodes.get(n.id.slice(7))?.spec;
        const node = isEnv ? undefined : model.deploymentNodes.get(n.id.slice(7));
        const kind = isEnv ? "environment" : (node?.spec.kind ?? "node");
        const name = spec?.name ?? (isEnv ? n.id.slice(4) : (node?.key ?? n.id));
        const tech = node?.spec.technology;
        return [
          {
            ...base,
            className: `infra-box infra-${isEnv ? "environment" : "node"} infra-kind-${slug(kind)}`,
            data: {
              ...common,
              family: "group" as const,
              shape: "frame" as Shape,
              // A box around others shows only its label: its kind and technology go in it.
              label: n.isGroup ? [...new Set([name, tech ?? kind])].join(" · ") : name,
              kind,
              detail: n.isGroup ? undefined : (tech ?? kind),
              status: spec?.status,
              suggested: toReview(spec) !== undefined,
            },
          },
        ];
      }
      const info = describe(model, n.id);
      const p = placed.get(n.id);
      return [
        {
          ...base,
          className: p ? "infra-placed" : "infra-outside",
          data: {
            ...common,
            ...info,
            detail: p ? deploymentLine(p.deployment) || info.detail : info.detail,
            emphasis:
              hoverNode && hoverNode !== n.id && !touching(infra.graph.edges, hoverNode, n.id)
                ? ("dim" as const)
                : ("normal" as const),
          },
        },
      ];
    });
  }, [layout, infra, model, selected, hoverNode]);

  const edges = useMemo<RoutedEdge[]>(() => {
    if (!layout) return [];
    return layout.graph.edges.map((e) => {
      const lit = hoverNode
        ? e.source === hoverNode || e.target === hoverNode
        : selected !== undefined && (e.source === selected || e.target === selected);
      // How it travels is what matters between machines; what it's for shows on hover.
      const channel = e.subscription
        ? `${e.subscription.channel}${e.subscription.transport ? ` (${e.subscription.transport})` : ""}`
        : undefined;
      const how = [
        ...new Set([channel, ...e.relationships.map((r) => r.technology ?? r.transport)]),
      ]
        .filter(Boolean)
        .join(", ");
      const what = [...new Set(e.relationships.map((r) => r.description))]
        .filter(Boolean)
        .join(" · ");
      const label = e.id === hoverEdge ? what || how : how;
      const className = [
        "rel",
        e.planned ? "is-planned" : "",
        e.subscription ? "is-async" : "",
        lit ? "is-lit" : "",
        hoverNode && !lit ? "is-dim" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        id: e.id,
        type: "routed" as const,
        source: e.source,
        target: e.target,
        data: { points: layout.routes.get(e.id) },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: lit ? "var(--accent)" : "var(--edge)",
        },
        className,
        label: label ? truncate(label, e.id === hoverEdge ? 80 : 40) : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: 2,
      };
    });
  }, [layout, selected, hoverNode, hoverEdge]);

  if (!infra) return <p className="empty-main">No environment called {environment}.</p>;
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      onNodeMouseEnter={(_, node) => {
        if (!node.id.startsWith("env:") && !node.id.startsWith("deploy:")) setHoverNode(node.id);
      }}
      onNodeMouseLeave={() => setHoverNode(undefined)}
      onEdgeMouseEnter={(_, edge) => setHoverEdge(edge.id)}
      onEdgeMouseLeave={() => setHoverEdge(undefined)}
      nodesConnectable={false}
      elementsSelectable={false}
      colorMode="system"
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

export interface EnvironmentListProps {
  model: Model;
  environment?: string | undefined;
  selected?: string | undefined;
  onEnvironment: (id: string) => void;
  onSelect: (key: string) => void;
}

/** The sidebar: each environment, its nodes as a tree, and the containers it doesn't place. */
export function EnvironmentList(props: EnvironmentListProps) {
  const { model, environment } = props;
  const envs = [...model.environments.values()];
  if (!envs.length) {
    return (
      <div className="infra-side">
        <h2 className="side-title">Environments</h2>
        <p className="muted">None yet.</p>
      </div>
    );
  }
  const env = environment ? model.environments.get(environment) : undefined;
  const placedHere = model.deployments.filter((d) => d.environment === environment);
  const missing = [...model.elements.values()].filter(
    (e) =>
      e.spec.kind === "container" &&
      e.spec.status !== "planned" &&
      !placedHere.some((d) => d.element === e.id || e.id.startsWith(`${d.element}.`)),
  );
  const tree = (ids: string[], depth: number): React.ReactNode =>
    ids.map((id) => {
      const n = model.deploymentNodes.get(id);
      if (!n) return null;
      const here = placedHere.filter((d) => d.node === id);
      return (
        <li key={id}>
          <button
            type="button"
            className={`infra-tree-node${props.selected === deployKey(id) ? " is-on" : ""}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => props.onSelect(deployKey(id))}
          >
            <span>{n.spec.name ?? n.key}</span>
            <span className="muted">
              {[n.spec.kind, here.length ? `${here.length} running` : undefined]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
          {n.childIds.length ? <ul>{tree(n.childIds, depth + 1)}</ul> : null}
        </li>
      );
    });

  return (
    <div className="infra-side">
      <fieldset className="segmented infra-envs" aria-label="Environment">
        <legend>Environment</legend>
        {envs.map((e) => (
          <button
            key={e.id}
            type="button"
            className={e.id === environment ? "is-on" : undefined}
            aria-pressed={e.id === environment}
            onClick={() => props.onEnvironment(e.id)}
            title={e.spec.description}
          >
            {e.spec.name ?? e.id}
          </button>
        ))}
      </fieldset>
      {env ? (
        <>
          {env.spec.description ? <p className="muted">{env.spec.description}</p> : null}
          <h2 className="side-title">Infrastructure</h2>
          {env.nodeIds.length ? (
            <ul className="infra-tree">{tree(env.nodeIds, 0)}</ul>
          ) : (
            <p className="muted">No nodes yet. Add them under environments.{env.id}.nodes.</p>
          )}
          {missing.length ? (
            <>
              <h2 className="side-title">Not deployed here</h2>
              <p className="muted">
                Containers that don't say they run in {env.spec.name ?? env.id}. Add it to their
                deploy, or leave them out if they don't run here.
              </p>
              <ul className="infra-missing">
                {missing.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="link"
                      onClick={() => props.onSelect(`element:${e.id}`)}
                    >
                      {e.spec.name ?? e.key}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** What to write when the model says nothing about where it runs. */
export function InfraIntro() {
  return (
    <div className="details infra-intro">
      <h2>Where does it run?</h2>
      <p className="lede">
        This model doesn't say where it's deployed yet. Add an environments section with the
        infrastructure in each, then give each container a deploy that names where it runs.
      </p>
      <pre className="infra-example">{`environments:
  production:
    nodes:
      aws:
        kind: cloud
        technology: AWS us-east-1
        nodes:
          eks:
            kind: cluster
            technology: EKS
            code: infra/terraform/eks.tf

elements:
  api:
    kind: container
    deploy:
      - to: production.aws.eks
        replicas: 3
        code: deploy/helm/api/values.yaml`}</pre>
    </div>
  );
}

export interface InfraDetailsProps {
  model: Model;
  /** `env:<id>` or `deploy:<path>`. */
  selected: string;
  onSelect: (key: string) => void;
}

/** An environment or a deployment node: what it is, what's inside it, and what runs on it. */
export function InfraDetails({ model, selected, onSelect }: InfraDetailsProps) {
  const isEnv = selected.startsWith("env:");
  const id = selected.slice(isEnv ? 4 : 7);
  const env = isEnv ? model.environments.get(id) : undefined;
  const node = isEnv ? undefined : model.deploymentNodes.get(id);
  if (!env && !node) return null;
  const spec = env?.spec ?? node?.spec;
  const children = env ? env.nodeIds : (node?.childIds ?? []);
  const runs = model.deployments.filter((d) =>
    env ? d.environment === id && !d.node : d.node === id,
  );
  const below = node
    ? model.deployments.filter((d) => d.node?.startsWith(`${id}.`))
    : model.deployments.filter((d) => d.environment === id && d.node);
  const crumbs: string[] = [];
  for (let p = node?.parentId; p; p = model.deploymentNodes.get(p)?.parentId) crumbs.unshift(p);
  return (
    <div className="details">
      {node ? (
        <nav className="crumbs" aria-label="Inside">
          <button type="button" className="link" onClick={() => onSelect(envKey(node.environment))}>
            {model.environments.get(node.environment)?.spec.name ?? node.environment}
          </button>
          {crumbs.map((c) => (
            <span key={c}>
              {" › "}
              <button type="button" className="link" onClick={() => onSelect(deployKey(c))}>
                {model.deploymentNodes.get(c)?.spec.name ?? c.split(".").pop()}
              </button>
            </span>
          ))}
        </nav>
      ) : null}
      <p className="eyebrow">{env ? "environment" : (node?.spec.kind ?? "deployment node")}</p>
      <h1>{spec?.name ?? (node?.key || id)}</h1>
      <div className="chips">
        {[node?.spec.technology, spec?.status !== "active" ? spec?.status : undefined]
          .filter(Boolean)
          .map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
      </div>
      {spec?.description ? <p className="lede">{spec.description}</p> : null}
      <p className="muted">
        <code>{id}</code>
      </p>
      {spec?.owners?.length ? (
        <section className="block">
          <h2>Owners</h2>
          <p>{spec.owners.join(", ")}</p>
        </section>
      ) : null}
      {node?.code.length ? (
        <section className="block">
          <h2>Defined in</h2>
          <ul className="plain">
            {node.code.map((c) => (
              <li key={c.path}>
                <code>{c.path}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {children.length ? (
        <section className="block">
          <h2>Contains</h2>
          <ul className="plain">
            {children.map((c) => {
              const n = model.deploymentNodes.get(c);
              return (
                <li key={c}>
                  <button type="button" className="link" onClick={() => onSelect(deployKey(c))}>
                    {n?.spec.name ?? n?.key ?? c}
                  </button>
                  {n?.spec.kind ? <span className="muted"> · {n.spec.kind}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {runs.length || below.length ? (
        <section className="block">
          <h2>Runs here</h2>
          <DeploymentList model={model} deployments={[...runs, ...below]} onSelect={onSelect} />
        </section>
      ) : null}
    </div>
  );
}

/** Deployments as a list: the element, where it runs, and what's true of it there. */
export function DeploymentList(props: {
  model: Model;
  deployments: Deployment[];
  onSelect: (key: string) => void;
  /** Name the element (on a node's panel), or where it runs (on an element's). */
  by?: "element" | "place";
}) {
  const by = props.by ?? "element";
  return (
    <ul className="plain infra-deployments">
      {props.deployments.map((d) => {
        const el = props.model.elements.get(d.element);
        const where = deploymentPath(props.model, d);
        return (
          <li key={`${d.element}@${d.to}`}>
            {by === "element" ? (
              <button
                type="button"
                className="link"
                onClick={() => props.onSelect(`element:${d.element}`)}
              >
                {el?.spec.name ?? el?.key ?? d.element}
              </button>
            ) : (
              where.map((w, i) => (
                <span key={w}>
                  {i ? " › " : ""}
                  <button
                    type="button"
                    className="link"
                    onClick={() => props.onSelect(i ? deployKey(w) : envKey(w))}
                  >
                    {i
                      ? (props.model.deploymentNodes.get(w)?.spec.name ?? w.split(".").pop())
                      : (props.model.environments.get(w)?.spec.name ?? w)}
                  </button>
                </span>
              ))
            )}
            {deploymentLine(d) ? <span className="muted"> · {deploymentLine(d)}</span> : null}
            {d.url ? (
              <div>
                <a href={d.url} target="_blank" rel="noreferrer">
                  {d.url}
                </a>
              </div>
            ) : null}
            {d.code.length ? (
              <div className="muted">
                {d.code.map((c) => (
                  <code key={c.path}>{c.path} </code>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** For an element's details: where it's deployed, its own or its container's. */
export function DeployedSection(props: {
  model: Model;
  id: string;
  onSelect: (key: string) => void;
}) {
  const deployed = deploymentsOf(props.model, props.id);
  if (!deployed) return null;
  const from = props.model.elements.get(deployed.from);
  return (
    <section className="block">
      <h2>Deployed</h2>
      {deployed.from !== props.id ? (
        <p className="muted">
          With{" "}
          <button
            type="button"
            className="link"
            onClick={() => props.onSelect(`element:${deployed.from}`)}
          >
            {from?.spec.name ?? from?.key ?? deployed.from}
          </button>
          , which it's part of.
        </p>
      ) : null}
      <DeploymentList
        model={props.model}
        deployments={deployed.deployments}
        onSelect={props.onSelect}
        by="place"
      />
    </section>
  );
}

/** What's true of a deployment, in a few words: ×3 · Helm chart. */
function deploymentLine(d: Deployment): string {
  return [
    d.replicas !== undefined ? `×${d.replicas}` : undefined,
    d.technology,
    d.status !== "active" ? d.status : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function touching(edges: { source: string; target: string }[], a: string, b: string): boolean {
  return edges.some(
    (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
