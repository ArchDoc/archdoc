import type {
  ActorSpec,
  Bundle,
  DataEntrySpec,
  DeploymentNodeSpec,
  DomainSpec,
  ElementSpec,
  EnvironmentSpec,
  ImportSpec,
  JourneySpec,
  JourneyStepSpec,
  LogicSpec,
  MappingSpec,
  Provenance,
  RuleSpec,
  Status,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "./diagnostics.js";

/** A local actor or element, by its ID within this model. */
export interface NodeRef {
  type: "actor" | "element";
  id: string;
}

/** Something in another repo's namespace. Federation (roadmap Phase 4) resolves these. */
export interface ExternalRef {
  type: "external";
  namespace: string;
  /** Fully qualified reference, such as `payments.charges`. */
  ref: string;
}

export type Target = NodeRef | ExternalRef;

export interface ActorNode {
  type: "actor";
  id: string;
  spec: ActorSpec;
  location?: SourceLocation | undefined;
}

export interface CodeRef {
  path: string;
  description?: string | undefined;
  /** A snippet: one line or a range, as written ("40-88"). */
  lines?: string | undefined;
  /** A snippet: the declaration it points at. */
  symbol?: string | undefined;
}

export interface ElementNode {
  type: "element";
  /** Dotted path from the top of the model, such as `toolchain.core.loader`. */
  id: string;
  /** The element's own key, such as `loader`. */
  key: string;
  parentId?: string | undefined;
  childIds: string[];
  /** 0 for top-level elements. */
  depth: number;
  spec: ElementSpec;
  code: CodeRef[];
  location?: SourceLocation | undefined;
}

export interface Relationship {
  from: NodeRef;
  to: Target;
  /** The reference as written in `uses`. */
  ref: string;
  description?: string | undefined;
  technology?: string | undefined;
  /** The target's contract this goes through, such as an api path or a topic. */
  via?: string | undefined;
  /** How it travels, such as kafka or grpc, when it isn't the contract's. */
  transport?: string | undefined;
  status: Status;
  sends: string[];
  provenance?: Provenance | undefined;
  location?: SourceLocation | undefined;
}

export interface JourneyStep {
  index: number;
  spec: JourneyStepSpec;
  from?: Target | undefined;
  to?: Target | undefined;
  location?: SourceLocation | undefined;
}

export interface JourneyNode {
  id: string;
  spec: JourneySpec;
  actor?: Target | undefined;
  steps: JourneyStep[];
  location?: SourceLocation | undefined;
}

export interface DomainNode {
  id: string;
  spec: DomainSpec;
  location?: SourceLocation | undefined;
}

export interface DataNode {
  id: string;
  spec: DataEntrySpec;
  location?: SourceLocation | undefined;
}

export interface MappingNode {
  id: string;
  spec: MappingSpec;
  location?: SourceLocation | undefined;
}

export interface LogicNode {
  id: string;
  spec: LogicSpec;
  location?: SourceLocation | undefined;
}

/** A place the system is deployed, such as production. */
export interface EnvironmentNode {
  id: string;
  spec: EnvironmentSpec;
  /** Its top-level deployment nodes, as full paths (`production.aws`). */
  nodeIds: string[];
  location?: SourceLocation | undefined;
}

/** Infrastructure inside an environment: a cloud, region, cluster, host, or service. */
export interface DeploymentNode {
  /** Full dotted path, starting with the environment: `production.aws.eks`. */
  id: string;
  /** Its own key, such as `eks`. */
  key: string;
  environment: string;
  /** The enclosing node's path; undefined for a top-level node. */
  parentId?: string | undefined;
  childIds: string[];
  /** 0 for a top-level node in its environment. */
  depth: number;
  spec: DeploymentNodeSpec;
  code: CodeRef[];
  location?: SourceLocation | undefined;
}

/** An element deployed to an environment or a node in it. */
export interface Deployment {
  element: string;
  /** The target as written: `production` or `production.aws.eks`. */
  to: string;
  environment: string;
  /** The node it runs on, when `to` names one. */
  node?: string | undefined;
  description?: string | undefined;
  technology?: string | undefined;
  replicas?: number | string | undefined;
  url?: string | undefined;
  code: CodeRef[];
  status: Status;
  provenance?: Provenance | undefined;
  location?: SourceLocation | undefined;
}

export interface Model {
  namespace: string;
  name?: string | undefined;
  description?: string | undefined;
  imports: Record<string, ImportSpec>;
  actors: Map<string, ActorNode>;
  elements: Map<string, ElementNode>;
  journeys: Map<string, JourneyNode>;
  data: Map<string, DataNode>;
  mappings: Map<string, MappingNode>;
  logic: Map<string, LogicNode>;
  rules: RuleSpec[];
  relationships: Relationship[];
  /** Where the system is deployed, by environment ID. */
  environments: Map<string, EnvironmentNode>;
  /** Every deployment node, by full path (`production.aws.eks`). */
  deploymentNodes: Map<string, DeploymentNode>;
  /** Which elements run where, from their `deploy`. Only resolved targets. */
  deployments: Deployment[];
  /** Model files that were read, in load order. */
  files: string[];
  diagnostics: Diagnostic[];
  /** Where each import is written in the root file. */
  importLocations?: Map<string, SourceLocation> | undefined;
  /** Other repos' models, from the vendored bundles in archdoc.lock. Empty until synced. */
  imported?: Map<string, ImportedModel> | undefined;
  /** Business domains, mostly defined in a landscape. */
  domains?: Map<string, DomainNode> | undefined;
  /** The `landscape:` import, as written. */
  landscapeImport?: ImportSpec | undefined;
  /** The landscape and the models it imports, from archdoc.lock. Undefined until synced. */
  landscape?: Landscape | undefined;
}

/** The landscape repo's model, with every model it imports (except this one). */
export interface Landscape extends ImportedModel {
  /** The other repos' models, at the versions the landscape pins. */
  members: Map<string, ImportedModel>;
}

/** Another repo's model, as pinned in archdoc.lock. */
export interface ImportedModel {
  namespace: string;
  version?: string | undefined;
  commit?: string | undefined;
  source?: string | undefined;
  bundle: Bundle;
  model: Model;
}

/**
 * Facts a person hasn't accepted yet: suggested by an agent, or inferred by
 * archdoc init or an analyzer. Reviewers see them as such, until someone
 * removes the provenance block.
 */
export function toReview(fact: unknown): "suggested" | "inferred" | undefined {
  const source = (fact as { provenance?: { source?: string } } | undefined)?.provenance?.source;
  return source === "suggested" || source === "inferred" ? source : undefined;
}

export function nodeKey(ref: NodeRef | ExternalRef): string {
  return ref.type === "external" ? `external:${ref.ref}` : `${ref.type}:${ref.id}`;
}

export function describeTarget(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}
