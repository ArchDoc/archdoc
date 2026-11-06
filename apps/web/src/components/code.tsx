import {
  type CodeMap,
  type JourneyStep,
  literalPrefix,
  type Model,
  type SnippetPlace,
  snippetKey,
  snippetLabel,
} from "@archdoc/core/browser";
import { useState } from "react";
import type { RepoLinks } from "../model/useModel.js";

export interface CodeContext {
  codemap: CodeMap;
  repo: RepoLinks;
  files: ReadonlySet<string>;
  /** Where each code snippet is, by snippetKey, as the server read it from the files. */
  snippets?: Readonly<Record<string, SnippetPlace>> | undefined;
}

/** A link to a file or directory on the repository's web host, at its lines when given ("40-88"). */
export function webLink(
  repo: RepoLinks,
  path: string,
  isFile: boolean,
  lines?: string,
): string | undefined {
  const ref = repo.branch ?? repo.commit;
  if (!repo.webUrl || !ref) return undefined;
  const encode = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  // GitHub and GitLab both read #L40-L88 (GitLab as #L40-88; it takes either form's start).
  const at = isFile && lines ? `#L${lines.replace("-", "-L")}` : "";
  // Branch names can contain slashes; GitHub and GitLab take them as is.
  return `${repo.webUrl}/${isFile ? "blob" : "tree"}/${encode(ref)}/${encode(path)}${at}`;
}

/** A link that opens the path in VS Code on this machine, at its first line when given. */
export function editorLink(repo: RepoLinks, path: string, lines?: string): string | undefined {
  if (!repo.root) return undefined;
  const at = lines ? `:${lines.split("-")[0]}` : "";
  return `vscode://file${repo.root.startsWith("/") ? "" : "/"}${repo.root}/${path}${at}`;
}

/** The part of a code path that's a real file or directory, for linking a glob. */
export function linkTarget(
  pattern: string,
  files: ReadonlySet<string>,
): { path: string; isFile: boolean } {
  const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!/[*?{]/.test(clean)) return { path: clean, isFile: files.has(clean) };
  const prefix = literalPrefix(clean);
  const dir = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : prefix.slice(0, Math.max(0, prefix.lastIndexOf("/")));
  return { path: dir, isFile: false };
}

export function PathLinks({
  repo,
  path,
  isFile,
  lines,
}: {
  repo: RepoLinks;
  path: string;
  isFile: boolean;
  lines?: string | undefined;
}) {
  const web = webLink(repo, path, isFile, lines);
  const editor = editorLink(repo, path, lines);
  return (
    <span className="path-links">
      {web ? (
        <a href={web} target="_blank" rel="noreferrer" title="Open on the repository's web host">
          {hostName(repo.webUrl)}
        </a>
      ) : null}
      {editor ? (
        <a href={editor} title="Open in VS Code">
          VS Code
        </a>
      ) : null}
    </span>
  );
}

/** Code paths for an element, with links, and the files mapped to it. */
export function CodeSection({
  model,
  elementId,
  ctx,
  mapped,
}: {
  model: Model;
  elementId: string;
  ctx: CodeContext;
  mapped: string[];
}) {
  const [showAll, setShowAll] = useState(false);
  const element = model.elements.get(elementId);
  if (!element) return null;
  const shown = showAll ? mapped : mapped.slice(0, 12);

  return (
    <>
      <CodeRefs model={model} elementId={elementId} ctx={ctx} />
      {ctx.files.size > 0 && mapped.length > 0 ? (
        <details className="files" open={mapped.length > 0 && mapped.length <= 12}>
          <summary>
            {mapped.length} file{mapped.length === 1 ? "" : "s"}
            {element.childIds.length ? " here and inside" : ""}
          </summary>
          <ul className="file-list">
            {shown.map((f) => (
              <li key={f}>
                <span className="file-name" title={f}>
                  {f}
                </span>
                <PathLinks repo={ctx.repo} path={f} isFile />
              </li>
            ))}
          </ul>
          {mapped.length > shown.length ? (
            <button type="button" className="link" onClick={() => setShowAll(true)}>
              Show all {mapped.length}
            </button>
          ) : null}
        </details>
      ) : null}
    </>
  );
}

/** An element's code: paths, with links to each (at a symbol's lines when the server found them). */
export function CodeRefs({
  model,
  elementId,
  ctx,
}: {
  model: Model;
  elementId: string;
  ctx: CodeContext;
}) {
  const element = model.elements.get(elementId);
  if (!element?.code.length) return null;
  const stale = new Set(
    ctx.codemap.stale.filter((s) => s.element === elementId).map((s) => s.pattern),
  );
  return (
    <ul className="code-list">
      {element.code.map((c, i) => {
        const t = linkTarget(c.path, ctx.files);
        // A symbol's lines, as the server found its declaration; written lines as they are.
        const place = ctx.snippets?.[snippetKey(c)];
        const found = place && "start" in place ? place : undefined;
        const lines = found ? `${found.start}-${found.end}` : c.lines;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a path can be listed again for another snippet.
          <li key={`${c.path}#${i}`}>
            {stale.has(c.path) ? (
              <span className="code-missing" title="Fix the path in the model, or add the code">
                No files match <code>{c.path}</code>
              </span>
            ) : (
              <>
                <code title={c.symbol ? `The declaration of ${c.symbol}` : undefined}>
                  {snippetLabel(c)}
                </code>
                {found ? (
                  <span className="code-lines">
                    lines {found.start}–{found.end}
                  </span>
                ) : null}
                {place && "problem" in place ? (
                  <span className="code-missing" title={`${c.path} ${place.problem}`}>
                    Doesn't match the code
                  </span>
                ) : (
                  <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} lines={lines} />
                )}
              </>
            )}
            {c.description ? <p>{c.description}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The code elements inside an element (its key functions, classes, and
 * lines), each with what it does and links to it. The map doesn't draw them.
 */
export function KeyCode({
  model,
  ids,
  ctx,
  onSelect,
}: {
  model: Model;
  ids: readonly string[];
  ctx: CodeContext;
  onSelect: (key: string) => void;
}) {
  return (
    <ul className="key-code">
      {ids.map((id) => {
        const el = model.elements.get(id);
        if (!el) return null;
        return (
          <li key={id}>
            <button type="button" className="link" onClick={() => onSelect(`element:${id}`)}>
              {el.spec.name ?? el.key}
            </button>
            {el.spec.description ? <p className="muted">{el.spec.description}</p> : null}
            <CodeRefs model={model} elementId={id} ctx={ctx} />
          </li>
        );
      })}
    </ul>
  );
}

/** The code entry point of a journey step, with links. */
export function StepCode({ step, ctx }: { step: JourneyStep; ctx: CodeContext }) {
  const code = step.spec.code;
  if (!code) return null;
  const [file] = code.split("#");
  const t = linkTarget(file ?? code, ctx.files);
  return (
    <span className="step-code">
      <code>{code}</code> <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} />
    </span>
  );
}

function hostName(url: string | undefined): string {
  if (!url) return "Web";
  const host = new URL(url).hostname;
  if (host.includes("github")) return "GitHub";
  if (host.includes("gitlab")) return "GitLab";
  if (host.includes("bitbucket")) return "Bitbucket";
  return host;
}
