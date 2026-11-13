import {
  type Answer,
  checkAnswer,
  contextAnswer,
  editAnswer,
  findAnswer,
  initAnswer,
  type PlanListInput,
  type PlanTaskInput,
  pathsAnswer,
  planListAnswer,
  planReadAnswer,
  planRespondAnswer,
  planStartAnswer,
  planTaskAnswer,
  planWaitAnswer,
  sealAnswer,
  showAnswer,
  type TriageListInput,
  triageCheckAnswer,
  triageListAnswer,
  triageStartAnswer,
  triageWaitAnswer,
  type Where,
} from "@archdoc/analyzers";
import { type EditOp, FIND_GAPS, type PlanEditOp } from "@archdoc/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ArchdocServerOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  /** Directory relative paths are resolved from. */
  cwd?: string;
  version?: string;
}

export const INSTRUCTIONS = `This repository's architecture is modeled in .archdoc/: actors, elements mapped to code, journeys, and data. People own it. Use it before you grep. With no .archdoc/ yet, archdoc_init starts one.

- archdoc_context: start every task here, with the task in words, the files you'll change, or an error. It says which files and functions to open, what else does the same job, the journeys, data, rules, tests, owners, and who uses it. Name the affected journeys in your plan; ask before changing a critical one.
- archdoc_paths: where flows start (routes, consumers, jobs, commands) and the calls each makes, to trace a flow.
- archdoc_show: one thing by ID (element, actor, journey, data entry, Entry.field, Triage record, or a fact like element:<id>).
- archdoc_triage: handed a bug, even to fix? Start here, before the code; its answer says how to fill the record in. Keep it through the fix.
- archdoc_plan: asked to plan or design a change? Start a plan; the person pins what they want on the explorer's map, you suggest the architecture, then build it.
- archdoc_find, archdoc_edit: find parts of the model and change them by ID, many ops a call, instead of reading and editing its YAML. Pass by: agent:<name>.
- archdoc_check: after you edit, with base "main". It lists what your change broke or made stale, each with its fix, and facts whose code changed.
- archdoc_seal: once you've checked each changed fact against its code, seal it. Never seal a fact you haven't read.`;

/**
 * The longest a wait holds one tool call, in seconds: MCP clients give up on
 * a call after about a minute (Claude Code after 60 seconds), so a wait
 * returns before that and says to wait again.
 */
