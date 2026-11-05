import { buildModel, type Model, type ModelSource } from "@archdoc/core/browser";
import { useEffect, useMemo, useState } from "react";
import type { ChangeFindings } from "./compare.js";
import { type ModelPayload, modelOf, type RepoLinks } from "./useModel.js";

/** The branches `archdoc view` can compare. Undefined on a static host, which has no git. */
export interface Refs {
  current?: string | undefined;
  branches: string[];
  /** The --base the server started with. */
  base?: string | undefined;
}

export function useRefs(): Refs | undefined {
  const [refs, setRefs] = useState<Refs>();
  useEffect(() => {
    let cancelled = false;
    fetch("api/refs", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Refs>) : undefined))
      .then((r) => {
        if (!cancelled && r && Array.isArray(r.branches)) setRefs(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return refs;
}

/**
 * Which two branches the Diff tab compares: the change on `head` (branch 1,
 * the working tree when undefined) since it left `base` (branch 2, such as main).
 */
export interface Pair {
  base: string;
  head?: string | undefined;
}

export type Compared =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      /** Branch 1's model and files, when it isn't the working tree. */
      head?: Head | undefined;
      /** The code changed since the merge base, in the head model's terms. */
      change: ChangeFindings;
    };

/** A branch as the Diff tab shows it: its model, and the files and samples at its commit. */
export interface Head {
  ref: string;
  model: Model;
  files: string[];
  snippets: NonNullable<ModelPayload["snippets"]>;
  repo: RepoLinks;
  samples: { path: string; text: string }[];
  traces: { path: string; text: string }[];
}

interface Sources extends Partial<ModelPayload> {
  ref: string;
  root: string;
  sources: ModelSource[];
}

/** The code change between the pair, read by the view server from git. */
export function useCompared(pair: Pair | undefined, preset: ChangeFindings | undefined): Compared {
  const [state, setState] = useState<Compared>(IDLE);
  // What the page loaded with needs no request, so it also works on a static host.
  const fromPreset = !!pair && !pair.head && pair.base === preset?.base;
  useEffect(() => {
    if (!pair || fromPreset) return;
    let cancelled = false;
    setState({ status: "loading" });
    const query = new URLSearchParams({
      base: pair.base,
      ...(pair.head ? { head: pair.head } : {}),
    });
    fetch(`api/compare?${query}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          head?: Sources;
          change?: ChangeFindings;
        };
        if (!res.ok || !body.change)
          throw new Error(body.error ?? `The server answered ${res.status}.`);
        return { head: body.head && head(body.head), change: body.change };
      })
      .then(
        (read) => !cancelled && setState({ status: "ready", ...read }),
        (err: unknown) =>
          !cancelled &&
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [pair, fromPreset]);
  const presetChange = fromPreset ? preset : undefined;
  const ready = useMemo<Compared | undefined>(
    () => presetChange && { status: "ready", change: presetChange },
    [presetChange],
  );
  if (!pair) return IDLE;
  return ready ?? state;
}

const IDLE: Compared = { status: "idle" };

function head(p: Sources): Head {
  return {
    ref: p.ref,
    model: p.sources.length ? modelOf(p) : buildModel([]),
    files: p.files ?? [],
    snippets: p.snippets ?? {},
    repo: p.repo ?? {},
    samples: p.samples ?? [],
    traces: p.traces ?? [],
  };
}

/**
 * The branch to compare with when no one has picked one: main, or the
 * repository's other usual default, never the branch being compared.
 */
export function defaultBase(refs: Refs | undefined): string | undefined {
  if (!refs) return undefined;
  if (refs.base) return refs.base;
  const others = refs.branches.filter((b) => b !== refs.current);
  return ["main", "master", "trunk", "develop"].find((b) => others.includes(b));
}

/** The explorer's tabs. */
export type Tab = "overview" | "journeys" | "traces" | "data" | "infrastructure" | "changes";

/** What the address says to open. */
export interface HashState {
  tab?: Tab | undefined;
  pair?: Pair | undefined;
  /** The open journey on the Journeys tab. */
  journey?: string | undefined;
  /** The selected entry or field on the Data tab, as data:<entry> or field:<entry.field>. */
  data?: string | undefined;
  /** The open trace on the Traces tab. */
  trace?: string | undefined;
  /** The environment on the Infrastructure tab. */
  environment?: string | undefined;
}

/**
 * What the address opens, such as #changes=main...feature (so a link opens the
 * same comparison), #journeys=request-refund, or #data=payments.Refund.
 */
export function readHash(hash = window.location.hash): HashState {
  const parts = hash.replace(/^#/, "").split("&").filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    const name = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
    if (name === "changes") {
      const [base, head] = value.split("...");
      return { tab: "changes", pair: base ? { base, head: head || undefined } : undefined };
    }
    if (name === "journeys") return { tab: "journeys", journey: value || undefined };
    if (name === "traces") return { tab: "traces", trace: value || undefined };
    if (name === "infrastructure") {
      return { tab: "infrastructure", environment: value || undefined };
    }
    if (name === "data") {
      const data = value
        ? value.split(".").length > 2
          ? `field:${value}`
          : `data:${value}`
        : undefined;
      return { tab: "data", data };
    }
    if (name === "overview") return { tab: "overview" };
  }
  return {};
}

/** The address for what's open; the Overview has none. */
export function hashOf(state: HashState): string {
  const pair = state.pair;
  switch (state.tab) {
    case "changes":
      return `#changes${pair ? `=${encodeURIComponent(pair.base)}${pair.head ? `...${encodeURIComponent(pair.head)}` : ""}` : ""}`;
    case "traces":
      return `#traces${state.trace ? `=${encodeURIComponent(state.trace)}` : ""}`;
    case "infrastructure":
      return `#infrastructure${state.environment ? `=${encodeURIComponent(state.environment)}` : ""}`;
    case "journeys":
      return `#journeys${state.journey ? `=${encodeURIComponent(state.journey)}` : ""}`;
    case "data": {
      const entry = state.data?.replace(/^(data|field):/, "");
      return `#data${entry ? `=${encodeURIComponent(entry)}` : ""}`;
    }
    default:
      return "";
  }
}

export function writeHash(state: HashState) {
  const hash = hashOf(state);
  if (window.location.hash === hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}
