/** A kind of box the map colors one way, such as every container. */
export interface LegendKind {
  /** The tone's name: the `tone-<id>` class on a box, and the `--kind-<id>` color token. */
  id: string;
  label: string;
}

const TONES: Record<string, string> = {
  actor: "Person or team",
  agent: "AI agent",
  automation: "Automated system",
  system: "System",
  container: "Container",
  component: "Component",
  code: "Code",
  datastore: "Datastore",
  queue: "Queue",
  external: "External",
};

/** The order the legend lists kinds in: who uses the system, then outside in. */
const ORDER = Object.keys(TONES);

/**
 * The color a box gets, by what it is: people and teams one color, AI agents
 * another, automated systems that call in a third, and each kind of element
 * its own. A repo in a landscape is colored
 * as a system; a team's or domain's frame has none.
 */
export function toneOf(box: { family: string; kind: string }): LegendKind | undefined {
  let id: string | undefined;
  if (box.family === "actor")
    id = box.kind === "agent" ? "agent" : box.kind === "system" ? "automation" : "actor";
  else if (box.family === "element" || box.family === "external")
    id = box.kind === "repo" ? "system" : box.kind;
  const label = id ? TONES[id] : undefined;
  return id && label ? { id, label } : undefined;
}

export interface LegendProps {
  kinds: LegendKind[];
  /** Whether each use's description shows beside its line. */
  notes: boolean;
  onNotes: (on: boolean) => void;
  /** Which way the map runs, and how to change it; without it, the map can't turn. */
  direction?: "RIGHT" | "DOWN" | undefined;
  onDirection?: ((direction: "RIGHT" | "DOWN") => void) | undefined;
}

const DIRECTIONS = [
  ["RIGHT", "LR", "Left to right"],
  ["DOWN", "TD", "Top down"],
] as const;

/**
 * One box for how the map looks: what each color means, which way it runs,
 * and the switch for the lines' descriptions. Closed, it still says the way.
 */
export function Legend({ kinds, notes, onNotes, direction, onDirection }: LegendProps) {
  const sorted = [...kinds].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return (
    <details className="map-legend" open>
      <summary>
        Key and layout
        {direction && onDirection ? (
          <span className="legend-way">{direction === "DOWN" ? "TD" : "LR"}</span>
        ) : null}
      </summary>
      {onDirection ? (
        <fieldset className="segmented legend-layout" aria-label="Layout direction">
          <legend>Layout</legend>
          {DIRECTIONS.map(([d, label, title]) => (
            <button
              key={d}
              type="button"
              className={direction === d ? "is-on" : undefined}
              aria-pressed={direction === d}
              title={title}
              onClick={() => onDirection(d)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      ) : null}
      <label className="legend-notes" title="Show what each use is for, beside its line">
        <input type="checkbox" checked={notes} onChange={(e) => onNotes(e.currentTarget.checked)} />{" "}
        Descriptions
      </label>
      {sorted.length ? (
        <ul className="legend-kinds" aria-label="Colors on the map">
          {sorted.map((k) => (
            <li key={k.id} className={`legend-kind tone-${k.id}`}>
              <span className="legend-swatch" aria-hidden="true" />
              {k.label}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