const WAIT_MAX = 50;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** An MCP server with one tool per question an agent asks. Reloads the model on every call. */
export function createArchdocServer(options: ArchdocServerOptions = {}): McpServer {
  const where: Where = { model: options.model, cwd: options.cwd ?? process.cwd() };
  const server = new McpServer(
    { name: "archdoc", version: options.version ?? "0.0.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "archdoc_context",
    {
      title: "Where to start",
      description:
        "Before you grep: the files and functions to open first, other code that does the same job, data, rules, journeys (critical first), tests, owners, and who uses it, other repos included. Pass the task in words, the paths you'll change, or both; or an error (log, stack trace) for the journey steps it showed up in. Nothing: an overview.",
      inputSchema: {
        task: z.string().optional().describe('The task in a few words, such as "refund rounding"'),
        paths: z.array(z.string()).optional().describe("Files or directories you'll change"),
        error: z.string().optional().describe("An error, log lines, or a stack trace, as given"),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(contextAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_show",
    {
      title: "One thing in the model",
      description:
        "Everything about one ID: an element (code: true adds its snippets' text), actor, journey, data entry, Entry.field (its lineage), Triage record, or a fact archdoc_check names (element:<id>, step:<journey>#<n>).",
      inputSchema: {
        id: z
          .string()
          .describe("An ID, such as payments.charges, Refund.amount_cents, or step:refund#2"),
        code: z.boolean().optional().describe("For an element: include its code snippets"),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(showAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_find",
    {
      title: "Find parts of the model",
      description:
        "Parts of the model by words or by what they are, each with its ID for archdoc_edit, kind, description, code, uses, and file:line. Filter by type, kind, under (inside an element), path (elements whose code covers a file, owner first), or missing (what they lack). outline: true gives the element tree with code and uses: read it instead of the YAML.",
      inputSchema: {
        query: z.string().optional().describe('Words, such as "checkout pricing"'),
        type: z.enum(["element", "actor", "journey", "data", "environment"]).optional(),
        kind: z.string().optional().describe("Such as container, datastore, person, or critical"),
        under: z.string().optional().describe("An element ID"),
        path: z.string().optional().describe("A file or directory"),
        missing: z
          .array(z.enum(FIND_GAPS as [string, ...string[]]))
          .optional()
          .describe("uses: nothing connects to it"),
        outline: z.boolean().optional(),
        depth: z.number().int().min(1).max(10).optional().describe("Outline levels; 3 by default"),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(findAnswer(where, input as Parameters<typeof findAnswer>[1])),
  );

  const op = z.object({
    op: z.enum(["add", "set", "remove", "rename", "use", "step"]),
    id: z.string().optional().describe("What add, set, remove, or rename acts on"),
    type: z
      .enum(["element", "actor", "journey", "data", "environment", "node"])
      .optional()
      .describe("Only when an ID names two things, or add can't tell"),
    spec: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe("The fields: what add writes, set merges, use and step say"),
    to: z.string().optional().describe("rename: the new ID. use: the element used"),
    from: z.string().optional().describe("use: the element or actor that uses it"),
    journey: z.string().optional().describe("step: the journey"),
    at: z.number().int().min(1).optional().describe("step: which step, from 1"),
    insert: z.boolean().optional().describe("step: insert before step at"),
    remove: z.boolean().optional().describe("use, step: remove it"),
  });

  server.registerTool(
    "archdoc_edit",
    {
      title: "Change the model by ID",
      description: `Change .archdoc/ by ID instead of editing its YAML. Ops run in order, and all are written or none: one that fails, or an edit that would add errors, writes nothing and says why. Writes only the lines it changes, and answers with what it did, the findings it fixed, and new warnings. IDs resolve the way references do (orders.api for shop.orders.api).
- add {type, id, spec}: an element (shop.orders.api goes inside shop.orders; kind defaults to the level below), actor, data entry, journey (its own file), environment, or node (production.aws.lambda).
- set {id, spec}: a JSON merge patch (objects merge, lists replace, null removes), such as {description, code, deploy} or {fields: {total: {type: int}}}.
- remove {id}: an element goes with what's inside it and the uses of it.
- rename {id, to}: rewrites every reference. An element's dotted to moves it inside that parent.
- use {from, to, spec}: adds or updates a use (spec: "what it does" or {description, sends}); remove: true removes it.
- step {journey, spec}: appends {from, to, action, code, sends}; with at, merges into that step; at with insert or remove inserts or removes.`,
      inputSchema: {
        ops: z.array(op).min(1),
        by: z
          .string()
          .optional()
          .describe("Marks what you add as suggested by you, such as agent:claude-code"),
        dryRun: z.boolean().optional().describe("Write nothing"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) => respond(editAnswer(where, { ...input, ops: input.ops as EditOp[] })),
  );

  server.registerTool(
    "archdoc_paths",
    {
      title: "Where flows start, and the calls they make",
      description:
        "The repository's entry points (HTTP routes, queue consumers, scheduled jobs, CLI commands, from the code and from Terraform and CDK) and, for each, the calls it makes: function names, files, and lines, the model element each is in, and what each reaches outside the code (a DynamoDB table, a queue, an HTTP call). With many, a summary by place and resource. Pass entry to see one flow, or a place or resource to list its entry points; hops: true shows only the calls between elements. Read only the files on the path you need; works before a model exists.",
      inputSchema: {
        entry: z
          .string()
          .optional()
          .describe(
            'An entry point\'s label, file, or handler, such as "POST /bookings" or "consumer"; or a place or resource, such as "apps/api" or "/orders"',
          ),
        hops: z
          .boolean()
          .optional()
          .describe("Fold calls that stay inside one element: only the hops between elements"),
        all: z
          .boolean()
          .optional()
          .describe("List every entry point, even when there are many to summarize"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("How deep to follow calls; 5 by default"),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(pathsAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_check",
    {
      title: "What's wrong or stale",
      description:
        'After you edit: model problems, imports the model doesn\'t declare, broken rules and journeys, stale paths, Triage records, and facts whose sealed code changed, each with its fix. With base (such as "main"): only what your change caused, plus the verdict the PR comment will give, journeys, and who to ask. format "markdown" returns that comment, for a PR description. done: true, for a new model: what it still lacks before it is done.',
      inputSchema: {
        base: z.string().optional().describe("Branch or commit to compare with, such as main"),
        all: z.boolean().optional().describe("List every finding, not only the change's"),
        format: z.enum(["text", "markdown"]).optional(),
        done: z
          .boolean()
          .optional()
          .describe(
            "For a model you're starting: what it still lacks before it's done (level sizes, descriptions, test code, unconnected elements, the system, actors, journeys for the entry points, step detail, the data steps carry and stores hold, environments and deploy), each with what to do",
          ),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(checkAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_seal",
    {
      title: "Seal facts you checked",
      description:
        "Record in archdoc.sum that the model still describes the code these facts point at, after you read them (and fixed the model where it didn't). An element ID seals all its facts. Without facts, seals only new ones. Writes archdoc.sum only. Returns what's still to check.",
      inputSchema: {
        facts: z.array(z.string()).optional().describe("Facts archdoc_check named, or element IDs"),
        by: z.string().optional().describe("Who checked, such as agent:claude-code"),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => respond(sealAnswer(where, { ...input, requireSum: true })),
  );

  server.registerTool(
    "archdoc_triage",
    {
      title: "Triage a bug",
      description:
        "Handed a bug, even to fix? Start here, before the code: pass it as symptom. Writes .archdoc/triage/<id>.yaml with the journey step it showed up in, leads, and steps from the stack. Fill it in as you follow the code: rule leads in or out, a step per hop with a description of what happened there, what it sends (observed/expected values), code, evidence; role: cause, root-cause, status (fixed, with fix, once fixed). Only id: what a record lacks. list: the records. wait: until the person sends a bug from the explorer.",
      inputSchema: {
        symptom: z.string().optional().describe("The bug as given: error, log, or issue text"),
        title: z.string().optional().describe("The bug in one line"),
        link: z.string().optional().describe("The issue URL"),
        reportedBy: z.string().optional(),
        id: z.string().optional(),
        list: z.boolean().optional(),
        status: z.string().optional().describe("With list, such as open-all or fixed"),
        wait: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) => {
      if (input.wait) return respond(triageWaitAnswer(where, { id: input.id, timeout: WAIT_MAX }));
      if (input.list || (!input.symptom && !input.id))
        return respond(
          triageListAnswer(where, {
            status: input.status as TriageListInput["status"],
          }),
        );
      if (!input.symptom) return respond(triageCheckAnswer(where, input.id as string));
      return respond(
        triageStartAnswer(where, {
          symptom: input.symptom,
          title: input.title,
          link: input.link,
          by: input.reportedBy,
          id: input.id,
        }),
      );
    },
  );

  server.registerTool(
    "archdoc_plan",
    {
      title: "Plan a change with the person",
      description:
        "Plan a change. start: the idea; the person pins what they want (intents, i1) on the explorer's map. wait: until they send it. read: intents, changes, reach, check. respond: suggested changes and sequences for each intent (for: [i1]), notes, tasks; never edit theirs. task: a task's status.",
      inputSchema: {
        action: z.enum(["start", "wait", "read", "respond", "task", "list"]),
        id: z.string().optional(),
        goal: z.string().optional().describe("start: the idea, as the person put it"),
        title: z.string().optional(),
        paths: z.array(z.string()).optional().describe("start: files it will likely touch"),
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'respond: {"op":"put","list":"notes"|"changes"|"sequences"|"tasks","item":{…}}, {"op":"reply","note":"n1","text":"…"}, {"op":"step","sequence":"s1","step":{…}}, {"op":"set","status":"ready"}',
          ),
        by: z.string().optional().describe("agent:<name>"),
        task: z.string().optional(),
        status: z.string().optional().describe("task: todo, doing, done, skipped"),
        timeout: z.number().optional().describe(`wait: seconds, ≤${WAIT_MAX}`),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) => {
      const need = (what: string) =>
        respond(Promise.resolve({ ok: false, text: `${input.action} needs ${what}.` }));
      switch (input.action) {
        case "start":
          if (!input.goal) return need("goal");
          return respond(
            planStartAnswer(where, {
              goal: input.goal,
              title: input.title,
              id: input.id,
              paths: input.paths,
            }),
          );
        case "list":
          return respond(
            planListAnswer(where, { status: input.status as PlanListInput["status"] }),
          );
        case "read":
          if (!input.id) return need("id");
          return respond(planReadAnswer(where, { id: input.id }));
        case "wait":
          if (!input.id) return need("id");
          return respond(
            planWaitAnswer(where, {
              id: input.id,
              timeout: Math.min(input.timeout ?? WAIT_MAX, WAIT_MAX),
            }),
          );
        case "respond":
          if (!input.id || !input.ops?.length) return need("id and ops");
          return respond(
            planRespondAnswer(where, {
              id: input.id,
              ops: input.ops as unknown as PlanEditOp[],
              by: input.by,
            }),
          );
        case "task":
          if (!input.id || !input.task) return need("id and task");
          return respond(
            planTaskAnswer(where, {
              id: input.id,
              task: input.task,
              status: (input.status ?? "done") as PlanTaskInput["status"],
            }),
          );
      }
    },
  );

  server.registerTool(
    "archdoc_init",
    {
      title: "Start a model",
      description:
        "Only for a repository with no .archdoc/: writes a starting model from its packages, compose services, imports, schema files, and infrastructure as code (Terraform, CDK), all marked inferred: a system with containers, the components inside each, the code inside each component, the uses between them at each level, datastores and queues with the data they hold, and environments. Answers with a brief: the entry points, deployment files, and docs to read first, and what to add (descriptions, actors, journeys). Never writes over a model.",
      inputSchema: {
        name: z.string().optional().describe("The namespace; defaults to the root package's name"),
        dryRun: z.boolean().optional().describe("Return the model without writing it"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => respond(initAnswer(where, input)),
  );

  return server;
}

async function respond(answer: Promise<Answer>) {
  try {
    const r = await answer;
    return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok || undefined };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}
