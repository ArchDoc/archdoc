import {
  DataRegistry,
  formatDiagnostic,
  type JourneyNode,
  lineage,
  type Model,
  type PlanEditOp,
  planFocus,
  resolveCodeMap,
  type Simulation,
  type SnippetPlace,
} from "@archdoc/core/browser";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useStoredChoice, useStoredFlag } from "./components/Canvas.js";
import { DataCatalog } from "./components/DataCatalog.js";
import { Details } from "./components/Details.js";
import {
  defaultEnvironment,
  EnvironmentList,
  InfraCanvas,
  InfraDetails,
  InfraIntro,
} from "./components/Infrastructure.js";
import { Lanes } from "./components/Lanes.js";
import { Overview } from "./components/Overview.js";
import type { PayloadEntry } from "./components/Payload.js";
import {
  IntentPopover,
  NEW_PLAN,
  PlanHead,
  PlanList,
  PlanPanel,
  type PlanPop,
  PlanStart,
} from "./components/Plan.js";
import { ChangesList, DataList, dataGroups, JourneyList, SearchBox } from "./components/Sidebar.js";
import { StepPanel } from "./components/StepPanel.js";
import { NEW, TraceList, TraceStepPanel, TraceStory, TriageStart } from "./components/Traces.js";
import {
  dataPlaces,
  type Interaction,
  interactionRows,
  journeyInteractions,
  journeyInvolvement,
  journeyStores,
  stepData,
} from "./graph/data.js";
import {
  ancestorsOf,
  defaultExpanded,
  journeyExpansion,
  type Level,
  levelExpansion,
  levelOf,
  shownId,
  systemBox,
} from "./graph/graph.js";
import { type GroupBy, type Grouping, groupLandscape } from "./graph/groups.js";
import { type Compare, compareCode } from "./model/compare.js";
import { nodeOf, planMap, readPlans, writePlan } from "./model/plans.js";
import { actorLabel, journeyLanes, journeysByImportance } from "./model/stories.js";
import { landingTab, type Section, sectionOf, sections } from "./model/tabs.js";
import {
  firstCause,
  readTraces,
  traceInteractions,
  traceJourney,
  traceRoles,
} from "./model/traces.js";
import {
  defaultBase,
  type HashState,
  type Pair,
  type Refs,
  readHash,
  type Tab,
  useCompared,
  useRefs,
  writeHash,
} from "./model/useCompare.js";
import {
  type LandscapeInfo,
  type ModelState,
  type RepoLinks,
  type SealsInfo,
  useModel,
} from "./model/useModel.js";

export function App() {
  const state = useModel();
  const refs = useRefs();
  const [initial] = useState<HashState>(() => readHash());
  const [tab, setTab] = useState<Tab>(initial.tab ?? "overview");
  const [chosen, setChosen] = useState<Pair | undefined>(initial.pair);
  const preset = state.status === "ready" ? state.change : undefined;
  // `archdoc view --base` picks branch 2 until someone picks another; otherwise main.
  const presetRef = preset?.base ?? defaultBase(refs);
  const pair = useMemo<Pair | undefined>(
    () => chosen ?? (presetRef ? { base: presetRef } : undefined),
    [chosen, presetRef],
  );
  const compared = useCompared(pair, preset);
  // A branch replaces the working tree while the Diff tab shows it: its model and files.
  const branch = tab === "changes" && compared.status === "ready" ? compared.head : undefined;
  const shown = branch ?? (state.status === "ready" ? state : undefined);
  const headModel =
    compared.status === "ready"
      ? (compared.head ?? (state.status === "ready" ? state : undefined))?.model
      : undefined;
  const compare = useMemo<Compare | undefined>(() => {
    if (compared.status !== "ready" || !headModel) return undefined;
    // Branch 1's model, with what its code change says read into it.
    return compareCode(headModel, compared.change);
  }, [compared, headModel]);

  if (state.status === "loading") return <Splash>Loading the model…</Splash>;
  if (state.status === "error" || !shown) {
    return (
      <Splash>
        <strong>Couldn't load the model.</strong> {state.status === "error" ? state.message : ""}
        <br />
        Start the explorer with <code>archdoc view</code> from your repository.
      </Splash>
    );
  }
  const changes: ChangesControl | undefined =
    preset || refs?.branches.length
      ? {
          refs,
          pair,
          onPair: setChosen,
          compare,
          note:
            compared.status === "loading"
              ? `Reading the code ${pair?.head ?? "the working tree"} changed since ${pair?.base}…`
              : compared.status === "error"
                ? compared.message
                : pair
                  ? undefined
                  : "Pick the branch to compare with.",
        }
      : undefined;
  return (
    <ReactFlowProvider>
      <Explorer
        model={tab === "changes" && compare ? compare.after : shown.model}
        watch={state.watch}
        reloads={state.reloads}
        files={shown.files}
        snippets={shown.snippets}
        repo={shown.repo}
        tab={tab === "changes" && !changes ? "overview" : tab}
        onTab={setTab}
        initial={initial}
        pair={chosen}
        changes={changes}
        landscape={state.landscape}
        traces={shown.traces}
        seals={branch ? undefined : state.seals}
        planning={state.status === "ready" ? state : undefined}
      />
    </ReactFlowProvider>
  );
}

/** What the Changes tab compares and how to pick it. */
interface ChangesControl {
  /** Undefined on a static host, where only the base the page was built with exists. */
  refs?: Refs | undefined;
  pair?: Pair | undefined;
  onPair: (pair: Pair) => void;
  compare?: Compare | undefined;
  /** Why there's nothing to show yet. */
  note?: string | undefined;
}

interface ExplorerProps {
  model: Model;
  watch: boolean;
  reloads: number;
  files: string[];
  snippets: Record<string, SnippetPlace>;
  repo: RepoLinks;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** What the address asked for when the page opened. */
  initial: HashState;
  /** The pair someone picked, for the address. */
  pair?: Pair | undefined;
  changes?: ChangesControl | undefined;
  landscape?: LandscapeInfo | undefined;
  /** Trace files beside the model. */
  traces: { path: string; text: string }[];
  /** The working tree's facts to re-check, when the repository keeps an archdoc.sum. */
  seals?: SealsInfo | undefined;
  /** The working tree's plans, sources, and how to write and rebuild, for the Plan tab. */
  planning?: Extract<ModelState, { status: "ready" }> | undefined;
}

