import { DataRegistry, type Model, type Target } from "@archdoc/core/browser";
import { type ReactNode, useMemo } from "react";
import { type EntryMove, entrySheet, storeCards, travellingEntries } from "../graph/catalog.js";
import { sensitivity } from "../graph/data.js";
import { targetLabel } from "../model/stories.js";

const ROUTINE = new Set(["public", "internal"]);

export interface DataCatalogProps {
  model: Model;
  /** data:<entry> or field:<entry.field>, or nothing for the catalog. */
  selected?: string | undefined;
  /** Picks an entry or a field; nothing goes back to the catalog. */
  onSelect: (key: string | undefined) => void;
  /** Opens a journey at one of its interactions. */
  onJourney: (journey: string, at: number) => void;
  /** Shows an element or actor on the Overview's map. */
  onShow: (key: string) => void;
}

/**
 * The Data tab's page: with nothing picked, where the data lives (each
 * datastore and queue with its tables and who reaches it) and what travels
 * between the parts; with an entry picked, its schema and everything that
 * makes, stores, sends, and reads it.
 */
export function DataCatalog(props: DataCatalogProps) {
  const { selected } = props;
  const entry = selected?.startsWith("data:")
    ? selected.slice(5)
    : selected?.startsWith("field:")
      ? selected.slice(6, selected.lastIndexOf("."))
      : undefined;
  return (
    <section className="catalog" aria-label="Data">
      {entry ? <EntryPage {...props} entry={entry} /> : <Catalog {...props} />}
    </section>
  );
}

