import type { CodeIndex, EntryPoint, IndexedSource, Model } from "@archdoc/core";
import { isVerificationCode, locate } from "@archdoc/core";
import ts from "typescript";
import type { AnalyzerContext } from "./api.js";
import { type IacFindings, readIac } from "./iac.js";
import { indexCode } from "./symbols.js";

// Where flows start, and the calls each one makes: names, files, and lines
// only, so an agent can pick the paths worth reading instead of grepping for
// them. Read syntactically, without type-checking: a call through a value
// the reader can't follow is shown unresolved, never guessed.

/** A function on a call path. */
export interface PathNode {
  name: string;
  file: string;
  line: number;
  /** The model element its file belongs to, when there's a model. */
  element?: string | undefined;
  /** What it reaches outside the code: a datastore, queue, HTTP call, or SDK, such as `DynamoDB PutCommand`. */
  touches: string[];
  /** Calls whose target couldn't be followed, by name. */
  unresolved: string[];
  children: PathNode[];
  /** Already shown higher up this path (recursion), or cut off by the depth or size limit. */
  cut?: "repeat" | "depth" | "size" | undefined;
}

export interface EntryPath {
  entry: EntryPoint & { element?: string | undefined };
  root?: PathNode | undefined;
}

export interface PathsOptions {
  /** Only entry points whose label, file, or symbol contains this. */
  entry?: string | undefined;
  /** How deep to follow calls. Default 5. */
  depth?: number | undefined;
  /** At most this many functions per tree. Default 40. */
  size?: number | undefined;
  /** The model, to say which element each function is in. */
  model?: Model | undefined;
  /** Entry points already found (by init), to skip reading the IaC again. */
  iac?: IacFindings[] | undefined;
}

/** Kinds of entry point that start a flow a journey should follow. */
export const FLOW_KINDS = new Set(["route", "consumer", "schedule", "command", "page"]);

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go)$/;
const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|\.git|\.archdoc|coverage|cdk\.out)\//;

