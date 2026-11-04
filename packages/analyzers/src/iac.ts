import { posix } from "node:path";
import ts from "typescript";
import type { AnalyzerContext } from "./api.js";
import { type HclBlock, hclReferences, hclString, parseHcl } from "./hcl.js";

// What infrastructure as code declares: the tables (with their keys), queues
// and topics, functions (with the handler file each runs), what each function
// is granted, and the events that start them (routes, queues, schedules).
// Read from Terraform and AWS CDK apps, literally: a value the code computes
// is left unknown, never guessed. Deterministic, no network.

export type IacAccess = "read" | "write" | "readwrite" | "send" | "consume" | "publish" | "call";

export interface IacTable {
  id: string;
  name?: string | undefined;
  technology: string;
  file: string;
  line?: number | undefined;
  /** Key attributes, with their types (string, number, bytes) when known. */
  keys: { name: string; type?: string | undefined; role: "partition" | "sort" }[];
  /** Other attributes the IaC declares (indexes' keys). */
  attributes: { name: string; type?: string | undefined }[];
  indexes: string[];
}

export interface IacQueue {
  id: string;
  name?: string | undefined;
  kind: "queue" | "topic" | "bus" | "stream";
  technology: string;
  file: string;
  line?: number | undefined;
}

export interface IacFunction {
  id: string;
  name?: string | undefined;
  technology: string;
  file: string;
  line?: number | undefined;
  /** The repository file its handler is in, when it can be found. */
  handler?: string | undefined;
  /** The handler function's name, such as `handler`. */
  symbol?: string | undefined;
  /** Tables, queues, and services it's granted, by id (`ses` for Amazon SES and the like). */
  uses: { to: string; access: IacAccess }[];
}

/** Where a function is started: an HTTP route, a queue it consumes, a schedule. */
export interface IacTrigger {
  kind: "route" | "consumer" | "schedule";
  /** `POST /bookings`, the queue's id, or the schedule's expression. */
  label: string;
  function: string;
  /** The queue a consumer reads. */
  queue?: string | undefined;
  file: string;
  line?: number | undefined;
}

/** A managed service the functions call that the IaC doesn't create, such as Amazon SES. */
export interface IacService {
  id: string;
  technology: string;
}

/** A deployment the IaC defines: a CDK stack instance, or a Terraform root or environment. */
export interface IacEnvironment {
  id: string;
  name?: string | undefined;
  region?: string | undefined;
  account?: string | undefined;
  /** The IaC files that define it. */
  code: string[];
}

export interface IacFindings {
  tool: "terraform" | "cdk";
  /** The directory the IaC lives in, and its files. */
  dir: string;
  files: string[];
  tables: IacTable[];
  queues: IacQueue[];
  functions: IacFunction[];
  triggers: IacTrigger[];
  services: IacService[];
  environments: IacEnvironment[];
  buckets: { id: string; name?: string | undefined; website: boolean; file: string }[];
}

/** Services the functions reach by IAM action or SDK client, which the IaC needn't create. */
const SERVICES: Record<string, string> = {
  ses: "Amazon SES",
  sesv2: "Amazon SES",
  sns: "Amazon SNS",
  "bedrock-runtime": "Amazon Bedrock",
  bedrock: "Amazon Bedrock",
  secretsmanager: "AWS Secrets Manager",
  textract: "Amazon Textract",
  comprehend: "Amazon Comprehend",
  cognito: "Amazon Cognito",
  "cognito-idp": "Amazon Cognito",
};

const SKIP = /(^|\/)(node_modules|\.terraform|cdk\.out|dist|build|\.git)\//;

/** Every Terraform configuration and CDK app in the repository, read. */
export async function readIac(ctx: AnalyzerContext): Promise<IacFindings[]> {
  const out: IacFindings[] = [];
  const tfDirs = [
    ...new Set(ctx.files.filter((f) => f.endsWith(".tf") && !SKIP.test(f)).map(dirOf)),
  ];
  // A module a root calls is read with the root that calls it, as one configuration.
  const roots = tfDirs.filter((d) => !tfDirs.some((o) => o !== d && d.startsWith(`${o}/modules/`)));
  for (const dir of roots) out.push(await readTerraform(ctx, dir, tfDirs));
  for (const cdk of ctx.files.filter((f) => /(^|\/)cdk\.json$/.test(f) && !SKIP.test(f))) {
    out.push(await readCdk(ctx, dirOf(cdk)));
  }
  return out.filter(
    (f) => f.tables.length || f.queues.length || f.functions.length || f.environments.length,
  );
}

/** Whether a file is part of a CDK app or Terraform configuration that readIac read. */
export function iacFilesOf(findings: readonly IacFindings[]): Set<string> {
  return new Set(findings.flatMap((f) => f.files));
}