function Catalog(props: DataCatalogProps) {
  const { model } = props;
  const stores = useMemo(() => storeCards(model), [model]);
  const travelling = useMemo(() => travellingEntries(model), [model]);
  const ns = model.namespace;
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  const shapeless = [...model.data.values()].filter(
    (d) => !d.spec.source && !Object.keys(d.spec.fields ?? {}).length,
  ).length;
  return (
    <div className="catalog-page">
      <header className="catalog-head">
        <h1>Where the data lives</h1>
        <p className="muted">
          {model.data.size} data {model.data.size === 1 ? "entry" : "entries"} in {stores.length}{" "}
          {stores.length === 1 ? "datastore or queue" : "datastores and queues"}
          {shapeless ? `; ${shapeless} without fields yet` : ""}. Pick an entry for its schema and
          everything that makes, stores, and reads it.
        </p>
      </header>
      {stores.length ? (
        <div className="store-grid">
          {stores.map((s) => (
            <article key={s.id} className={`store-card tone-${s.kind}`}>
              <header>
                <button
                  type="button"
                  className="link store-name"
                  onClick={() => props.onShow(`element:${s.id}`)}
                >
                  {s.name}
                </button>
                <span className="muted">
                  {s.kind}
                  {s.technology ? ` · ${s.technology}` : ""}
                </span>
              </header>
              {s.description ? <p className="store-desc">{s.description}</p> : null}
              {s.tables.length ? (
                <table className="store-tables">
                  <thead>
                    <tr>
                      <th scope="col">{s.kind === "queue" ? "Channel" : "Table"}</th>
                      <th scope="col">Holds</th>
                      <th scope="col">Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.tables.map((t) => (
                      <tr key={t.table}>
                        <td className="mono">{t.table}</td>
                        <td>
                          <button
                            type="button"
                            className="link"
                            onClick={() => props.onSelect(`data:${t.entry}`)}
                          >
                            {short(t.entry)}
                          </button>
                          <FieldCount fields={t.fields} sourced={t.sourced} />
                        </td>
                        <td className="mono muted">{t.key ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {s.carries.length ? (
                <p className="store-line">
                  <span className="muted">{s.kind === "queue" ? "Carries " : "Also sent "}</span>
                  {s.carries.map((e, i) => (
                    <span key={e}>
                      {i ? ", " : ""}
                      <button
                        type="button"
                        className="link"
                        onClick={() => props.onSelect(`data:${e}`)}
                      >
                        {short(e)}
                      </button>
                    </span>
                  ))}
                </p>
              ) : null}
              {!s.tables.length && !s.carries.length ? (
                <p className="store-line muted">
                  The model doesn't say what it holds. Add <code>stores:</code> with each table and
                  the entry it holds.
                </p>
              ) : null}
              {s.writers.length ? (
                <Parties
                  label="Written by"
                  model={model}
                  targets={s.writers}
                  onShow={props.onShow}
                />
              ) : null}
              {s.users.length ? (
                <Parties
                  label="Used by"
                  model={model}
                  targets={s.users.map((u) => u.from)}
                  titles={s.users.map((u) => u.description)}
                  onShow={props.onShow}
                />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No datastores or queues yet.</p>
      )}
      {travelling.length ? (
        <section className="catalog-section">
          <h2>What travels between the parts</h2>
          <p className="muted">Requests, responses, messages, and events no datastore holds.</p>
          <table className="catalog-table">
            <thead>
              <tr>
                <th scope="col">Entry</th>
                <th scope="col">Kind</th>
                <th scope="col">From → to</th>
              </tr>
            </thead>
            <tbody>
              {travelling.map((t) => (
                <tr key={t.entry}>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => props.onSelect(`data:${t.entry}`)}
                    >
                      {short(t.entry)}
                    </button>
                    <FieldCount fields={t.fields || undefined} sourced={t.sourced} />
                    {t.description ? <p className="muted small">{t.description}</p> : null}
                  </td>
                  <td className="muted">{t.kind}</td>
                  <td>
                    <Moves model={model} moves={t.moves.slice(0, 3)} />
                    {t.moves.length > 3 ? (
                      <span className="muted small">and {t.moves.length - 3} more</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function EntryPage(props: DataCatalogProps & { entry: string }) {
  const { model, entry } = props;
  const registry = useMemo(() => new DataRegistry(model), [model]);
  const sheet = useMemo(() => entrySheet(model, entry), [model, entry]);
  const found = registry.entry(entry);
  if (!found) return <p className="empty-main">No data entry {entry}.</p>;
  const d = found.node;
  const ns = model.namespace;
  const short = (q: string) => (q.startsWith(`${ns}.`) ? q.slice(ns.length + 1) : q);
  const fields = Object.entries(d.spec.fields ?? {});
  const pointsTo = new Map(sheet.refersTo.map((r) => [r.field, r.to]));
  const field = props.selected?.startsWith("field:") ? props.selected.slice(6) : undefined;
  const elementKey = (namespace: string, id: string) =>
    `element:${namespace === ns ? id : `${namespace}.${id}`}`;
  return (
    <div className="catalog-page">
      <button type="button" className="link back" onClick={() => props.onSelect(undefined)}>
        ← Where the data lives
      </button>
      <header className="catalog-head">
        <p className="eyebrow">Data · {d.spec.kind}</p>
        <h1>{d.spec.name ?? short(entry)}</h1>
        <div className="chips">
          {sensitivity(d).map((c) => (
            <span key={c} className="chip classification">
              {c}
            </span>
          ))}
          {d.spec.status && d.spec.status !== "active" ? (
            <span className="chip">{d.spec.status}</span>
          ) : null}
        </div>
        {d.spec.description ? <p className="lede">{d.spec.description}</p> : null}
        {d.spec.source ? (
          <p className="muted">
            Fields from{" "}
            {Object.entries(d.spec.source).map(([k, v]) => (
              <code key={k}>
                {k} {v}
              </code>
            ))}
          </p>
        ) : null}
      </header>

      <Section title="Schema">
        {fields.length ? (
          <table className="catalog-table schema">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Points to</th>
                <th scope="col">Class</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([name, f]) => {
                const to = pointsTo.get(name);
                const on = field === `${entry}.${name}`;
                return (
                  <tr key={name} className={on ? "is-on" : undefined}>
                    <td className="mono">
                      <button
                        type="button"
                        className="link"
                        title="Where its value comes from and goes"
                        aria-pressed={on}
                        onClick={() => props.onSelect(`field:${entry}.${name}`)}
                      >
                        {name}
                      </button>
                      {sheet.keys.has(name) ? <span className="chip small">key</span> : null}
                      {f.description ? <p className="muted small">{f.description}</p> : null}
                    </td>
                    <td className="mono muted">
                      {f.type ?? ""}
                      {f.values ? ` (${f.values.join(", ")})` : ""}
                    </td>
                    <td>
                      {to ? (
                        <button
                          type="button"
                          className="link mono"
                          onClick={() => props.onSelect(`data:${to.entry}`)}
                        >
                          {short(to.entry)}.{to.field}
                        </button>
                      ) : null}
                    </td>
                    <td>
                      {f.classification ? (
                        <span
                          className={`chip${ROUTINE.has(f.classification) ? "" : " classification"}`}
                        >
                          {f.classification}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="notice">
            No fields yet. Find where the code defines it (the type or class it's built from, a
            migration, a protobuf or OpenAPI schema) and add <code>fields:</code>, or a{" "}
            <code>source:</code> to read them from.
          </p>
        )}
        {d.spec.states?.length ? (
          <p className="muted">
            Lifecycle:{" "}
            {d.spec.states.map((s, i) => (
              <span key={s}>
                {i ? " · " : ""}
                <code>{s}</code>
              </span>
            ))}
          </p>
        ) : null}
      </Section>

      <Section title="Where it's stored">
        {sheet.stores.length ? (
          <ul className="plain">
            {sheet.stores.map((s) => (
              <li key={`${s.namespace}.${s.element}.${s.table}`}>
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onShow(elementKey(s.namespace, s.element))}
                >
                  {model.elements.get(s.element)?.spec.name ??
                    model.elements.get(s.element)?.key ??
                    s.element}
                </button>
                <span className="muted">
                  {" "}
                  · <code>{s.table}</code>
                  {s.key ? ` · key ${s.key}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nowhere: it travels between the parts. A datastore that keeps it says so with{" "}
            <code>stores:</code>.
          </p>
        )}
      </Section>

      <Section title="Who makes and gets it">
        {sheet.moves.length ? (
          <Moves model={model} moves={sheet.moves} onShow={props.onShow} />
        ) : (
          <p className="muted">
            No use or journey step says it sends or writes this. Name it with <code>sends:</code>,{" "}
            <code>creates:</code>, or <code>changes:</code> where it travels.
          </p>
        )}
      </Section>

      {sheet.steps.length ? (
        <Section title="In journeys">
          <ul className="plain">
            {sheet.steps.map((s) => (
              <li key={`${s.journey}#${s.at}`}>
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onJourney(s.journey, s.at)}
                >
                  {model.journeys.get(s.journey)?.spec.goal ?? s.journey}
                </button>
                <span className="muted">
                  {" "}
                  · step {s.label}, {s.how}
                  {s.action ? `: ${s.action}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {sheet.refersTo.length || sheet.referredBy.length ? (
        <Section title="Related entries">
          <ul className="plain">
            {sheet.refersTo.map((r) => (
              <li key={`to:${r.field}`}>
                <code>{r.field}</code> →{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onSelect(`data:${r.to.entry}`)}
                >
                  {short(r.to.entry)}
                </button>
                <span className="muted">.{r.to.field}</span>
              </li>
            ))}
            {sheet.referredBy.map((r) => (
              <li key={`by:${r.entry}.${r.field}`}>
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onSelect(`data:${r.entry}`)}
                >
                  {short(r.entry)}
                </button>
                <span className="muted">.{r.field}</span> → <code>{r.to.field}</code>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

const HOW: Record<EntryMove["how"], string> = {
  writes: "writes",
  sends: "sends",
  step: "sends",
  accepts: "calls with",
  returns: "gets back",
  carries: "publishes",
};

/** Who sends or writes an entry to whom, one line each. */
function Moves(props: {
  model: Model;
  moves: EntryMove[];
  onShow?: ((key: string) => void) | undefined;
}) {
  const label = (t: Target) => targetLabel(props.model, t);
  const party = (t: Target) =>
    props.onShow && t.type !== "external" ? (
      <button type="button" className="link" onClick={() => props.onShow?.(`${t.type}:${t.id}`)}>
        {label(t)}
      </button>
    ) : (
      <span>{label(t)}</span>
    );
  // One line per pair: what goes from one to the other, every way the model says it does.
  const pairs = new Map<string, { from: Target; to: Target; hows: string[] }>();
  for (const m of props.moves) {
    const k = `${label(m.from)}>${label(m.to)}`;
    const p = pairs.get(k) ?? { from: m.from, to: m.to, hows: [] };
    const how = `${HOW[m.how]}${m.via ? ` via ${m.via}` : ""}`;
    if (!p.hows.includes(how)) p.hows.push(how);
    pairs.set(k, p);
  }
  return (
    <ul className="plain moves">
      {[...pairs].map(([k, p]) => (
        <li key={k}>
          {party(p.from)} <span className="arrow">→</span> {party(p.to)}{" "}
          <span className="muted small">{p.hows.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

function Parties(props: {
  label: string;
  model: Model;
  targets: Target[];
  titles?: (string | undefined)[];
  onShow: (key: string) => void;
}) {
  const seen = new Set<string>();
  return (
    <p className="store-line">
      <span className="muted">{props.label} </span>
      {props.targets.map((t, i) => {
        const key = t.type === "external" ? t.ref : `${t.type}:${t.id}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return (
          <span key={key}>
            {seen.size > 1 ? ", " : ""}
            {t.type === "external" ? (
              targetLabel(props.model, t)
            ) : (
              <button
                type="button"
                className="link"
                title={props.titles?.[i]}
                onClick={() => props.onShow(key)}
              >
                {targetLabel(props.model, t)}
              </button>
            )}
          </span>
        );
      })}
    </p>
  );
}

function FieldCount(props: { fields?: number | undefined; sourced: boolean }) {
  if (props.fields) return <span className="muted small"> · {props.fields} fields</span>;
  if (props.sourced) return <span className="muted small"> · from its schema</span>;
  return <span className="chip small warn">no fields</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="catalog-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