/** Every entry point in the repository, from IaC, routes, consumers, CLIs, and manifests. */
export async function findEntryPoints(
  ctx: AnalyzerContext,
  iac?: IacFindings[],
): Promise<EntryPoint[]> {
  const out: EntryPoint[] = [];
  const seen = new Set<string>();
  const push = (e: EntryPoint) => {
    const k = `${e.kind} ${e.label} ${e.file}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  const findings = iac ?? (await readIac(ctx).catch((): IacFindings[] => []));
  for (const f of findings) {
    const queue = (id: string) => f.queues.find((q) => q.id === id)?.name ?? id;
    for (const t of f.triggers) {
      const fn = f.functions.find((x) => x.id === t.function);
      if (!fn?.handler) continue;
      push({
        kind: t.kind,
        label: t.kind === "consumer" ? `consumes ${queue(t.queue ?? t.label)}` : t.label,
        file: fn.handler,
        symbol: fn.symbol,
      });
    }
  }
  const iacFiles = new Set(findings.flatMap((f) => f.files));
  for (const file of ctx.files) {
    if (SKIP.test(file) || isVerificationCode(file) || iacFiles.has(file)) continue;
    if (/(^|\/)(k8s|kubernetes|manifests|deploy|charts?|helm)\/.*\.ya?ml$/.test(file)) {
      const text = await ctx.read(file).catch(() => "");
      for (const m of text.matchAll(/kind:\s*CronJob[\s\S]*?\n\s*schedule:\s*["']?([^"'\n]+)/g)) {
        const name = /name:\s*([\w.-]+)/.exec(text)?.[1];
        push({
          kind: "schedule",
          label: `${(m[1] as string).trim()}${name ? ` (${name})` : ""}`,
          file,
        });
      }
      continue;
    }
    if (!SOURCE.test(file)) continue;
    // Next.js: app/**/route.ts and pages/api/**.
    const next = /(^|\/)app\/(.*\/)?route\.[jt]sx?$/.exec(file);
    const text = await ctx.read(file).catch(() => "");
    if (!text) continue;
    const lineOf = (i: number) => text.slice(0, i).split("\n").length;
    if (next) {
      const route = `/${(next[2] ?? "").replace(/\/$/, "")}`;
      for (const m of text.matchAll(
        /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
      )) {
        push({
          kind: "route",
          label: `${m[1]} ${route}`,
          file,
          symbol: m[1],
          line: lineOf(m.index ?? 0),
        });
      }
      continue;
    }
    if (/(^|\/)pages\/api\/.+\.[jt]sx?$/.test(file)) {
      push({
        kind: "route",
        label: `/${file
          .replace(/^.*pages\//, "")
          .replace(/\.[jt]sx?$/, "")
          .replace(/\/index$/, "")}`,
        file,
        symbol: "default",
      });
      continue;
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      // Express, Fastify, Koa, Hono routers: app.get("/x", handler).
      for (const m of text.matchAll(
        /\b(\w+(?:\(\))?)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]\s*,\s*(?:[\w.]+\s*,\s*)*([\w.]+)?/g,
      )) {
        if (
          !/^(app|router|Router\(\)|server|api|fastify|r|routes?|\w+Router|\w+Routes)$/i.test(
            m[1] as string,
          )
        )
          continue;
        push({
          kind: "route",
          label: `${(m[2] as string).toUpperCase()} ${m[3]}`,
          file,
          symbol: m[4] && !/^(async|req|function)$/.test(m[4]) ? m[4] : undefined,
          line: lineOf(m.index ?? 0),
        });
      }
      // NestJS: @Controller("x") with @Get("y").
      const controller = /@Controller\(\s*["'`]?([^"'`)]*)["'`]?\s*\)/.exec(text)?.[1];
      if (controller !== undefined) {
        for (const m of text.matchAll(
          /@(Get|Post|Put|Patch|Delete)\(\s*["'`]?([^"'`)]*)["'`]?\s*\)\s*(?:@\w+\([^)]*\)\s*)*(?:async\s+)?(\w+)\s*\(/g,
        )) {
          push({
            kind: "route",
            label:
              `${(m[1] as string).toUpperCase()} /${[controller, m[2]].filter(Boolean).join("/")}`.replace(
                /\/+/g,
                "/",
              ),
            file,
            symbol: m[3],
            line: lineOf(m.index ?? 0),
          });
        }
      }
      // Commander, yargs: .command("name"), new Command("name")...action(fn).
      for (const m of text.matchAll(/\.command\(\s*["'`]([\w:-]+)/g)) {
        push({ kind: "command", label: m[1] as string, file, line: lineOf(m.index ?? 0) });
      }
      for (const m of text.matchAll(
        /new Command\(\s*["'`]([\w:-]+)["'`]\s*\)[^\n;]*?\.action\(\s*([\w.]+)\s*\)/g,
      )) {
        push({
          kind: "command",
          label: m[1] as string,
          file,
          symbol: m[2],
          line: lineOf(m.index ?? 0),
        });
      }
      // Queue consumers: amqplib, NATS, Kafka, SQS pollers.
      for (const m of text.matchAll(/\.(consume|subscribe)\(\s*["'`]([\w.:/-]+)["'`]/g)) {
        push({ kind: "consumer", label: `consumes ${m[2]}`, file, line: lineOf(m.index ?? 0) });
      }
      continue;
    }
    if (file.endsWith(".py")) {
      for (const m of text.matchAll(
        /@(\w+)\.(get|post|put|patch|delete|route|api_route)\(\s*["']([^"']*)["'][^\n]*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+(\w+)/g,
      )) {
        const verb =
          m[2] === "route" || m[2] === "api_route" ? "ANY" : (m[2] as string).toUpperCase();
        push({
          kind: "route",
          label: `${verb} ${m[3] || "/"}`,
          file,
          symbol: m[4],
          line: lineOf(m.index ?? 0),
        });
      }
      for (const m of text.matchAll(
        /@(?:\w+\.)?(?:command|group)\([^)]*\)\s*\n(?:\s*@[^\n]*\n)*\s*def\s+(\w+)/g,
      )) {
        push({
          kind: "command",
          label: (m[1] as string).replace(/_/g, "-"),
          file,
          symbol: m[1],
          line: lineOf(m.index ?? 0),
        });
      }
      for (const m of text.matchAll(
        /basic_consume\(\s*(?:queue\s*=\s*)?["']([\w.-]+)["']\s*,\s*(?:on_message_callback\s*=\s*)?(\w+)?/g,
      )) {
        push({
          kind: "consumer",
          label: `consumes ${m[1]}`,
          file,
          symbol: m[2] && m[2] !== "lambda" ? m[2] : undefined,
          line: lineOf(m.index ?? 0),
        });
      }
      for (const m of text.matchAll(/@(?:\w+\.)?(?:task|shared_task)\b[^\n]*\n\s*def\s+(\w+)/g)) {
        push({
          kind: "consumer",
          label: `task ${m[1]}`,
          file,
          symbol: m[1],
          line: lineOf(m.index ?? 0),
        });
      }
      continue;
    }
    if (file.endsWith(".go")) {
      for (const m of text.matchAll(/\.(HandleFunc|Handle)\(\s*"([^"]+)"\s*,\s*([\w.]+)/g)) {
        push({
          kind: "route",
          label: m[2] as string,
          file,
          symbol: m[3],
          line: lineOf(m.index ?? 0),
        });
      }
      for (const m of text.matchAll(
        /\b\w+\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"\s*,\s*([\w.]+)/g,
      )) {
        push({
          kind: "route",
          label: `${(m[1] as string).toUpperCase()} ${m[2]}`,
          file,
          symbol: m[3],
          line: lineOf(m.index ?? 0),
        });
      }
      for (const m of text.matchAll(/\.(Subscribe|QueueSubscribe|Consume)\(\s*"([^"]+)"/g)) {
        push({ kind: "consumer", label: `consumes ${m[2]}`, file, line: lineOf(m.index ?? 0) });
      }
      for (const m of text.matchAll(/&cobra\.Command\{[^}]*?Use:\s*"([\w-]+)/g)) {
        push({ kind: "command", label: m[1] as string, file, line: lineOf(m.index ?? 0) });
      }
      if (/(^|\/)cmd\/[^/]+\/main\.go$/.test(file) && /\bfunc main\(\)/.test(text)) {
        push({
          kind: "main",
          label: file.split("/").slice(-2, -1)[0] as string,
          file,
          symbol: "main",
        });
      }
    }
  }
  return out;
}

// --- Call trees ---

interface Fn {
  name: string;
  file: string;
  line: number;
  calls: Call[];
}

interface Call {
  text: string;
  line: number;
  /** Where it goes, when it can be followed. */
  to?: { file: string; name: string } | undefined;
  /** What it reaches outside the code. */
  touches?: string | undefined;
}

/** Packages whose calls reach outside the code, and what to call them. */
const OUTSIDE: [RegExp, string][] = [
  [/^@aws-sdk\/(client-dynamodb|lib-dynamodb)$/, "DynamoDB"],
  [/^@aws-sdk\/client-sqs$/, "SQS"],
  [/^@aws-sdk\/client-sns$/, "SNS"],
  [/^@aws-sdk\/client-s3$/, "S3"],
  [/^@aws-sdk\/client-sesv?2?$/, "SES"],
  [/^@aws-sdk\/client-eventbridge$/, "EventBridge"],
  [/^@aws-sdk\/client-(\w[\w-]*)$/, "AWS"],
  [/^(pg|postgres|mysql2?|better-sqlite3|knex|kysely|drizzle-orm.*)$/, "SQL"],
  [/^@prisma\/client$/, "Prisma"],
  [/^(mongodb|mongoose)$/, "MongoDB"],
  [/^(ioredis|redis)$/, "Redis"],
  [/^amqplib$/, "RabbitMQ"],
  [/^kafkajs$/, "Kafka"],
  [/^nats$/, "NATS"],
  [/^(axios|node-fetch|got|undici|ky)$/, "HTTP"],
  [/^(nodemailer|@sendgrid\/mail|resend)$/, "email"],
  [/^stripe$/, "Stripe"],
  [/^(boto3|botocore)$/, "AWS"],
  [/^(requests|httpx|aiohttp|urllib3)$/, "HTTP"],
  [/^(sqlalchemy|psycopg2?|asyncpg|sqlite3|pymysql)(\.|$)/, "SQL"],
  [/^(redis|aioredis)$/, "Redis"],
  [/^(pika|aio_pika|kombu)$/, "RabbitMQ"],
  [/^(kafka|confluent_kafka|aiokafka)$/, "Kafka"],
  [/^(smtplib)$/, "email"],
  [/^database\/sql$|^github\.com\/(jackc\/pgx|lib\/pq|jmoiron\/sqlx)/, "SQL"],
  [/^net\/http$/, "HTTP"],
  [/^github\.com\/aws\/aws-sdk-go/, "AWS"],
  [/^github\.com\/nats-io\/nats/, "NATS"],
  [/^github\.com\/(rabbitmq\/amqp091-go|streadway\/amqp)/, "RabbitMQ"],
  [/^github\.com\/(redis|go-redis)\//, "Redis"],
  [/^github\.com\/segmentio\/kafka-go|confluent-kafka-go/, "Kafka"],
];

function outside(specifier: string): string | undefined {
  for (const [re, name] of OUTSIDE) if (re.test(specifier)) return name;
  return undefined;
}

class Reader {
  private fns = new Map<string, Fn[]>();
  private sources: Map<string, IndexedSource>;
  constructor(
    private ctx: AnalyzerContext,
    index: CodeIndex,
  ) {
    this.sources = new Map(index.sources.map((s) => [s.path, s]));
  }

  async functions(file: string): Promise<Fn[]> {
    const have = this.fns.get(file);
    if (have) return have;
    const text = await this.ctx.read(file).catch(() => "");
    const src = this.sources.get(file);
    const fns = /\.[cm]?[jt]sx?$/.test(file)
      ? tsFunctions(file, text, src)
      : file.endsWith(".py")
        ? pyFunctions(file, text, src)
        : file.endsWith(".go")
          ? goFunctions(file, text, src)
          : [];
    this.fns.set(file, fns);
    return fns;
  }

  /** A function by name in a file, or in a directory's files (a Go package, a TS index). */
  async find(file: string, name: string): Promise<Fn | undefined> {
    const files = this.ctx.files.includes(file)
      ? [file]
      : this.ctx.files.filter(
          (f) =>
            f.startsWith(`${file}/`) &&
            !f.slice(file.length + 1).includes("/") &&
            SOURCE.test(f) &&
            !isVerificationCode(f),
        );
    for (const f of files) {
      const fn = (await this.functions(f)).find(
        (x) => x.name === name || x.name.endsWith(`.${name}`),
      );
      if (fn) return fn;
    }
    // A re-export: export { x } from "./y".
    const src = this.sources.get(file);
    for (const imp of src?.imports ?? []) {
      if (!imp.reexport || !imp.target) continue;
      if (imp.names.some((n) => n.name === name || n.name === "*")) {
        const fn = imp.target !== file ? await this.find(imp.target, name) : undefined;
        if (fn) return fn;
      }
    }
    return undefined;
  }

  async tree(
    fn: Fn,
    opts: { depth: number; size: number; model?: Model | undefined },
  ): Promise<PathNode> {
    let count = 0;
    const visit = async (f: Fn, depth: number, path: Set<string>): Promise<PathNode> => {
      count++;
      const node: PathNode = {
        name: f.name,
        file: f.file,
        line: f.line,
        element: opts.model ? locate(opts.model, f.file).element?.id : undefined,
        touches: [...new Set(f.calls.flatMap((c) => (c.touches ? [c.touches] : [])))],
        unresolved: [],
        children: [],
      };
      const key = `${f.file}#${f.name}`;
      const seen = new Set<string>();
      for (const c of f.calls) {
        if (!c.to) continue;
        const k = `${c.to.file}#${c.to.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const target = await this.find(c.to.file, c.to.name);
        if (!target) {
          node.unresolved.push(c.text);
          continue;
        }
        const tk = `${target.file}#${target.name}`;
        if (path.has(tk) || tk === key) {
          node.children.push({ ...leaf(target, opts.model), cut: "repeat" });
        } else if (depth >= opts.depth) {
          node.children.push({ ...leaf(target, opts.model), cut: "depth" });
        } else if (count >= opts.size) {
          node.children.push({ ...leaf(target, opts.model), cut: "size" });
        } else {
          node.children.push(await visit(target, depth + 1, new Set([...path, key])));
        }
      }
      return node;
    };
    return visit(fn, 1, new Set());
  }
}

function leaf(f: Fn, model?: Model): PathNode {
  return {
    name: f.name,
    file: f.file,
    line: f.line,
    element: model ? locate(model, f.file).element?.id : undefined,
    touches: [],
    unresolved: [],
    children: [],
  };
}

/** Local name → where it's imported from, from the code index. */
function importsOf(src: IndexedSource | undefined) {
  const out = new Map<string, { target?: string | undefined; specifier: string; name: string }>();
  for (const imp of src?.imports ?? []) {
    if (imp.typeOnly) continue;
    for (const n of imp.names) {
      out.set(n.local ?? n.name, { target: imp.target, specifier: imp.specifier, name: n.name });
    }
  }
  return out;
}

function tsFunctions(file: string, text: string, src: IndexedSource | undefined): Fn[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = importsOf(src);
  // Imported constructors' packages, so `db.send(new PutCommand(...))` says DynamoDB PutCommand.
  const fns: Fn[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const locals = new Set<string>();
  const clients = new Map<string, string>();
  sf.forEachChild(function top(n): void {
    if (ts.isFunctionDeclaration(n) && n.name) locals.add(n.name.text);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          locals.add(d.name.text);
        // const db = DynamoDBDocumentClient.from(new DynamoDBClient({})): calls on db reach DynamoDB.
        const pkg = [...d.initializer.getText().matchAll(/\b([A-Z]\w*|\w+)\b/g)]
          .map((m) => imports.get(m[1] as string)?.specifier)
          .map((s) => (s ? outside(s) : undefined))
          .find(Boolean);
        if (pkg) clients.set(d.name.text, pkg);
      }
    }
  });
  const callsIn = (nodes: readonly ts.Node[], cls?: string): Call[] => {
    const calls: Call[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        const e = n.expression;
        const line = lineOf(n);
        const text = e.getText(sf).replace(/\s+/g, "");
        let to: Call["to"];
        let touches: string | undefined;
        if (ts.isIdentifier(e)) {
          const imp = imports.get(e.text);
          if (imp?.target)
            to = { file: imp.target, name: imp.name === "default" ? e.text : imp.name };
          else if (imp)
            touches =
              outside(imp.specifier) &&
              (ts.isNewExpression(n)
                ? `${outside(imp.specifier)} ${e.text}`
                : `${outside(imp.specifier)} ${e.text}()`);
          else if (locals.has(e.text)) to = { file, name: e.text };
          else if (e.text === "fetch") touches = `HTTP fetch ${urlOf(n, sf)}`.trim();
        } else if (ts.isPropertyAccessExpression(e)) {
          const root = rootIdent(e);
          if (e.expression.kind === ts.SyntaxKind.ThisKeyword && cls) {
            to = { file, name: `${cls}.${e.name.text}` };
          } else if (root) {
            const imp = imports.get(root);
            if (imp?.target && ts.isIdentifier(e.expression))
              to = { file: imp.target, name: e.name.text };
            else if (imp && outside(imp.specifier)) touches = `${outside(imp.specifier)} ${text}()`;
            else if (clients.has(root)) touches = `${clients.get(root)} ${text}()`;
          }
        }
        // db.send(new PutCommand(...)) reads better as the command than as send.
        if (ts.isCallExpression(n) && touches && /\.send$/.test(text)) {
          const cmd = n.arguments[0];
          if (cmd && ts.isNewExpression(cmd))
            touches = `${touches.split(" ")[0]} ${cmd.expression.getText(sf)}`;
        }
        if (to || touches) calls.push({ text, line, to, touches });
        else if (
          ts.isCallExpression(n) &&
          (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) &&
          !/^(console|JSON|Math|Object|Array|Promise|String|Number|Date|process)\b/.test(text)
        ) {
          calls.push({ text, line });
        }
      }
      // A function made inside is part of this one: its calls are this one's.
      n.forEachChild(visit);
    };
    for (const n of nodes) n.forEachChild(visit);
    // new X inside a .send() was counted with the send; leave the bare constructor out.
    return calls.filter(
      (c, i) =>
        !(
          c.touches &&
          calls.some((o, j) => j !== i && o.line === c.line && o.touches?.endsWith(c.text))
        ),
    );
  };
  const add = (name: string, node: ts.Node, body: ts.Node | undefined, cls?: string) => {
    if (body) fns.push({ name, file, line: lineOf(node), calls: callsIn([body], cls) });
  };
  sf.forEachChild(function walk(n): void {
    if (ts.isFunctionDeclaration(n) && n.name) add(n.name.text, n, n.body);
    else if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          add(d.name.text, d, d.initializer.body);
        }
      }
    } else if (ts.isClassDeclaration(n) && n.name) {
      const cls = n.name.text;
      for (const m of n.members) {
        if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) && m.body) {
          const name = ts.isConstructorDeclaration(m) ? "constructor" : m.name.getText(sf);
          add(`${cls}.${name}`, m, m.body, cls);
        } else if (
          ts.isPropertyDeclaration(m) &&
          m.initializer &&
          ts.isArrowFunction(m.initializer)
        ) {
          add(`${cls}.${m.name.getText(sf)}`, m, m.initializer.body, cls);
        }
      }
    }
    if (ts.isExpressionStatement(n) || ts.isVariableStatement(n) || ts.isExportAssignment(n)) {
      // Handlers passed inline, such as router.post("/", async (req, res) => ...): each is a
      // function of its own, at the line of the call that registers it.
      const inline = (x: ts.Node): void => {
        if (ts.isCallExpression(x)) {
          for (const a of x.arguments) {
            if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) {
              const callee =
                x.expression.getText(sf).replace(/\s+/g, "").split(".").pop() ?? "handler";
              add(`${callee}:${lineOf(x)}`, x, a.body);
            }
          }
        }
        x.forEachChild(inline);
      };
      inline(n);
    }
    if (ts.isExportAssignment(n)) {
      const e = n.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) add("default", n, e.body);
    }
  });
  // Calls at the top of the file (routes registered with inline handlers) as the module itself.
  const top = callsIn(
    sf.statements.filter((s) => !ts.isFunctionDeclaration(s) && !ts.isClassDeclaration(s)),
  );
  if (top.length) fns.push({ name: "(module)", file, line: 1, calls: top });
  return fns;
}

function rootIdent(e: ts.Expression): string | undefined {
  let x: ts.Expression = e;
  while (
    ts.isPropertyAccessExpression(x) ||
    ts.isCallExpression(x) ||
    ts.isElementAccessExpression(x)
  )
    x = x.expression;
  return ts.isIdentifier(x) ? x.text : undefined;
}

function urlOf(n: ts.CallExpression | ts.NewExpression, sf: ts.SourceFile): string {
  const a = n.arguments?.[0];
  return a ? a.getText(sf).slice(0, 60) : "";
}

const PY_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "return",
  "print",
  "len",
  "str",
  "int",
  "dict",
  "list",
  "set",
  "tuple",
  "isinstance",
  "range",
  "super",
  "not",
  "and",
  "or",
  "in",
  "with",
  "lambda",
  "yield",
  "await",
  "elif",
  "except",
  "assert",
  "raise",
  "type",
  "getattr",
  "setattr",
  "hasattr",
  "enumerate",
  "zip",
  "sorted",
  "min",
  "max",
  "sum",
  "any",
  "all",
  "open",
  "float",
  "bool",
]);

function pyFunctions(file: string, text: string, src: IndexedSource | undefined): Fn[] {
  const imports = importsOf(src);
  const lines = text.split("\n");
  const fns: Fn[] = [];
  const defs: { name: string; indent: number; start: number; cls?: string | undefined }[] = [];
  let cls: { name: string; indent: number } | undefined;
  lines.forEach((l, i) => {
    const c = /^(\s*)class\s+(\w+)/.exec(l);
    if (c) cls = { name: c[2] as string, indent: (c[1] as string).length };
    const d = /^(\s*)(?:async\s+)?def\s+(\w+)/.exec(l);
    if (!d) return;
    const indent = (d[1] as string).length;
    const inClass = cls && indent > cls.indent ? cls.name : undefined;
    if (cls && indent <= cls.indent) cls = undefined;
    defs.push({
      name: inClass ? `${inClass}.${d[2]}` : (d[2] as string),
      indent,
      start: i,
      cls: inClass,
    });
  });
  const names = new Set(defs.map((d) => d.name));
  for (const d of defs) {
    let end = d.start + 1;
    while (end < lines.length) {
      const l = lines[end] as string;
      if (l.trim() && l.length - l.trimStart().length <= d.indent) break;
      end++;
    }
    const calls: Call[] = [];
    for (let i = d.start + 1; i < end; i++) {
      for (const m of (lines[i] as string).matchAll(/\b([A-Za-z_][\w.]*)\s*\(/g)) {
        const t = m[1] as string;
        if (PY_KEYWORDS.has(t)) continue;
        const [head, ...rest] = t.split(".");
        let to: Call["to"];
        let touches: string | undefined;
        if (head === "self" && d.cls && rest.length === 1)
          to = { file, name: `${d.cls}.${rest[0]}` };
        else if (!rest.length && names.has(t)) to = { file, name: t };
        else {
          const imp = imports.get(head as string);
          if (imp?.target)
            to = {
              file: imp.target,
              name: rest.length ? (rest[rest.length - 1] as string) : imp.name,
            };
          else if (imp && outside(imp.specifier)) touches = `${outside(imp.specifier)} ${t}()`;
        }
        calls.push({ text: t, line: i + 1, to, touches });
      }
    }
    fns.push({ name: d.name, file, line: d.start + 1, calls });
  }
  return fns;
}

function goFunctions(file: string, text: string, src: IndexedSource | undefined): Fn[] {
  const imports = importsOf(src);
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const fns: Fn[] = [];
  for (const m of text.matchAll(/^func\s+(?:\(\s*\w*\s*\*?(\w+)[^)]*\)\s*)?(\w+)\s*\(/gm)) {
    const open = text.indexOf("{", (m.index ?? 0) + m[0].length);
    if (open < 0) continue;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    const body = text.slice(open, end);
    const startLine = text.slice(0, m.index ?? 0).split("\n").length;
    const bodyLine = text.slice(0, open).split("\n").length;
    const calls: Call[] = [];
    for (const c of body.matchAll(/\b([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)?)\s*\(/g)) {
      const t = c[1] as string;
      if (
        /^(if|for|switch|func|return|make|len|append|new|panic|cap|copy|delete|string|int|byte|error)$/.test(
          t,
        )
      )
        continue;
      const line = bodyLine + body.slice(0, c.index ?? 0).split("\n").length - 1;
      const [head, name] = t.split(".");
      let to: Call["to"];
      let touches: string | undefined;
      if (!name) to = { file: dir || ".", name: head as string };
      else {
        const imp = [...imports.entries()].find(([local]) => local === head)?.[1];
        if (imp?.target) to = { file: imp.target, name };
        else if (imp && outside(imp.specifier)) touches = `${outside(imp.specifier)} ${t}()`;
      }
      calls.push({ text: t, line, to, touches });
    }
    const recv = m[1];
    fns.push({ name: recv ? `${recv}.${m[2]}` : (m[2] as string), file, line: startLine, calls });
  }
  return fns;
}

/** The entry points, and for each (or the ones `entry` names) the calls it makes. */
export async function findPaths(
  ctx: AnalyzerContext,
  options: PathsOptions = {},
): Promise<{ entryPoints: EntryPath["entry"][]; paths: EntryPath[] }> {
  const index = await indexCode(ctx).catch(
    (): CodeIndex => ({ files: [...ctx.files], sources: [] }),
  );
  const entries = (await findEntryPoints(ctx, options.iac)).map((e) => ({
    ...e,
    element: options.model ? locate(options.model, e.file).element?.id : undefined,
  }));
  const reader = new Reader(ctx, index);
  const want = options.entry?.toLowerCase();
  const chosen = want
    ? entries.filter((e) =>
        `${e.kind} ${e.label} ${e.file} ${e.symbol ?? ""}`.toLowerCase().includes(want),
      )
    : entries;
  const paths: EntryPath[] = [];
  const sources = new Map(index.sources.map((s) => [s.path, s]));
  for (const entry of chosen) {
    const fns = await reader.functions(entry.file);
    // A handler from another file: postings.Handler, or an imported name.
    let imported: Fn | undefined;
    if (entry.symbol && !fns.some((f) => f.name === entry.symbol)) {
      const [head, name] = entry.symbol.includes(".")
        ? (entry.symbol.split(".") as [string, string])
        : [entry.symbol, undefined];
      const imp = importsOf(sources.get(entry.file)).get(head);
      if (imp?.target)
        imported = await reader.find(
          imp.target,
          name ?? (imp.name === "default" ? head : imp.name),
        );
    }
    const fn =
      imported ||
      (entry.symbol &&
        fns.find((f) => f.name === entry.symbol || f.name.endsWith(`.${entry.symbol}`))) ||
      (entry.line &&
        [...fns]
          .filter((f) => f.line <= (entry.line as number))
          .sort((a, b) => b.line - a.line)[0]) ||
      fns.find((f) => f.name === "(module)") ||
      fns[0];
    const root = fn
      ? await reader.tree(fn, {
          depth: options.depth ?? 5,
          size: options.size ?? 40,
          model: options.model,
        })
      : undefined;
    paths.push({ entry, root });
  }
  return { entryPoints: entries, paths };
}

/** The entry points and call paths as text: what `archdoc paths` prints and archdoc_paths answers. */
export function formatPaths(
  r: { entryPoints: EntryPath["entry"][]; paths: EntryPath[] },
  all = false,
): string {
  const out: string[] = [];
  const where = (e: { file: string; symbol?: string | undefined; line?: number | undefined }) =>
    `${e.file}${e.symbol ? `#${e.symbol}` : e.line ? `:${e.line}` : ""}`;
  if (!r.entryPoints.length && !r.paths.length) {
    return "No entry points found: no IaC triggers, routes, consumers, CLI commands, or CronJobs this reader knows. Search for how the system is started (main functions, framework registrations) instead.";
  }
  if (r.entryPoints.length && (all || r.paths.length !== 1)) {
    out.push(
      `${r.entryPoints.length} entry point${r.entryPoints.length === 1 ? "" : "s"}, where flows start:`,
    );
    const width = Math.min(40, Math.max(...r.entryPoints.map((e) => e.label.length)));
    for (const e of r.entryPoints) {
      out.push(
        `  ${e.kind.padEnd(8)} ${e.label.padEnd(width)}  ${where(e)}${e.element ? `  (${e.element})` : ""}`,
      );
    }
    out.push("");
  }
  for (const p of r.paths) {
    out.push(`${p.entry.kind} ${p.entry.label} → ${where(p.entry)}`);
    if (!p.root) {
      out.push("  (no function found to start from)", "");
      continue;
    }
    const draw = (n: PathNode, indent: string) => {
      const loc = `${n.file}:${n.line}`;
      out.push(
        `${indent}${n.name}  ${loc}${n.element ? `  [${n.element}]` : ""}${n.cut === "repeat" ? "  (repeats)" : n.cut ? "  (…)" : ""}`,
      );
      for (const t of n.touches) out.push(`${indent}  → ${t}`);
      for (const c of n.children) draw(c, `${indent}  `);
    };
    draw(p.root, "  ");
    out.push("");
  }
  if (r.paths.length > 1 && !all) {
    out.push(
      "Each tree shows functions by name, file, and line, and → what they reach outside the code. Pass entry to see one, and read only the files on the path you need.",
    );
  }
  return out.join("\n").trimEnd();
}
