import { describe, expect, it } from "vitest";
import { landingTab, sectionOf, sections } from "../src/model/tabs.js";

const everything = { data: true, diff: { available: true } };

describe("the explorer's tabs", () => {
  it("puts the model under Explore and the work on it under Build", () => {
    const [explore, build] = sections(everything);
    expect(explore?.label).toBe("Explore");
    expect(explore?.tabs.map((t) => t.label)).toEqual([
      "Overview",
      "Journeys",
      "Data",
      "Infrastructure",
    ]);
    expect(build?.label).toBe("Build");
    expect(build?.tabs.map((t) => t.label)).toEqual(["Plan", "Triage", "Diff"]);
    expect(build?.tabs.filter((t) => t.soon)).toEqual([]);
  });

  it("leaves out Data when there is none", () => {
    const [explore] = sections({ ...everything, data: false });
    expect(explore?.tabs.map((t) => t.id)).toEqual(["overview", "journeys", "infrastructure"]);
  });

  it("shows the Diff without branches, but says why it can't open", () => {
    const build = sections({ ...everything, diff: { available: false } })[1];
    expect(build?.tabs.find((t) => t.id === "changes")?.unavailable).toMatch(/archdoc view/);
    if (build) expect(landingTab(build, undefined)).toBe("plan");
  });

  it("knows each tab's section", () => {
    expect(sectionOf("overview")).toBe("explore");
    expect(sectionOf("changes")).toBe("build");
    expect(sectionOf("triage")).toBe("build");
  });

  it("opens a section where you left it, or on its first tab", () => {
    const [explore, build] = sections(everything);
    if (!explore || !build) throw new Error("two sections");
    expect(landingTab(explore, undefined)).toBe("overview");
    expect(landingTab(explore, "data")).toBe("data");
    expect(landingTab(build, undefined)).toBe("changes");
    expect(landingTab(build, "triage")).toBe("triage");
    // A tab that's gone since falls back to the first.
    const [noData] = sections({ ...everything, data: false });
    if (noData) expect(landingTab(noData, "data")).toBe("overview");
  });
});
