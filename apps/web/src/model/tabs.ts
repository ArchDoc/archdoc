import type { Tab } from "./useCompare.js";

/** The top-level tabs: Explore reads the model as it is, Build works on a change to it. */
export type Section = "explore" | "build";

export interface TabInfo {
  id: Tab;
  label: string;
  title?: string | undefined;
  /** Shown but not open yet. */
  soon?: boolean | undefined;
  /** Why it can't be opened here, when it can't. */
  unavailable?: string | undefined;
}

export interface SectionInfo {
  id: Section;
  label: string;
  title: string;
  tabs: TabInfo[];
}

/** What the explorer has to show, which decides the tabs it offers. */
export interface TabsInput {
  data: boolean;
  /** Whether there are branches to diff, and when there are, what the Diff compares. */
  diff: { available: boolean; title?: string | undefined };
}

/** The section a tab sits under. */
export function sectionOf(tab: Tab): Section {
  return tab === "plan" || tab === "triage" || tab === "changes" ? "build" : "explore";
}

/** The two top-level tabs and the tabs under each, in order. */
export function sections(input: TabsInput): SectionInfo[] {
  const explore: TabInfo[] = [
    { id: "overview", label: "Overview" },
    { id: "journeys", label: "Journeys" },
    ...(input.data ? [{ id: "data" as const, label: "Data" }] : []),
    {
      id: "infrastructure",
      label: "Infrastructure",
      title:
        "Where the system is deployed: each environment, its infrastructure, and what runs on it",
    },
  ];
  const build: TabInfo[] = [
    {
      id: "plan",
      label: "Plan",
      title:
        "Design a change on the map with your agent, each part with its intent, before it's built",
    },
    {
      id: "triage",
      label: "Triage",
      title: "Bugs followed to their root cause: each one's journey through the system",
    },
    {
      id: "changes",
      label: "Diff",
      title: input.diff.title,
      unavailable: input.diff.available
        ? undefined
        : "Start the explorer with archdoc view in a git repository to diff branches",
    },
  ];
  return [
    {
      id: "explore",
      label: "Explore",
      title: "The system as the model describes it",
      tabs: explore,
    },
    {
      id: "build",
      label: "Build",
      title: "Plan, triage, and review a change to the system",
      tabs: build,
    },
  ];
}

/**
 * The tab a top-level tab opens on: the one last open under it, if it's still there, or else
 * its first open tab (the Diff, under Build, when there's one to show).
 */
export function landingTab(section: SectionInfo, last: Tab | undefined): Tab {
  const open = section.tabs.filter((t) => !t.unavailable);
  if (last && open.some((t) => t.id === last)) return last;
  if (section.id === "build" && open.some((t) => t.id === "changes")) return "changes";
  return (open[0] ?? section.tabs[0])?.id ?? "overview";
}
