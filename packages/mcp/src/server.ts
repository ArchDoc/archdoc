import {
  type Answer,
  checkAnswer,
  contextAnswer,
  initAnswer,
  pathsAnswer,
  sealAnswer,
  showAnswer,
  type Where,
} from "@archdoc/analyzers";
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
- archdoc_paths: where flows start (routes, consumers, jobs, commands) and the calls each makes. Trace a flow with it, not grep.
- archdoc_show: one thing by ID (element, actor, journey, data entry, Entry.field, trace, or a fact like element:<id>).
- archdoc_check: after you edit, with base "main". It lists what your change broke or made stale, each with its fix, and facts whose code changed. Edit .archdoc/ to fix the model, with provenance: { source: suggested, by: agent:<name> } on what you add.
- archdoc_seal: once you've checked each changed fact against its code, seal it. Never seal a fact you haven't read.`;

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
        "Everything about one ID: an element (code: true adds its snippets' text), actor, journey, data entry, Entry.field (its lineage), trace, or a fact archdoc_check names (element:<id>, step:<journey>#<n>).",
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
        'After you edit: model problems, imports the model doesn\'t declare, broken rules and journeys, stale paths, traces, and facts whose sealed code changed, each with its fix. With base (such as "main"): only what your change caused, plus the verdict the PR comment will give, journeys, and who to ask. format "markdown" returns that comment, for a PR description. done: true, for a new model: what it still lacks before it is done.',
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