function Explorer({
  model,
  watch,
  reloads,
  files,
  snippets,
  repo,
  tab,
  onTab,
  initial,
  pair,
  changes,
  landscape,
  traces,
  seals,
  planning,
}: ExplorerProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  // The tab last open under each top-level tab, so going back to it opens where you were.
  const lastTab = useRef<Partial<Record<Section, Tab>>>({});
  lastTab.current[sectionOf(tab)] = tab;
  // Boxes opened by hand, and boxes closed by hand that something else opened (by context).
  // The map starts at the C4 context: each system one box, with who uses it and what it talks
  // to. A landscape starts with its repos open, grouped.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    landscape ? defaultExpanded(model) : levelExpansion(model, "context"),
  );
  // A model without a system element shows its context as one closed box, until something opens.
  const [boxed, setBoxed] = useState(() => !landscape);
  const box = useMemo(
    () => (boxed && !landscape ? systemBox(model) : undefined),
    [boxed, landscape, model],
  );
  // Which way the map runs: left to right, or top down. This browser remembers.
  const [direction, setDirection] = useStoredChoice(
    "archdoc:map-direction",
    ["RIGHT", "DOWN"] as const,
    "RIGHT",
  );
  const [closed, setClosed] = useState<{ context: string; ids: ReadonlySet<string> }>();
  // Datastores opened to show their tables, and those showing a journey's rows instead.
  const [tables, setTables] = useState<ReadonlySet<string>>(() => new Set());
  const [rowStores, setRowStores] = useState<ReadonlySet<string>>(() => new Set());
  // Tables showing their fields, by qualified entry; the rest show only their names.
  const [openFields, setOpenFields] = useState<ReadonlySet<string>>(() => new Set());
  // During a journey, datastores showing every table, and tables brought back one at a time.
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [extra, setExtra] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | undefined>(initial.data);
  const [focused, setFocused] = useState(false);
  const [journeyId, setJourneyId] = useState<string | undefined>(initial.journey);
  // The interaction the journey is at: a step's arrow, or its writer storing what it wrote.
  const [at, setAt] = useState(0);
  // A journey shows on the map unless someone picks its sequence, which this browser remembers.
  const [sequence, setSequence] = useStoredFlag("archdoc:journey-sequence", false);
  // On the Data tab, an entry shows as its page, or lit up on the map of the system.
  const [dataOnMap, setDataOnMap] = useStoredFlag("archdoc:data-map", false);
  const onMap = !sequence;
  const [preview, setPreview] = useState<string>();
  const [centerOn, setCenterOn] = useState<string>();
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const search = useRef<HTMLInputElement>(null);
  // The open trace, and the hop selected in it.
  const [traceId, setTraceId] = useState<string | undefined>(initial.trace);
  const [traceAt, setTraceAt] = useState<number>();
  // The environment on the Infrastructure tab.
  const [environment, setEnvironment] = useState<string | undefined>(
    () => initial.environment ?? defaultEnvironment(model),
  );
  const traceState = useMemo(() => readTraces(model, traces, files), [model, traces, files]);
  // The start panel when asked for, or when there's nothing to show yet.
  const traceCheck =
    traceId === NEW
      ? undefined
      : (traceState.checks.find((c) => c.view.id === traceId) ?? traceState.checks[0]);
  const traceStep = traceCheck
    ? Math.min(traceAt ?? firstCause(traceCheck.view), traceCheck.view.steps.length - 1)
    : 0;
  const openTrace = useCallback(
    (id: string) => {
      onTab("triage");
      setSelected(undefined);
      setTraceId(id);
      setTraceAt(undefined);
    },
    [onTab],
  );

  // The open plan, what's being drawn on it, and the sequence stepped through on the map.
  const [planId, setPlanId] = useState<string | undefined>(initial.plan);
  // The popover where the person clicked on the plan's map.
  const [planPop, setPlanPop] = useState<PlanPop>();
  const [planSeq, setPlanSeq] = useState<string>();
  const [planAt, setPlanAt] = useState(0);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string>();
  // The plan's map shows what it touches, unless the person asks for the whole system.
  const [planWhole, setPlanWhole] = useState(false);
  const planState = useMemo(() => readPlans(planning?.plans ?? []), [planning?.plans]);
  const plan =
    planId === NEW_PLAN
      ? undefined
      : (planState.plans.find((p) => p.id === planId) ?? planState.plans[0]);
  const planView = useMemo(
    () =>
      tab === "plan" && plan && planning
        ? planMap(model, planning.sources, plan, planning.build)
        : undefined,
    [tab, plan, planning, model],
  );
  const planSequence = planView?.plan.spec.sequences.find((q) => q.id === planSeq);
  // What the plan touches, as drawn boxes: the map shows only these and their neighbors.
  const planOnly = useMemo(() => {
    if (!planView || planWhole || planSeq) return undefined;
    const after = planView.after;
    const keys = (refs: string[]) =>
      refs.flatMap((ref) => {
        const key = nodeOf(after, ref);
        if (!key) return [];
        return [key.startsWith("element:") ? `element:${shownId(after, key.slice(8))}` : key];
      });
    const { touched, scope } = planFocus(planView.plan.spec);
    // What the person and the agent touched shows with what it connects to; until there's
    // any, the scope the idea landed on shows alone.
    const around = new Set(keys(touched));
    const keep = around.size ? around : new Set(keys(scope));
    return keep.size ? { keep, around } : undefined;
  }, [planView, planWhole, planSeq]);
  const planJourney =
    planView && planSequence ? planView.after.journeys.get(planSequence.journey) : undefined;
  const planInteractions = useMemo(
    () => (planView && planJourney ? journeyInteractions(planView.after, planJourney) : []),
    [planView, planJourney],
  );
  const editPlan = useCallback(
    async (ops: PlanEditOp[]): Promise<boolean> => {
      if (!plan || !planning) return false;
      setPlanBusy(true);
      setPlanError(undefined);
      const base = planning.plans.find((p) => p.path === plan.file)?.text;
      const r = await writePlan(plan.id, ops, base);
      await planning.reload();
      setPlanBusy(false);
      if (!r.ok) setPlanError(r.stale ? `${r.error} It has been reloaded.` : r.error);
      return r.ok;
    },
    [plan, planning],
  );
  // A plan opens on what it changes.
  const planOpened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!planView || planOpened.current === planView.plan.id) return;
    planOpened.current = planView.plan.id;
    // With a focus the map fits it; without one, it moves to the first thing the plan is about.
    const { touched, scope } = planFocus(planView.plan.spec);
    if (touched.length || scope.length) return;
    const first = [...planView.items.keys()][0];
    if (first) setCenterOn(first);
  }, [planView]);
  const openPlan = useCallback((id: string) => {
    setPlanId(id);
    setPlanPop(undefined);
    setPlanSeq(undefined);
    setPlanAt(0);
    setPlanError(undefined);
    setSelected(undefined);
    setPlanWhole(false);
  }, []);
  // The map on the Plan tab is the model with the plan made.
  const mapModel = planView?.after ?? model;

  const journey = journeyId ? model.journeys.get(journeyId) : undefined;
  const interactions = useMemo(
    () => (journey ? journeyInteractions(model, journey) : []),
    [model, journey],
  );
  const interaction: Interaction | undefined = interactions[at];
  // Simulation is hidden until we know people want it (docs/revival/07-mvp-plan.md, §4): journeys
  // show what the model declares, not a run. Lanes, the step panel, and the map all work without one,
  // and core's simulate() and its tests stay, so turning it back on starts here.
  const simulation: Simulation | undefined = undefined;
  // The map shows what changed only on the Changes tab.
  const compare = tab === "changes" ? changes?.compare : undefined;
  const code = useMemo(
    () => ({ codemap: resolveCodeMap(model, files), repo, files: new Set(files), snippets }),
    [model, files, repo, snippets],
  );
  // A Triage record on the map walks through the bug the way a journey walks through a flow.
  const triageJourney = useMemo(
    () =>
      tab === "triage" && onMap && traceCheck?.view.steps.length
        ? traceJourney(traceCheck.view)
        : undefined,
    [tab, onMap, traceCheck],
  );
  const triageInteractions = useMemo(
    () => (triageJourney && traceCheck ? traceInteractions(traceCheck.view) : []),
    [triageJourney, traceCheck],
  );
  const journeyOnMap =
    tab === "journeys" && onMap && journey ? journey : tab === "plan" ? planJourney : triageJourney;
  const mapInteractions = triageJourney
    ? triageInteractions
    : tab === "plan"
      ? planInteractions
      : interactions;
  const mapAt = triageJourney
    ? triageInteractions.findIndex((x) => x.step === traceStep)
    : tab === "plan"
      ? Math.max(
          0,
          planInteractions.findIndex((x) => x.step === planAt),
        )
      : at;

  useEffect(
    () =>
      writeHash({
        tab,
        pair,
        journey: tab === "journeys" ? journeyId : undefined,
        trace: tab === "triage" ? (traceId === NEW ? NEW : traceCheck?.view.id) : undefined,
        environment: tab === "infrastructure" ? environment : undefined,
        plan: tab === "plan" ? (planId === NEW_PLAN ? NEW_PLAN : plan?.id) : undefined,
        data:
          tab === "data" && (selected?.startsWith("data:") || selected?.startsWith("field:"))
            ? selected
            : undefined,
      }),
    [tab, pair, journeyId, selected, traceCheck, traceId, environment, planId, plan],
  );

  // After a live reload, drop references to things that no longer exist.
  useEffect(() => {
    setExpanded((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setTables((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setSelected((prev) => (prev && exists(model, prev, landscape) ? prev : undefined));
    setJourneyId((prev) => (prev && model.journeys.has(prev) ? prev : undefined));
    setEnvironment((prev) =>
      prev && model.environments.has(prev) ? prev : defaultEnvironment(model),
    );
  }, [model, landscape]);

  // The Journeys tab always has a journey open: the most important one, to start.
  useEffect(() => {
    if (tab !== "journeys" || journeyId) return;
    const first = journeysByImportance(model)[0];
    if (first) setJourneyId(first.id);
  }, [tab, journeyId, model]);
  useEffect(() => {
    if (at >= interactions.length && interactions.length) setAt(0);
  }, [at, interactions.length]);

  const grouping = useMemo<Grouping | undefined>(
    () => (landscape ? groupLandscape(model, landscape, groupBy) : undefined),
    [model, landscape, groupBy],
  );

  // What opens on its own: a journey's boxes and stores on the map, a data entry's places.
  const context = journeyOnMap
    ? `journey:${journeyOnMap.id}`
    : tab === "data" && selected
      ? selected
      : "";
  const auto = useMemo(() => {
    const out = {
      expanded: new Set<string>(),
      tables: new Set<string>(),
      fields: new Set<string>(),
    };
    if (journeyOnMap) {
      const stores = journeyStores(mapModel, journeyOnMap);
      for (const id of journeyExpansion(mapModel, journeyOnMap)) out.expanded.add(id);
      for (const id of stores.flatMap((s) => ancestorsOf(mapModel, s))) out.expanded.add(id);
      for (const id of stores) out.tables.add(id);
    } else if (planView) {
      // Open the boxes that hold what the plan adds or changes, so it's in view.
      for (const c of [...planView.diff.elements]) {
        const id = c.kind === "removed" ? undefined : c.id;
        if (id) for (const a of ancestorsOf(mapModel, id)) out.expanded.add(a);
      }
      // And the boxes around what it touches, at whatever level each lives.
      for (const key of planOnly?.keep ?? []) {
        if (key.startsWith("element:"))
          for (const a of ancestorsOf(mapModel, key.slice(8))) out.expanded.add(a);
      }
    } else if (
      tab === "data" &&
      (selected?.startsWith("data:") || selected?.startsWith("field:"))
    ) {
      // Open what the data goes through: the boxes it travels between, and its stores' tables.
      const entries = selected.startsWith("data:")
        ? [selected.slice(5)]
        : (lineageEntries(model, selected.slice(6)) ?? []);
      const places = entries.map((e) => dataPlaces(model, e));
      const stores = places.flatMap((p) => p.stores);
      for (const id of [...stores, ...places.flatMap((p) => p.ends)].flatMap((id) =>
        ancestorsOf(model, shownId(model, id)),
      ))
        out.expanded.add(id);
      for (const id of stores) out.tables.add(id);
      // A field's lineage lights up fields: open the tables it goes through.
      if (selected.startsWith("field:")) for (const e of entries) out.fields.add(e);
    }
    return out;
  }, [model, mapModel, journeyOnMap, tab, selected, planView, planOnly]);
  const shut = closed?.context === context ? closed.ids : undefined;
  const effective = useMemo(() => {
    const merge = (mine: ReadonlySet<string>, theirs: ReadonlySet<string>, prefix: string) =>
      new Set([...mine, ...theirs].filter((id) => !shut?.has(`${prefix}${id}`)));
    return {
      expanded: merge(expanded, auto.expanded, "e:"),
      tables: merge(tables, auto.tables, "t:"),
      fields: new Set([...openFields, ...auto.fields]),
    };
  }, [expanded, tables, openFields, auto, shut]);

  // The rows the journey has at the current step, for stores showing rows.
  const rows = useMemo(
    () =>
      journeyOnMap && rowStores.size
        ? interactionRows(mapModel, journeyOnMap, mapInteractions, mapAt, simulation)
        : undefined,
    [mapModel, journeyOnMap, mapInteractions, mapAt, rowStores],
  );
  // What the journey uses; the rest of its datastores folds away.
  const involved = useMemo(
    () => (journeyOnMap ? journeyInvolvement(mapModel, journeyOnMap, rows) : undefined),
    [mapModel, journeyOnMap, rows],
  );
  const view = useMemo(
    () => ({
      expanded: effective.expanded,
      focus: focused && !journeyOnMap ? selected : undefined,
      only: journeyOnMap ? undefined : planOnly,
      grouping,
      system: journeyOnMap || tab === "data" || effective.expanded.size ? undefined : box,
      tables: effective.tables,
      openFields: effective.fields,
      rows: rows && { stores: rowStores, data: rows },
      involved,
      showAll,
      extra,
    }),
    [
      effective,
      focused,
      journeyOnMap,
      planOnly,
      selected,
      grouping,
      tab,
      box,
      rows,
      rowStores,
      involved,
      showAll,
      extra,
    ],
  );

  const openJourney = useCallback(
    (id: string) => {
      if (!model.journeys.has(id)) return;
      onTab("journeys");
      setSelected(undefined);
      setFocused(false);
      setJourneyId(id);
      setAt(0);
      setShowAll(new Set());
      setExtra(new Set());
    },
    [model, onTab],
  );

  const select = useCallback(
    (key: string | undefined) => {
      setSelected(key);
      if (!key) {
        setFocused(false);
        return;
      }
      if (key.startsWith("journey:")) {
        setSelected(undefined);
        openJourney(key.slice(8));
        return;
      }
      if (key.startsWith("data:") || key.startsWith("field:")) {
        if (tab !== "data") onTab("data");
        return;
      }
      // An environment or a node in one lives on the Infrastructure tab.
      if (key.startsWith("env:") || key.startsWith("deploy:")) {
        const env = key.startsWith("env:")
          ? key.slice(4)
          : model.deploymentNodes.get(key.slice(7))?.environment;
        if (env) setEnvironment(env);
        if (tab !== "infrastructure") onTab("infrastructure");
        return;
      }
      if (key.startsWith("element:")) {
        setBoxed(false);
        const hidden = ancestorsOf(model, shownId(model, key.slice(8)));
        setExpanded((prev) =>
          hidden.every((a) => prev.has(a)) ? prev : new Set([...prev, ...hidden]),
        );
      }
      if (key.startsWith("domain:")) {
        // A domain is a box only when grouping by domain.
        setGroupBy("domain");
        setCenterOn(`group:domain:${key.slice(7)}`);
        return;
      }
      setCenterOn(key.startsWith("element:") ? `element:${shownId(model, key.slice(8))}` : key);
    },
    [model, tab, onTab, openJourney],
  );

  // A box clicked on the map is already in view: select it without moving the map.
  const selectHere = useCallback(
    (key: string | undefined) => {
      if (
        key?.startsWith("element:") ||
        key?.startsWith("actor:") ||
        key?.startsWith("external:")
      ) {
        setSelected(key);
        return;
      }
      select(key);
    },
    [select],
  );

  const pick = useCallback(
    (key: string) => {
      // Search: a box on the Journeys tab is shown on the Overview's map.
      if ((tab === "journeys" || tab === "triage") && /^(element|actor|domain):/.test(key))
        onTab("overview");
      select(key);
    },
    [tab, onTab, select],
  );

  // Show an open datastore's schema or the journey's rows, and bring it into view.
  const storeView = useCallback((id: string, v: "erd" | "rows") => {
    setRowStores((prev) => {
      const next = new Set(prev);
      if (v === "rows") next.add(id);
      else next.delete(id);
      return next;
    });
    setCenterOn(`element:${id}`);
  }, []);

  /** Opens or closes a box, or a datastore's tables, whoever opened it. */
  const flip = useCallback(
    (prefix: "e:" | "t:", id: string) => {
      const open = (prefix === "e:" ? effective.expanded : effective.tables).has(id);
      const change = (prev: ReadonlySet<string>) => {
        const next = new Set(prev);
        if (open) next.delete(id);
        else next.add(id);
        return next;
      };
      if (prefix === "e:") {
        setExpanded(change);
        setBoxed(false);
      } else setTables(change);
      setClosed((prev) => {
        const ids = new Set(prev?.context === context ? prev.ids : []);
        if (open) ids.add(`${prefix}${id}`);
        else ids.delete(`${prefix}${id}`);
        return { context, ids };
      });
      // Bring the opened (or closed) element into view once it's laid out again.
      setCenterOn(`element:${id}`);
    },
    [effective, context],
  );
  const toggle = useCallback((id: string) => flip("e:", id), [flip]);
  /** Opens the boxes a C4 level shows, and closes the rest. */
  const showLevel = useCallback(
    (level: Level) => {
      setExpanded(levelExpansion(model, level));
      setBoxed(level === "context");
      setClosed(undefined);
      setFocused(false);
      // A level is a view of the whole system.
      setPlanWhole(true);
    },
    [model],
  );
  const toggleTables = useCallback((id: string) => flip("t:", id), [flip]);
  const toggleFields = useCallback((entry: string) => {
    setOpenFields((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });
  }, []);

  const count = interactions.length;
  const go = useCallback((n: number) => setAt(Math.max(0, Math.min(count - 1, n))), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "Escape") {
        if (planPop) setPlanPop(undefined);
        else select(undefined);
      } else if (!typing && tab === "journeys" && journey && e.key === "ArrowRight") {
        go(at + 1);
      } else if (!typing && tab === "journeys" && journey && e.key === "ArrowLeft") {
        go(at - 1);
      } else if (!typing && tab === "triage" && traceCheck && /^Arrow(Right|Left)$/.test(e.key)) {
        const last = traceCheck.view.steps.length - 1;
        setTraceAt(Math.max(0, Math.min(last, traceStep + (e.key === "ArrowRight" ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, journey, at, go, select, traceCheck, traceStep, planPop]);

  const lanes = useMemo(
    () => (journey ? journeyLanes(model, journey, interactions, landscape) : undefined),
    [model, journey, interactions, landscape],
  );
  const payload = useMemo(
    () => (journey && interaction ? payloadOf(model, journey, interaction, simulation) : []),
    [model, journey, interaction],
  );
  const journeyStoreIds = useMemo(
    () =>
      journeyOnMap
        ? journeyStores(model, journeyOnMap).filter((id) => effective.tables.has(id))
        : [],
    [model, journeyOnMap, effective.tables],
  );
  const hasData = useMemo(() => dataGroups(model).length > 0, [model]);
  const errors = model.diagnostics.filter((d) => d.severity === "error");
  const warnings = model.diagnostics.filter((d) => d.severity === "warning");

  const details = selected ? (
    <Details
      model={model}
      selected={selected}
      focused={focused}
      expanded={effective.expanded}
      onSelect={select}
      onJourney={openJourney}
      onFocus={setFocused}
      onToggle={toggle}
      code={code}
      compare={compare}
      landscape={landscape}
      recheck={seals?.facts}
    />
  ) : null;
  const canvas = (
    <Canvas
      key={tab}
      model={mapModel}
      grouping={grouping}
      simulation={journeyOnMap ? simulation : undefined}
      view={view}
      selected={selected}
      journey={journeyOnMap}
      interactions={journeyOnMap ? mapInteractions : []}
      at={mapAt}
      stepRoles={triageJourney && traceCheck ? traceRoles(traceCheck.view) : undefined}
      centerOn={centerOn}
      onCentered={() => setCenterOn(undefined)}
      onSelect={selectHere}
      onToggle={toggle}
      onTables={toggleTables}
      onFields={toggleFields}
      onStoreView={storeView}
      onShowTable={(entry) => setExtra((prev) => new Set([...prev, entry]))}
      onShowAll={(id) => setShowAll((prev) => new Set([...prev, id]))}
      compare={compare ?? (planView ? { base: model, diff: planView.diff } : undefined)}
      edit={
        planView
          ? {
              onPoint: (p) => {
                // Read-only: a box only shows what the plan does there; a pin shows its intent.
                if (!planning?.editable && !p.intent) return;
                setPlanSeq(undefined);
                setPlanError(undefined);
                setPlanPop(
                  p.intent
                    ? { intent: p.intent, node: p.node, flow: p.flow }
                    : { node: p.node, at: p.to ? undefined : p.at, flow: p.flow, to: p.to },
                );
              },
              popover: planPop
                ? {
                    anchor: {
                      flow: planPop.flow,
                      node: planPop.node,
                      at: planPop.at ?? planView.pins.find((x) => x.id === planPop.intent)?.at,
                      intent: planPop.intent,
                    },
                    content: (
                      <IntentPopover
                        key={`${planPop.intent ?? ""}${planPop.node ?? ""}${planPop.flow?.x ?? ""}`}
                        map={planView}
                        pop={planPop}
                        editable={!!planning?.editable}
                        busy={planBusy}
                        onEdit={editPlan}
                        onClose={() => setPlanPop(undefined)}
                        onItem={(id) => {
                          setPlanPop(undefined);
                          if (planView.plan.spec.sequences.some((q) => q.id === id)) {
                            setPlanSeq(id);
                            setPlanAt(0);
                          }
                        }}
                      />
                    ),
                  }
                : undefined,
              onDismiss: () => setPlanPop(undefined),
              pins: planView.pins,
              suggested: planView.suggested,
              suggestedEdges: planView.suggestedEdges,
              notes: planView.notes,
            }
          : undefined
      }
      preview={tab === "overview" ? preview : undefined}
      recheck={seals?.facts}
      direction={direction}
      onDirection={setDirection}
      level={
        journeyOnMap || tab === "data"
          ? undefined
          : {
              current: levelOf(model, effective.expanded, !!box && effective.expanded.size === 0),
              onLevel: showLevel,
            }
      }
    />
  );

  let side: React.ReactNode;
  let main: React.ReactNode = canvas;
  let panel: React.ReactNode = details;
  if (tab === "overview") {
    side = (
      <Overview
        model={model}
        landscape={landscape}
        affected={changes?.compare?.journeys}
        seals={seals}
        onJourney={openJourney}
        onPreview={setPreview}
        onSelect={select}
      />
    );
  } else if (tab === "journeys") {
    side = (
      <JourneyList
        model={model}
        journeyId={journeyId}
        onJourney={openJourney}
        affected={changes?.compare?.journeys}
        landscape={landscape}
      />
    );
    main = journey ? (
      <section className="story" aria-label="Journey">
        <header className="story-head">
          <div className="story-title">
            <h1>{journey.spec.goal || journey.spec.name || journey.id}</h1>
            <p className="muted">
              {journey.spec.name ?? journey.id} · {actorLabel(model, journey.spec.actor)} ·{" "}
              <span className={`importance importance-${journey.spec.importance ?? "normal"}`}>
                {journey.spec.importance ?? "normal"}
              </span>
            </p>
          </div>
          <fieldset className="segmented story-view" aria-label="Show the journey as">
            <legend>Show as</legend>
            {(
              [
                [false, "Map", "Each step on the map of the system, one at a time"],
                [true, "Sequence", "Each step as a row, between a column per participant"],
              ] as const
            ).map(([seq, label, title]) => (
              <button
                key={label}
                type="button"
                className={sequence === seq ? "is-on" : undefined}
                aria-pressed={sequence === seq}
                title={title}
                onClick={() => setSequence(seq)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </header>
        <div className="story-body">
          {onMap ? (
            canvas
          ) : lanes ? (
            <Lanes data={lanes} at={at} onAt={go} simulation={simulation} />
          ) : null}
        </div>
      </section>
    ) : (
      <p className="empty-main">No journeys yet. A journey says how an actor reaches a goal.</p>
    );
    panel =
      details && selected ? (
        <>
          <button type="button" className="link back" onClick={() => select(undefined)}>
            ← Back to the step
          </button>
          {details}
        </>
      ) : journey ? (
        <StepPanel
          model={model}
          journey={journey}
          interactions={interactions}
          at={at}
          onAt={go}
          payload={payload}
          simulation={simulation}
          code={code}
          landscape={landscape}
          onSelect={select}
          stores={
            journeyOnMap
              ? journeyStoreIds.map((id) => ({
                  id,
                  name: model.elements.get(id)?.spec.name ?? id,
                  view: rowStores.has(id) ? ("rows" as const) : ("erd" as const),
                  all: showAll.has(id),
                }))
              : undefined
          }
          onStoreView={storeView}
          onShowAll={(id, on) => {
            setShowAll((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            });
            if (!on) setExtra(new Set());
          }}
        />
      ) : null;
  } else if (tab === "triage") {
    side = (
      <TraceList
        checks={traceState.checks}
        problems={traceState.problems}
        traceId={traceCheck?.view.id ?? NEW}
        onTrace={openTrace}
      />
    );
    main = traceCheck ? (
      <TraceStory
        model={model}
        check={traceCheck}
        at={traceStep}
        onAt={setTraceAt}
        landscape={landscape}
        map={triageJourney ? canvas : undefined}
        sequence={sequence}
        onSequence={setSequence}
        editable={!!planning?.editable}
        onSent={async () => {
          await planning?.reload();
        }}
      />
    ) : (
      <TriageStart
        editable={!!planning?.editable}
        onSent={(id) => {
          void planning?.reload().then(() => openTrace(id));
        }}
        model={model}
        files={files}
        checks={traceState.checks}
        onJourney={openJourney}
        onTrace={openTrace}
        onSelect={(key) => {
          onTab("overview");
          select(key);
        }}
      />
    );
    panel =
      details && selected ? (
        <>
          <button type="button" className="link back" onClick={() => select(undefined)}>
            ← Back to the bug
          </button>
          {details}
        </>
      ) : traceCheck ? (
        <TraceStepPanel
          model={model}
          check={traceCheck}
          at={traceStep}
          onAt={setTraceAt}
          code={code}
          onSelect={select}
        />
      ) : null;
  } else if (tab === "infrastructure") {
    side = (
      <EnvironmentList
        model={model}
        environment={environment}
        selected={selected}
        onEnvironment={(id) => {
          setEnvironment(id);
          setSelected(undefined);
        }}
        onSelect={select}
      />
    );
    main = environment ? (
      <InfraCanvas
        key={environment}
        model={model}
        environment={environment}
        selected={selected}
        onSelect={(key) => setSelected(key)}
      />
    ) : (
      <div className="empty-main">
        <InfraIntro />
      </div>
    );
    panel =
      selected?.startsWith("env:") || selected?.startsWith("deploy:") ? (
        <InfraDetails model={model} selected={selected} onSelect={select} />
      ) : (
        details
      );
  } else if (tab === "data") {
    side = <DataList model={model} selected={selected} onSelect={select} />;
    const picked = selected?.startsWith("data:") || selected?.startsWith("field:");
    const page = (
      <DataCatalog
        model={model}
        selected={selected}
        onSelect={select}
        onJourney={(id, step) => {
          openJourney(id);
          setAt(step);
        }}
        onShow={(key) => {
          onTab("overview");
          select(key);
        }}
      />
    );
    main = picked ? (
      <section className="story" aria-label="Data entry">
        <header className="story-head data-head">
          <div className="story-title">
            <p className="muted">
              {selected?.startsWith("field:") ? "Field" : "Data entry"}{" "}
              <code>{selected?.slice(selected.indexOf(":") + 1)}</code>
            </p>
          </div>
          <fieldset className="segmented story-view" aria-label="Show the entry as">
            <legend>Show as</legend>
            {(
              [
                [false, "Page", "Its schema, where it's stored, and who makes and reads it"],
                [
                  true,
                  "Map",
                  "Where it's stored and the arrows it travels, on the map of the system",
                ],
              ] as const
            ).map(([on, label, title]) => (
              <button
                key={label}
                type="button"
                className={dataOnMap === on ? "is-on" : undefined}
                aria-pressed={dataOnMap === on}
                title={title}
                onClick={() => setDataOnMap(on)}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </header>
        <div className="story-body">{dataOnMap ? canvas : page}</div>
      </section>
    ) : (
      page
    );
    // The page is the entry; the panel follows a field's value from table to table, and on the
    // map it says what the entry is.
    panel = selected?.startsWith("field:") || (picked && dataOnMap) ? details : undefined;
  } else if (tab === "plan") {
    side = (
      <PlanList
        plans={planState.plans}
        problems={planState.problems}
        planId={plan?.id ?? NEW_PLAN}
        onPlan={openPlan}
      />
    );
    main = planView ? (
      <section className="story plan-story" aria-label="Plan">
        <PlanHead
          map={planView}
          editable={!!planning?.editable}
          busy={planBusy}
          onEdit={editPlan}
          hint={planningHint(planView.plan.spec, !!planning?.editable)}
          focus={
            planSeq
              ? undefined
              : {
                  whole: planWhole || !planOnly,
                  available: planWhole || !!planOnly,
                  onWhole: (whole: boolean) => {
                    setPlanWhole(whole);
                    if (!whole) setExpanded(new Set());
                  },
                }
          }
        />
        <div className="story-body">{canvas}</div>
      </section>
    ) : (
      <PlanStart
        editable={!!planning?.editable}
        onStarted={(id) => {
          void planning?.reload().then(() => openPlan(id));
        }}
      />
    );
    panel = planView ? (
      <PlanPanel
        map={planView}
        model={model}
        editable={!!planning?.editable}
        busy={planBusy}
        error={planError}
        selected={selected}
        onSelect={(key) => {
          setSelected(key);
          setPlanSeq(undefined);
          if (key) setCenterOn(key);
        }}
        sequence={planSeq}
        onSequence={(id) => {
          setPlanSeq(id);
          setPlanAt(0);
          setSelected(undefined);
        }}
        at={planAt}
        onAt={setPlanAt}
        onEdit={editPlan}
        onPop={(pop) => {
          setPlanError(undefined);
          setPlanPop(pop);
          if (pop.node) setCenterOn(pop.node);
          else {
            const node = planView.pins.find((p) => p.id === pop.intent)?.node;
            if (node) setCenterOn(node);
          }
        }}
      />
    ) : undefined;
  } else {
    const c = changes?.compare;
    // The same shape as Plan and Triage: a header with what it is, where it stands, and its
    // controls, over the map.
    main = (
      <section className="story diff-story" aria-label="Diff">
        <header className="story-head">
          <div className="story-title">
            <h1>{c ? `${c.head ?? "Working tree"} since ${c.ref}` : "Diff"}</h1>
            <p className="muted">
              {c ? (
                <>
                  <span className={`triage-status verdict-status-${c.summary.verdict}`}>
                    {VERDICT_LABEL[c.summary.verdict]}
                  </span>{" "}
                  Read from {c.code.files.length} changed file
                  {c.code.files.length === 1 ? "" : "s"} into {c.head ?? "the working tree"}'s model
                  · your agent sees the same with archdoc check --base {c.ref}
                </>
              ) : (
                (changes?.note ?? "Pick the branches to compare.")
              )}
            </p>
          </div>
          {changes ? (
            <div className="plan-actions">
              <PairPicker changes={changes} />
            </div>
          ) : null}
        </header>
        <div className="story-body">{canvas}</div>
      </section>
    );
    side = (
      <ChangesList
        compare={changes?.compare}
        note={changes?.note}
        selected={selected}
        journeyId={journeyId}
        onSelect={select}
        onJourney={openJourney}
      />
    );
  }

  const top = sections({
    data: hasData,
    diff: {
      available: !!changes,
      title: changes?.pair
        ? `What the code ${changes.pair.head ?? "in the working tree"} changed since ${changes.pair.base}, read into its model`
        : "What a branch's code changed, read into its model",
    },
  });
  const section = sectionOf(tab);
  const sub = top.find((s) => s.id === section)?.tabs ?? [];

  return (
    <div
      className={`app tab-${tab}${panel ? " has-panel" : ""}`}
      style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={20} height={20} />
          <span className="brand-name">ArchDoc</span>
          <span className="model-name">{landscape?.name ?? model.name ?? model.namespace}</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Section">
          {top.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={section === s.id}
              onClick={() => {
                if (s.id !== section) onTab(landingTab(s, lastTab.current[s.id]));
              }}
              title={s.title}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          {landscape && tab !== "journeys" && sectionOf(tab) === "explore" ? (
            <fieldset className="segmented" aria-label="Group the landscape by">
              <legend>Group by</legend>
              {(["repo", "team", "domain"] as const).map((by) => (
                <button
                  key={by}
                  type="button"
                  className={groupBy === by ? "is-on" : undefined}
                  aria-pressed={groupBy === by}
                  disabled={by === "domain" && landscape.domains.length === 0}
                  title={
                    by === "domain" && landscape.domains.length === 0
                      ? "The landscape defines no domains"
                      : undefined
                  }
                  onClick={() => setGroupBy(by)}
                >
                  {by === "repo" ? "Repo" : by === "team" ? "Team" : "Domain"}
                </button>
              ))}
            </fieldset>
          ) : null}
          <SearchBox ref={search} model={model} onPick={pick} />
          {watch ? (
            <span
              className="live"
              title="Watching the model files. Changes appear here automatically."
            >
              <span className="live-dot" key={reloads} /> Live
            </span>
          ) : null}
        </div>
      </header>

      <nav className="subtabs" aria-label={section === "build" ? "Build" : "Explore"}>
        <div className="tabs" role="tablist" aria-label="View">
          {sub.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab subtab"
              aria-selected={tab === t.id}
              disabled={!!t.unavailable}
              onClick={() => onTab(t.id)}
              title={t.unavailable ?? t.title}
            >
              {t.label}
              {t.soon ? <span className="tab-soon">Soon</span> : null}
              {t.id === "changes" && changes?.compare ? (
                <span
                  className={`tab-count${changes.compare.summary.blocking.length ? " has-breaks" : ""}`}
                >
                  {changes.compare.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {errors.length || warnings.length ? (
        <details className={`diagnostics${errors.length ? " has-errors" : ""}`}>
          <summary>
            {errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}
            {errors.length && warnings.length ? ", " : ""}
            {warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}{" "}
            in the model{errors.length ? ". What you see may be incomplete." : "."}
          </summary>
          <ul>
            {model.diagnostics.map((d) => (
              <li key={formatDiagnostic(d)} className={`sev-${d.severity}`}>
                <code>{formatDiagnostic(d)}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {side ? (
        <aside className="side" aria-label={tab === "overview" ? "Overview" : "List"}>
          {side}
        </aside>
      ) : null}
      <main
        className="main"
        aria-label={tab === "journeys" ? "Journey" : tab === "data" ? "Data" : "Map"}
      >
        {main}
      </main>
      {panel ? (
        <aside className="panel" aria-label="Details">
          <ResizeHandle width={panelWidth} onResize={setPanelWidth} />
          {selected && tab !== "journeys" && tab !== "triage" && tab !== "plan" ? (
            <button
              type="button"
              className="panel-close"
              aria-label="Close the details"
              title="Close"
              onClick={() => select(undefined)}
            >
              ×
            </button>
          ) : null}
          {panel}
        </aside>
      ) : null}
    </div>
  );
}

/** What an interaction carries, or for a writer storing it, what it writes: with the simulated records. */
function payloadOf(
  model: Model,
  journey: JourneyNode,
  x: Interaction,
  simulation: Simulation | undefined,
): PayloadEntry[] {
  const d = stepData(model, journey, x.step, simulation);
  if (!x.store) return d.message?.entries ?? [];
  const registry = new DataRegistry(model);
  const ns = `${model.namespace}.`;
  return d.writes
    .filter((w) => x.writes.includes(w.entry))
    .map((w) => {
      const node = registry.entry(w.entry)?.node;
      return {
        entry: w.entry,
        label: w.entry.startsWith(ns) ? w.entry.slice(ns.length) : w.entry,
        kind: node?.spec.kind,
        fields: Object.entries(node?.spec.fields ?? {}).map(([name, f]) => ({
          name,
          type: f.type,
          classification: f.classification,
        })),
        record: w.record,
        changed: new Set(w.values.keys()),
      };
    });
}

function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | undefined>(undefined);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable window splitter; <hr> can't be one.
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL}
      aria-valuemax={MAX_PANEL}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + (start.current.x - e.clientX));
      }}
      onPointerUp={() => {
        start.current = undefined;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 24);
        if (e.key === "ArrowRight") onResize(width - 24);
      }}
    />
  );
}

const MIN_PANEL = 280;
const MAX_PANEL = 720;
const PANEL_KEY = "archdoc:panel-width";

function usePanelWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      if (saved >= MIN_PANEL && saved <= MAX_PANEL) return saved;
    } catch {
      // Storage can be unavailable; the default is fine.
    }
    return 380;
  });
  const set = useCallback((w: number) => {
    const clamped = Math.round(Math.max(MIN_PANEL, Math.min(MAX_PANEL, w)));
    setWidth(clamped);
    try {
      localStorage.setItem(PANEL_KEY, String(clamped));
    } catch {
      // Ignore: the width just won't be remembered.
    }
  }, []);
  return [width, set];
}

/** The entries a field's lineage goes through. */
function lineageEntries(model: Model, ref: string): string[] | undefined {
  const l = lineage(model, ref);
  if (!l) return undefined;
  return [
    ...new Set([
      l.field.entry,
      ...[...l.upstream, ...l.downstream].flatMap((e) => [
        e.to.entry,
        ...e.from.map((f) => f.entry),
      ]),
    ]),
  ];
}

function exists(model: Model, key: string, landscape?: LandscapeInfo): boolean {
  if (key.startsWith("data:")) return !!new DataRegistry(model).entry(key.slice(5));
  if (key.startsWith("field:")) return lineage(model, key.slice(6)) !== undefined;
  if (key.startsWith("domain:")) return !!landscape?.domains.some((d) => d.id === key.slice(7));
  if (key.startsWith("actor:")) return model.actors.has(key.slice(6));
  if (key.startsWith("element:")) return model.elements.has(key.slice(8));
  if (key.startsWith("env:")) return model.environments.has(key.slice(4));
  if (key.startsWith("deploy:")) return model.deploymentNodes.has(key.slice(7));
  return model.relationships.some(
    (r) => r.to.type === "external" && `external:${r.to.ref}` === key,
  );
}

const WORKING_TREE = "";

/**
 * The two branches the Diff tab compares: branch 1, the one with the change
 * (the working tree unless someone picks another), and branch 2, the one it
 * left (main unless someone picks another).
 */
function PairPicker({ changes }: { changes: ChangesControl }) {
  const { refs, pair } = changes;
  if (!refs?.branches.length) {
    // A static page shows only the change it was built with.
    return pair ? (
      <span className="pair">
        <span className="pair-ref">{pair.head ?? "this version"}</span> since{" "}
        <span className="pair-ref">{pair.base}</span>
      </span>
    ) : null;
  }
  const options = (extra: string | undefined) =>
    [...(extra && !refs.branches.includes(extra) ? [extra] : []), ...refs.branches].map((b) => (
      <option key={b} value={b}>
        {b}
      </option>
    ));
  return (
    <fieldset className="pair">
      <legend>Diff</legend>
      <label>
        <span className="sr-only">Branch 1</span>
        <select
          value={pair?.head ?? WORKING_TREE}
          disabled={!pair}
          onChange={(e) =>
            pair && changes.onPair({ base: pair.base, head: e.target.value || undefined })
          }
          title="Branch 1: the branch with the change, read from its code"
        >
          <option value={WORKING_TREE}>
            Working tree{refs.current ? ` (${refs.current})` : ""}
          </option>
          {options(pair?.head)}
        </select>
      </label>
      <span aria-hidden="true">since</span>
      <label>
        <span className="sr-only">Branch 2</span>
        <select
          value={pair?.base ?? ""}
          onChange={(e) => changes.onPair({ base: e.target.value, head: pair?.head })}
          title="Branch 2: the branch it left, such as main"
        >
          {pair ? null : <option value="">Pick a branch…</option>}
          {options(pair?.base)}
        </select>
      </label>
    </fieldset>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="splash">
      <p>{children}</p>
    </div>
  );
}

/** The Diff header's verdict, in the PR comment's terms. */
const VERDICT_LABEL = {
  blocking: "Blocking",
  attention: "To check",
  info: "Touches the model",
  none: "Nothing to check",
} as const;

/** What the plan's header says to do next. */
function planningHint(
  spec: {
    unread?: readonly unknown[] | undefined;
    intents: readonly { by?: string | undefined }[];
  },
  editable: boolean,
): string | undefined {
  if (!editable) return "Read-only here: plans are made in archdoc view.";
  if (!spec.intents.some((n) => !n.by?.startsWith("agent:")))
    return "Click in a box on the map and say what you want there. Your agent answers once you send it.";
  const unread = spec.unread?.length ?? 0;
  if (unread)
    return `${unread} edit${unread === 1 ? "" : "s"} your agent hasn't seen: Send to agent when you want its review.`;
  return undefined;
}