// --- Terraform ---

const TF_TYPE: Record<string, string> = { S: "string", N: "number", B: "bytes" };

async function readTerraform(
  ctx: AnalyzerContext,
  dir: string,
  allDirs: string[],
): Promise<IacFindings> {
  const dirs = [dir, ...allDirs.filter((d) => d.startsWith(`${dir}/modules/`))];
  const files = ctx.files.filter((f) => f.endsWith(".tf") && dirs.includes(dirOf(f)));
  const blocks: (HclBlock & { file: string })[] = [];
  for (const f of files) {
    const text = await ctx.read(f).catch(() => "");
    for (const b of parseHcl(text)) blocks.push({ ...b, file: f });
  }
  const resources = blocks.filter((b) => b.type === "resource" && b.labels.length === 2);
  const of = (type: string) => resources.filter((b) => b.labels[0] === type);
  const id = (b: HclBlock) => `${b.labels[0]}.${b.labels[1]}`;
  const found: IacFindings = {
    tool: "terraform",
    dir,
    files: [
      ...files,
      ...ctx.files.filter((f) => f.endsWith(".tfvars") && dirs.some((d) => f.startsWith(`${d}/`))),
    ],
    tables: [],
    queues: [],
    functions: [],
    triggers: [],
    services: [],
    environments: [],
    buckets: [],
  };

  for (const b of of("aws_dynamodb_table")) {
    const types = new Map(
      b.blocks
        .filter((x) => x.type === "attribute")
        .map((x) => [hclString(x.attrs.name) ?? "", TF_TYPE[hclString(x.attrs.type) ?? ""]]),
    );
    const hash = hclString(b.attrs.hash_key);
    const range = hclString(b.attrs.range_key);
    const keys: IacTable["keys"] = [];
    if (hash) keys.push({ name: hash, type: types.get(hash), role: "partition" });
    if (range) keys.push({ name: range, type: types.get(range), role: "sort" });
    found.tables.push({
      id: id(b),
      name: hclString(b.attrs.name),
      technology: "Amazon DynamoDB",
      file: b.file,
      line: b.line,
      keys,
      attributes: [...types]
        .filter(([n]) => n && !keys.some((k) => k.name === n))
        .map(([name, type]) => ({ name, type })),
      indexes: b.blocks
        .filter((x) => /secondary_index$/.test(x.type))
        .flatMap((x) => hclString(x.attrs.name) ?? []),
    });
  }
  for (const b of [...of("aws_db_instance"), ...of("aws_rds_cluster")]) {
    const engine = hclString(b.attrs.engine) ?? "";
    found.tables.push({
      id: id(b),
      name: hclString(b.attrs.db_name ?? b.attrs.identifier ?? b.attrs.cluster_identifier),
      technology: /postgres/.test(engine)
        ? "Amazon RDS for PostgreSQL"
        : /mysql|maria/.test(engine)
          ? "Amazon RDS for MySQL"
          : "Amazon RDS",
      file: b.file,
      line: b.line,
      keys: [],
      attributes: [],
      indexes: [],
    });
  }
  const queueTypes: [string, IacQueue["kind"], string][] = [
    ["aws_sqs_queue", "queue", "Amazon SQS"],
    ["aws_sns_topic", "topic", "Amazon SNS"],
    ["aws_cloudwatch_event_bus", "bus", "Amazon EventBridge"],
    ["aws_kinesis_stream", "stream", "Amazon Kinesis"],
  ];
  for (const [type, kind, technology] of queueTypes) {
    for (const b of of(type)) {
      found.queues.push({
        id: id(b),
        name: hclString(b.attrs.name),
        kind,
        technology,
        file: b.file,
        line: b.line,
      });
    }
  }
  for (const b of of("aws_s3_bucket")) {
    found.buckets.push({
      id: id(b),
      name: hclString(b.attrs.bucket),
      website: of("aws_s3_bucket_website_configuration").some((w) =>
        hclReferences(w.attrs.bucket ?? "").some((r) => `${r.type}.${r.name}` === id(b)),
      ),
      file: b.file,
    });
  }

  // Functions, and the files their handlers are in.
  const archives = new Map(
    blocks
      .filter((b) => b.type === "data" && b.labels[0] === "archive_file")
      .map((b) => [
        `data.archive_file.${b.labels[1]}`,
        tfPath(b.file, hclString(b.attrs.source_dir) ?? hclString(b.attrs.source_file)),
      ]),
  );
  const lambdas = of("aws_lambda_function");
  for (const b of lambdas) {
    const handlerAttr = hclString(b.attrs.handler);
    const refs = hclReferences(`${b.attrs.filename ?? ""} ${b.attrs.source_code_hash ?? ""}`);
    const archive = refs.map((r) => archives.get(`${r.type}.${r.name}`)).find(Boolean);
    const source = archive ?? tfPath(b.file, hclString(b.attrs.filename));
    const handler = handlerFile(ctx.files, source, handlerAttr);
    found.functions.push({
      id: id(b),
      name: hclString(b.attrs.function_name),
      technology: lambdaTech(hclString(b.attrs.runtime)),
      file: b.file,
      line: b.line,
      handler,
      symbol: handlerAttr?.split(".").pop(),
      uses: [],
    });
  }
  // terraform-aws-modules/lambda: source_path and handler.
  for (const b of blocks.filter(
    (b) => b.type === "module" && /lambda/.test(hclString(b.attrs.source) ?? ""),
  )) {
    const handlerAttr = hclString(b.attrs.handler);
    const source = tfPath(b.file, hclString(b.attrs.source_path));
    found.functions.push({
      id: `module.${b.labels[0]}`,
      name: hclString(b.attrs.function_name),
      technology: lambdaTech(hclString(b.attrs.runtime)),
      file: b.file,
      line: b.line,
      handler: handlerFile(ctx.files, source, handlerAttr),
      symbol: handlerAttr?.split(".").pop(),
      uses: [],
    });
  }
  const fnOf = (text: string) =>
    hclReferences(text)
      .map((r) => (r.type === "module" ? `module.${r.name}` : `${r.type}.${r.name}`))
      .find((x) => found.functions.some((f) => f.id === x));
  const known = new Set([...found.tables, ...found.queues].map((x) => x.id));

  // What each function is granted: the policies on its role.
  const roleOf = (fn: IacFunction) => {
    const b = resources.find((r) => id(r) === fn.id);
    return hclReferences(b?.attrs.role ?? "").find((r) => r.type === "aws_iam_role")?.name;
  };
  const policyText = (role: string) => {
    const texts: string[] = [];
    for (const p of [...of("aws_iam_role_policy"), ...of("aws_iam_role_policy_attachment")]) {
      if (
        !hclReferences(p.attrs.role ?? "").some((r) => r.type === "aws_iam_role" && r.name === role)
      )
        continue;
      texts.push(p.text);
      // An attachment's policy, and the policy documents either names.
      for (const r of hclReferences(p.text)) {
        const doc = blocks.find(
          (x) =>
            (x.type === "resource" || x.type === "data") &&
            `${x.type === "data" ? "data." : ""}${x.labels[0]}` === r.type &&
            x.labels[1] === r.name,
        );
        if (doc) texts.push(doc.text);
      }
    }
    return texts.join("\n");
  };
  for (const fn of found.functions) {
    const role = roleOf(fn);
    let text = role ? policyText(role) : "";
    if (!text) {
      // No policy to read: what its environment points at.
      const b = resources.find((r) => id(r) === fn.id);
      text = b ? b.text + resolveLocals(blocks, b.text) : "";
    }
    fn.uses = grants(text, known);
  }

  // What starts each function.
  for (const m of of("aws_lambda_event_source_mapping")) {
    const fn = fnOf(m.attrs.function_name ?? "");
    const queue = hclReferences(m.attrs.event_source_arn ?? "")
      .map((r) => `${r.type}.${r.name}`)
      .find((q) => known.has(q));
    if (!fn || !queue) continue;
    found.triggers.push({
      kind: "consumer",
      label: queue,
      function: fn,
      queue,
      file: m.file,
      line: m.line,
    });
    addUse(found, fn, queue, "consume");
  }
  for (const s of of("aws_sns_topic_subscription")) {
    const fn = fnOf(s.attrs.endpoint ?? "");
    const topic = hclReferences(s.attrs.topic_arn ?? "")
      .map((r) => `${r.type}.${r.name}`)
      .find((q) => known.has(q));
    if (fn && topic) {
      found.triggers.push({
        kind: "consumer",
        label: topic,
        function: fn,
        queue: topic,
        file: s.file,
        line: s.line,
      });
      addUse(found, fn, topic, "consume");
    }
  }
  for (const t of of("aws_cloudwatch_event_target")) {
    const fn = fnOf(t.attrs.arn ?? "");
    const rule = hclReferences(t.attrs.rule ?? "").find(
      (r) => r.type === "aws_cloudwatch_event_rule",
    );
    const ruleBlock =
      rule && of("aws_cloudwatch_event_rule").find((r) => r.labels[1] === rule.name);
    const schedule = hclString(ruleBlock?.attrs.schedule_expression);
    if (fn && schedule) {
      found.triggers.push({
        kind: "schedule",
        label: schedule,
        function: fn,
        file: t.file,
        line: t.line,
      });
    }
  }
  for (const s of of("aws_scheduler_schedule")) {
    const target = s.blocks.find((x) => x.type === "target");
    const fn = fnOf(target?.attrs.arn ?? "");
    const schedule = hclString(s.attrs.schedule_expression);
    if (fn && schedule) {
      found.triggers.push({
        kind: "schedule",
        label: schedule,
        function: fn,
        file: s.file,
        line: s.line,
      });
    }
  }
  // API Gateway v2 routes: route → integration → function.
  for (const r of of("aws_apigatewayv2_route")) {
    const key = hclString(r.attrs.route_key);
    const integration = hclReferences(r.attrs.target ?? "").find(
      (x) => x.type === "aws_apigatewayv2_integration",
    );
    const ib =
      integration &&
      of("aws_apigatewayv2_integration").find((x) => x.labels[1] === integration.name);
    const fn = ib && fnOf(ib.attrs.integration_uri ?? "");
    if (key && fn)
      found.triggers.push({ kind: "route", label: key, function: fn, file: r.file, line: r.line });
  }
  // API Gateway v1: integration → method and resource path → function.
  for (const ib of of("aws_api_gateway_integration")) {
    const fn = fnOf(ib.attrs.uri ?? "");
    if (!fn) continue;
    const method =
      hclString(ib.attrs.http_method) ??
      hclString(
        of("aws_api_gateway_method").find((m) =>
          hclReferences(ib.attrs.http_method ?? "").some((x) => x.name === m.labels[1]),
        )?.attrs.http_method,
      ) ??
      "ANY";
    const resource = hclReferences(ib.attrs.resource_id ?? "").find(
      (x) => x.type === "aws_api_gateway_resource",
    );
    const path = resource ? v1Path(of("aws_api_gateway_resource"), resource.name) : "/";
    found.triggers.push({
      kind: "route",
      label: `${method} ${path}`,
      function: fn,
      file: ib.file,
      line: ib.line,
    });
  }

  // Services the functions call that Terraform doesn't create.
  for (const fn of found.functions) {
    for (const u of fn.uses) {
      if (SERVICES[u.to] && !found.services.some((s) => s.id === u.to)) {
        found.services.push({ id: u.to, technology: SERVICES[u.to] as string });
      }
    }
  }

  // Environments: one per tfvars file or environments/ directory, else the configuration's own.
  const region =
    hclString(blocks.find((b) => b.type === "provider" && b.labels[0] === "aws")?.attrs.region) ??
    hclString(blocks.find((b) => b.type === "variable" && b.labels[0] === "region")?.attrs.default);
  const varFiles = found.files.filter((f) => f.endsWith(".tfvars"));
  const envDirs = [
    ...new Set(
      ctx.files
        .map(
          (f) =>
            new RegExp(`^${escapeRe(dir ? `${dir}/` : "")}(?:environments|envs|env)/([^/]+)/`).exec(
              f,
            )?.[1],
        )
        .filter((x): x is string => !!x),
    ),
  ];
  const names = envDirs.length
    ? envDirs
    : varFiles.map((f) => posix.basename(f).replace(/(\.auto)?\.tfvars$/, ""));
  const code = [dir ? `${dir}/**` : "**/*.tf"];
  if (names.length) {
    for (const n of names) found.environments.push({ id: n, name: n, region, code });
  } else if (resources.length) {
    found.environments.push({ id: "production", region, code });
  }
  return found;
}

/** A path in a Terraform file, relative to the repository: ${path.module} is the file's directory. */
function tfPath(file: string, p: string | undefined): string | undefined {
  if (!p) return undefined;
  const rel = p.replace(/\$\{path\.(module|root|cwd)\}\/?/g, "");
  if (/\$\{/.test(rel)) return undefined;
  return posix.normalize(posix.join(dirOf(file), rel)).replace(/^\.\/?/, "");
}

function v1Path(resources: HclBlock[], name: string): string {
  const parts: string[] = [];
  for (let n: string | undefined = name, i = 0; n && i < 20; i++) {
    const r = resources.find((x) => x.labels[1] === n);
    if (!r) break;
    parts.unshift(hclString(r.attrs.path_part) ?? "*");
    n = hclReferences(r.attrs.parent_id ?? "").find(
      (x) => x.type === "aws_api_gateway_resource",
    )?.name;
  }
  return `/${parts.join("/")}`;
}

function resolveLocals(blocks: HclBlock[], text: string): string {
  const names = [...text.matchAll(/\blocal\.(\w+)/g)].map((m) => m[1] as string);
  return blocks
    .filter((b) => b.type === "locals")
    .map((b) => names.map((n) => b.attrs[n] ?? "").join("\n"))
    .join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What IAM text grants: the known resources it names, with the access its actions give. */
function grants(text: string, known: Set<string>): IacFunction["uses"] {
  const out: IacFunction["uses"] = [];
  const actions = [...text.matchAll(/"([a-z0-9-]+):([A-Za-z*]+)"/g)].map((m) => ({
    service: m[1] as string,
    action: m[2] as string,
  }));
  // Each statement on its own, so a table gets the actions next to it.
  const statements = text.split(/\{\s*(?=(?:Effect|effect|Action|actions|"Effect"|"Action"))/);
  for (const ref of new Set(hclReferences(text).map((r) => `${r.type}.${r.name}`))) {
    if (!known.has(ref)) continue;
    const near = statements.filter((s) => s.includes(ref)).join("\n");
    const acts = [...near.matchAll(/"[a-z0-9-]+:([A-Za-z*]+)"/g)].map((m) => m[1] as string);
    out.push({ to: ref, access: accessOf(ref, acts) });
  }
  for (const a of actions) {
    if (SERVICES[a.service] && !out.some((u) => u.to === a.service)) {
      out.push({ to: a.service, access: "call" });
    }
  }
  return out;
}

function accessOf(ref: string, actions: string[]): IacAccess {
  if (/sqs_queue|sqs/.test(ref)) {
    const send = actions.some((a) => /Send|\*/.test(a));
    const receive = actions.some((a) => /Receive|Delete|\*/.test(a));
    return send && !receive ? "send" : receive && !send ? "consume" : "send";
  }
  if (/sns_topic/.test(ref)) return "publish";
  const read = actions.some((a) => /Get|Query|Scan|Describe|BatchGet|\*/.test(a));
  const write = actions.some((a) => /Put|Update|Delete|Write|BatchWrite|\*/.test(a));
  return read && write ? "readwrite" : write ? "write" : read ? "read" : "readwrite";
}

function addUse(found: IacFindings, fn: string, to: string, access: IacAccess) {
  const f = found.functions.find((x) => x.id === fn);
  if (!f) return;
  const u = f.uses.find((x) => x.to === to);
  if (u) u.access = access === "consume" ? "consume" : u.access;
  else f.uses.push({ to, access });
}

function lambdaTech(runtime: string | undefined): string {
  if (!runtime) return "AWS Lambda";
  const r = /^(nodejs|python|java|go|dotnet|ruby|provided)/.exec(runtime)?.[1];
  const lang =
    r === "nodejs"
      ? "Node.js"
      : r === "python"
        ? "Python"
        : r === "java"
          ? "Java"
          : r === "dotnet"
            ? ".NET"
            : r === "ruby"
              ? "Ruby"
              : r === "go" || r === "provided"
                ? "Go"
                : undefined;
  return lang ? `${lang}, AWS Lambda` : "AWS Lambda";
}

const HANDLER_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".py", ".go"];

/**
 * The repository file a function's handler is in: `handlers/create.handler`
 * from a source directory, looking through build output (dist/, build/) to
 * the package's source.
 */
export function handlerFile(
  files: readonly string[],
  source: string | undefined,
  handler: string | undefined,
): string | undefined {
  if (!source) return undefined;
  if (HANDLER_EXT.some((e) => source.endsWith(e)) && files.includes(source)) return source;
  // The package the build output is from.
  const base = source
    .replace(/\/(dist|build|out|\.build|bin|lib|target)(\/.*)?$/, "")
    .replace(/\.zip$/, "");
  const module = handler ? handler.replace(/\.[^./]+$/, "") : "index";
  const under = files.filter((f) => f.startsWith(`${base}/`) && !SKIP.test(f));
  for (const root of [source, `${base}/src`, base]) {
    for (const ext of HANDLER_EXT) {
      const f = `${root}/${module}${ext}`;
      if (under.includes(f) || files.includes(f)) return f;
    }
  }
  const tail = `/${module}`;
  const matches = under.filter((f) => HANDLER_EXT.some((e) => f.endsWith(`${tail}${e}`)));
  return matches.length === 1 ? matches[0] : undefined;
}

// --- CDK ---

/** The construct classes the CDK reader knows, by the name at the end of `new x.Name(...)`. */
const CDK_TABLES = new Set(["Table", "TableV2"]);
const CDK_FUNCTIONS = new Set([
  "Function",
  "NodejsFunction",
  "PythonFunction",
  "GoFunction",
  "DockerImageFunction",
  "SingletonFunction",
]);
const CDK_QUEUES: Record<string, [IacQueue["kind"], string]> = {
  Queue: ["queue", "Amazon SQS"],
  Topic: ["topic", "Amazon SNS"],
  EventBus: ["bus", "Amazon EventBridge"],
  Stream: ["stream", "Amazon Kinesis"],
};
const CDK_DATABASES = new Set(["DatabaseInstance", "DatabaseCluster", "ServerlessCluster"]);

async function readCdk(ctx: AnalyzerContext, dir: string): Promise<IacFindings> {
  const prefix = dir ? `${dir}/` : "";
  const files = ctx.files.filter(
    (f) => f.startsWith(prefix) && /\.[cm]?[jt]s$/.test(f) && !/\.d\.ts$/.test(f) && !SKIP.test(f),
  );
  const found: IacFindings = {
    tool: "cdk",
    dir,
    files: [...files, `${prefix}cdk.json`],
    tables: [],
    queues: [],
    functions: [],
    triggers: [],
    services: [],
    environments: [],
    buckets: [],
  };
  // Construct variables, by file and name, to the resource ids they hold.
  const vars = new Map<string, string>();
  const paths = new Map<string, string>();
  const stackClasses = new Set<string>();
  const sources: { file: string; sf: ts.SourceFile }[] = [];
  for (const f of files) {
    const text = await ctx.read(f).catch(() => "");
    if (!text) continue;
    sources.push({ file: f, sf: ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true) });
  }
  for (const { sf } of sources) {
    sf.forEachChild(function visit(n): void {
      if (
        ts.isClassDeclaration(n) &&
        n.name &&
        n.heritageClauses?.some((h) => /Stack\b/.test(h.getText()))
      ) {
        stackClasses.add(n.name.text);
      }
      n.forEachChild(visit);
    });
  }

  const ctor = (n: ts.NewExpression) => {
    const e = n.expression;
    return ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : "";
  };
  const lineOf = (sf: ts.SourceFile, n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const prop = (o: ts.Expression | undefined, name: string): ts.Expression | undefined => {
    if (!o || !ts.isObjectLiteralExpression(o)) return undefined;
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText().replace(/['"]/g, "") === name)
        return p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
    }
    return undefined;
  };
  const str = (e: ts.Expression | undefined): string | undefined =>
    e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined;
  const attrType = (e: ts.Expression | undefined) => {
    const t = e?.getText() ?? "";
    return /STRING/.test(t)
      ? "string"
      : /NUMBER/.test(t)
        ? "number"
        : /BINARY/.test(t)
          ? "bytes"
          : undefined;
  };
  const key = (e: ts.Expression | undefined) => {
    const name = str(prop(e, "name"));
    return name ? { name, type: attrType(prop(e, "type")) } : undefined;
  };
  /** The resource an expression names: a variable, this.x, or a construct made inline. */
  const target = (file: string, e: ts.Expression | undefined): string | undefined => {
    if (!e) return undefined;
    if (ts.isIdentifier(e)) return vars.get(`${file}:${e.text}`);
    if (ts.isPropertyAccessExpression(e) && e.expression.kind === ts.SyntaxKind.ThisKeyword)
      return vars.get(`${file}:this.${e.name.text}`);
    if (ts.isNewExpression(e)) return made.get(e);
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return target(file, e.expression);
    return undefined;
  };
  const made = new Map<ts.Node, string>();
  const pending: { file: string; name: string; node: ts.NewExpression }[] = [];

  // Pass 1: the constructs.
  for (const { file, sf } of sources) {
    sf.forEachChild(function visit(n): void {
      if (ts.isNewExpression(n)) {
        const name = ctor(n);
        const [, idArg, props] = n.arguments ?? [];
        const cid = str(idArg);
        const rid = cid ? `${name}.${cid}` : undefined;
        const line = lineOf(sf, n);
        if (rid && CDK_TABLES.has(name)) {
          const keys: IacTable["keys"] = [];
          const pk = key(prop(props, "partitionKey"));
          const sk = key(prop(props, "sortKey"));
          if (pk) keys.push({ ...pk, role: "partition" });
          if (sk) keys.push({ ...sk, role: "sort" });
          found.tables.push({
            id: rid,
            name: str(prop(props, "tableName")) ?? cid,
            technology: "Amazon DynamoDB",
            file,
            line,
            keys,
            attributes: [],
            indexes: [],
          });
          made.set(n, rid);
        } else if (rid && CDK_DATABASES.has(name)) {
          const engine = prop(props, "engine")?.getText() ?? "";
          found.tables.push({
            id: rid,
            name: str(prop(props, "databaseName")) ?? cid,
            technology: /postgres/i.test(engine)
              ? "Amazon RDS for PostgreSQL"
              : /mysql|maria/i.test(engine)
                ? "Amazon RDS for MySQL"
                : "Amazon RDS",
            file,
            line,
            keys: [],
            attributes: [],
            indexes: [],
          });
          made.set(n, rid);
        } else if (
          rid &&
          CDK_QUEUES[name] &&
          /sqs|sns|events|kinesis/.test(n.expression.getText() + sf.text.slice(0, 2000))
        ) {
          const [kind, technology] = CDK_QUEUES[name] as [IacQueue["kind"], string];
          found.queues.push({
            id: rid,
            name:
              str(
                prop(props, "queueName") ??
                  prop(props, "topicName") ??
                  prop(props, "eventBusName") ??
                  prop(props, "streamName"),
              ) ?? cid,
            kind,
            technology,
            file,
            line,
          });
          made.set(n, rid);
        } else if (rid && CDK_FUNCTIONS.has(name)) {
          const entry = str(prop(props, "entry"));
          const handlerProp = str(prop(props, "handler"));
          const code = prop(props, "code");
          const asset =
            code && ts.isCallExpression(code) && /fromAsset$/.test(code.expression.getText())
              ? str(code.arguments[0])
              : undefined;
          const rel = (p: string) =>
            posix.normalize(posix.join(dirOf(file), p)).replace(/^\.\/?/, "");
          // NodejsFunction resolves entry from the project root (where cdk.json is) when it's relative.
          const entryFile = entry
            ? [rel(entry), posix.normalize(posix.join(dir, entry))].find((p) =>
                ctx.files.includes(p),
              )
            : undefined;
          const handler =
            entryFile ??
            handlerFile(
              ctx.files,
              asset ? rel(asset) : undefined,
              handlerProp ?? "index.handler",
            ) ??
            (asset
              ? handlerFile(
                  ctx.files,
                  posix.normalize(posix.join(dir, asset)),
                  handlerProp ?? "index.handler",
                )
              : undefined);
          const runtime = prop(props, "runtime")?.getText() ?? "";
          found.functions.push({
            id: rid,
            name: str(prop(props, "functionName")) ?? cid,
            technology:
              name === "NodejsFunction"
                ? "Node.js, AWS Lambda"
                : name === "PythonFunction"
                  ? "Python, AWS Lambda"
                  : name === "GoFunction"
                    ? "Go, AWS Lambda"
                    : lambdaTech(runtime.split(".").pop()?.toLowerCase()),
            file,
            line,
            handler,
            symbol: entry
              ? (str(prop(props, "handler")) ?? "handler")
              : handlerProp?.split(".").pop(),
            uses: [],
          });
          made.set(n, rid);
        } else if (rid && name === "Bucket") {
          found.buckets.push({
            id: rid,
            name: str(prop(props, "bucketName")) ?? cid,
            website: !!prop(props, "websiteIndexDocument"),
            file,
          });
          made.set(n, rid);
        } else if (cid && stackClasses.has(name)) {
          const env = prop(props, "env");
          found.environments.push({
            id: kebab(cid),
            name: cid,
            region: str(prop(env, "region")),
            account: str(prop(env, "account")),
            code: [prefix ? `${prefix}**` : "**"],
          });
        }
      }
      // const x = new ..., this.x = new ...
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
        const t = ts.isNewExpression(n.initializer) ? n.initializer : undefined;
        if (t) pending.push({ file, name: n.name.text, node: t });
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        n.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isNewExpression(n.right)
      ) {
        pending.push({ file, name: `this.${n.left.name.text}`, node: n.right });
      }
      n.forEachChild(visit);
    });
  }
  for (const p of pending) {
    const rid = made.get(p.node);
    if (rid) vars.set(`${p.file}:${p.name}`, rid);
  }

  // Pass 2: what's granted, what starts each function, and API routes.
  const fn = (id: string | undefined) => found.functions.find((f) => f.id === id);
  for (const { file, sf } of sources) {
    // Resource paths: api.root, root.addResource("x"), variables holding them.
    const pathOf = (e: ts.Expression): string | undefined => {
      if (ts.isIdentifier(e)) return paths.get(`${file}:${e.text}`);
      if (ts.isPropertyAccessExpression(e) && e.name.text === "root") return "";
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
        const m = e.expression.name.text;
        if (m === "addResource" || m === "resourceForPath") {
          const base = pathOf(e.expression.expression);
          const part = str(e.arguments[0]);
          return base !== undefined && part ? `${base}/${part.replace(/^\//, "")}` : undefined;
        }
      }
      return undefined;
    };
    sf.forEachChild(function visit(n): void {
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
        const p = pathOf(n.initializer);
        if (p !== undefined) paths.set(`${file}:${n.name.text}`, p);
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const on = n.expression.expression;
        const subject = target(file, on);
        const arg = n.arguments[0];
        const line = lineOf(sf, n);
        if (/^grant/.test(method) && subject) {
          const f = fn(target(file, arg));
          if (f) {
            const access: IacAccess = /Consume/.test(method)
              ? "consume"
              : /SendMessages/.test(method)
                ? "send"
                : /Publish|PutEvents/.test(method)
                  ? "publish"
                  : /ReadWrite|FullAccess/.test(method)
                    ? "readwrite"
                    : /Write/.test(method)
                      ? "write"
                      : /Read/.test(method)
                        ? "read"
                        : "readwrite";
            addUse(found, f.id, subject, access);
          }
        } else if (method === "addGlobalSecondaryIndex" || method === "addLocalSecondaryIndex") {
          const t = found.tables.find((x) => x.id === subject);
          if (t) {
            const idx = str(prop(arg, "indexName"));
            if (idx) t.indexes.push(idx);
            for (const k of [key(prop(arg, "partitionKey")), key(prop(arg, "sortKey"))]) {
              if (
                k &&
                !t.keys.some((x) => x.name === k.name) &&
                !t.attributes.some((x) => x.name === k.name)
              )
                t.attributes.push(k);
            }
          }
        } else if (method === "addEventSource" && fn(subject)) {
          const src = arg && ts.isNewExpression(arg) ? arg : undefined;
          const queue = src ? target(file, src.arguments?.[0]) : undefined;
          if (queue) {
            found.triggers.push({
              kind: "consumer",
              label: queue,
              function: subject as string,
              queue,
              file,
              line,
            });
            addUse(found, subject as string, queue, "consume");
          }
        } else if (method === "addToRolePolicy" && fn(subject)) {
          for (const m of n.getText().matchAll(/["'`]([a-z0-9-]+):[A-Za-z*]+["'`]/g)) {
            const service = m[1] as string;
            if (SERVICES[service]) addUse(found, subject as string, service, "call");
          }
        } else if (method === "addMethod") {
          const verb = str(arg);
          const integration = n.arguments[1];
          const f =
            integration && ts.isNewExpression(integration)
              ? fn(target(file, integration.arguments?.[0]))
              : undefined;
          const path = pathOf(on);
          if (verb && f && path !== undefined) {
            found.triggers.push({
              kind: "route",
              label: `${verb} ${path || "/"}`,
              function: f.id,
              file,
              line,
            });
          }
        } else if (method === "addRoutes") {
          const path = str(prop(arg, "path"));
          const methods = prop(arg, "methods");
          const integration = prop(arg, "integration");
          const f =
            integration && ts.isNewExpression(integration)
              ? fn(target(file, integration.arguments?.[1] ?? integration.arguments?.[0]))
              : undefined;
          const verbs =
            methods && ts.isArrayLiteralExpression(methods)
              ? methods.elements.map((m) => m.getText().split(".").pop() ?? "ANY")
              : ["ANY"];
          if (path && f) {
            for (const v of verbs)
              found.triggers.push({
                kind: "route",
                label: `${v} ${path}`,
                function: f.id,
                file,
                line,
              });
          }
        }
      }
      // new events.Rule(this, id, { schedule, targets: [new LambdaFunction(fn)] })
      if (ts.isNewExpression(n) && ctor(n) === "Rule") {
        const props = n.arguments?.[2];
        const schedule = prop(props, "schedule");
        const targets = prop(props, "targets");
        if (schedule && targets && ts.isArrayLiteralExpression(targets)) {
          for (const t of targets.elements) {
            const f = ts.isNewExpression(t) ? fn(target(file, t.arguments?.[0])) : undefined;
            if (f) {
              found.triggers.push({
                kind: "schedule",
                label: scheduleText(schedule),
                function: f.id,
                file,
                line: lineOf(sf, n),
              });
            }
          }
        }
      }
      n.forEachChild(visit);
    });
  }
  for (const f of found.functions) {
    for (const u of f.uses) {
      if (SERVICES[u.to] && !found.services.some((s) => s.id === u.to)) {
        found.services.push({ id: u.to, technology: SERVICES[u.to] as string });
      }
    }
  }
  return found;
}

/** `cron(0 2 * * ? *)` or `rate(1 hour)` from Schedule.cron({...}) or Schedule.rate(...). */
function scheduleText(e: ts.Expression): string {
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const kind = e.expression.name.text;
    const arg = e.arguments[0];
    if (kind === "expression" && arg && ts.isStringLiteral(arg)) return arg.text;
    if (kind === "cron" && arg && ts.isObjectLiteralExpression(arg)) {
      const get = (n: string) => {
        for (const p of arg.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            p.name.getText() === n &&
            ts.isStringLiteral(p.initializer)
          )
            return p.initializer.text;
        }
        return undefined;
      };
      const weekDay = get("weekDay");
      return `cron(${get("minute") ?? "*"} ${get("hour") ?? "*"} ${weekDay ? "?" : (get("day") ?? "*")} ${get("month") ?? "*"} ${weekDay ?? "?"} ${get("year") ?? "*"})`;
    }
    if (kind === "rate" && arg) return `rate(${arg.getText().replace(/^Duration\./, "")})`;
  }
  return e.getText();
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
