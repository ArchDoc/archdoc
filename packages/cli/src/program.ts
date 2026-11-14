import { readFileSync } from "node:fs";
import { FIND_GAPS } from "@archdoc/core";
import { SPEC_VERSION } from "@archdoc/spec";
import { Command, Option } from "commander";
import { check } from "./commands/check.js";
import { map, show } from "./commands/code.js";
import { context, evalCommand } from "./commands/context.js";
import { diff } from "./commands/diff.js";
import { type EditOptions, editCommand, type FindOptions, findCommand } from "./commands/edit.js";
import { publish, sync } from "./commands/federation.js";
import { init } from "./commands/init.js";
import { landscapeBuild } from "./commands/landscape.js";
import { migrate } from "./commands/migrate.js";
import { paths } from "./commands/paths.js";
import {
  type PlanStartOptions,
  planList,
  planRead,
  planRespond,
  planStart,
  planTask,
  planWait,
} from "./commands/plan.js";
import { report } from "./commands/report.js";
import { schema } from "./commands/schema.js";
import { seal } from "./commands/seal.js";
import { site } from "./commands/site.js";
import {
  type TriageStartOptions,
  triageList,
  triageMigrate,
  triageStart,
  triageWait,
} from "./commands/triage.js";
import { validate } from "./commands/validate.js";
import { view } from "./commands/view.js";
import { type Io, processIo } from "./io.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

/** Builds the `archdoc` program. Each action sets `exitCode` instead of exiting. */
export function createProgram(io: Io = processIo): Command & { exitCode?: number } {
  const program: Command & { exitCode?: number } = new Command("archdoc");
  const run = (code: Promise<number>) =>
    code.then((c) => {
      program.exitCode = c;
    });

  program
    .description("An architecture control plane for AI-assisted development.")
    .version(`${version} (model format ${SPEC_VERSION})`)
    .addHelpText(
      "after",
      "\nExperimental commands may change in a minor release: see https://github.com/ArchDoc/archdoc/blob/main/docs/experimental.md",
    )
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    });

  program
    .command("init")
    .description(
      "Start a model from what the repository declares: packages, compose services, imports, and schema files, all marked inferred",
    )
    .argument("[path]", "the repository", ".")
    .option("--name <namespace>", "the model's namespace (default: the root package or directory)")
    .option("--dry-run", "print the model without writing it")
    .option("--json", "print the result as JSON")
    .action((path: string, opts: { name?: string; dryRun?: boolean; json?: boolean }) =>
      run(init(path, opts, io)),
    );

  program
    .command("validate")
    .description("Check the model: schema, references, and journeys")
    .argument("[path]", "repository, .archdoc directory, or model file", ".")
    .option("--json", "print the result as JSON")
    .option("--strict", "fail on warnings too")
    .action((path: string, opts: { json?: boolean; strict?: boolean }) =>
      run(validate(path, opts, io)),
    );

  program
    .command("view")
    .description("Open the explorer in your browser")
    .argument("[path]", "repository, .archdoc directory, or model file", ".")
    .option("-w, --watch", "reload the explorer when model files change")
    .option(
      "-b, --base <ref>",
      "open on the Diff: the code changed since it left this branch, read into the model",
    )
    .addOption(
      new Option(
        "-l, --landscape",
        "show the landscape: this model composed with every model it imports (experimental)",
      ).hideHelp(),
    )
    .option("-p, --port <port>", "port to listen on (default: a free port)")
    .option("--open", "open the explorer in your default browser")
    .option(
      "-d, --detach",
      "run it in the background: print the URL and return (reuses one already running)",
    )
    .action(
      async (
        path: string,
        opts: {
          watch?: boolean;
          port?: string;
          open?: boolean;
          detach?: boolean;
          base?: string;
          landscape?: boolean;
        },
      ) => {
        const result = await view(path, opts, io);
        program.exitCode = result.code;
      },
    );

  program
    .command("site")
    .description(
      "Write the explorer as a static site; with --base, opened on a change, for a pull request to link to",
    )
    .argument("[path]", "repository, .archdoc directory, or model file", ".")
    .option("-o, --out <dir>", "directory to write the site to", "site")
    .option("-b, --base <ref>", "show the change since this branch or commit")
    .action((path: string, opts: { out?: string; base?: string }) => run(site(path, opts, io)));

  program
    .command("context")
    .description(
      "Where to start: files and symbols to open first, other code that does the same job, data, rules, journeys, tests, owners, and who uses it. With --error, where an error showed up; with nothing, an overview",
    )
    .argument("[words-or-paths...]", "the task in a few words, files you plan to change, or both")
    .option(
      "-e, --error <file>",
      "an error, log, or stack trace to place, from a file or - (stdin)",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "text or json", "text")
    .option("--json", "print the result as JSON")
    .action(
      (args: string[], opts: { model?: string; format?: string; json?: boolean; error?: string }) =>
        run(context(args, opts, io)),
    );

  program
    .command("eval")
    .helpGroup("Other commands:")
    .description(
      "Replay recent commits through archdoc context: how many of the files each changed the brief pointed at",
    )
    .argument("[ref]", "the branch or commit whose history to replay", "HEAD")
    .option("-n, --commits <n>", "how many non-merge commits to replay", "50")
    .option("--min-recall <ratio>", "exit 1 when recall is below this, from 0 to 1")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "text or json", "text")
    .option("-v, --verbose", "list the changed files each brief missed")
    .action(
      (
        ref: string | undefined,
        opts: {
          model?: string;
          format?: string;
          commits?: string;
          minRecall?: string;
          verbose?: boolean;
        },
      ) => run(evalCommand(ref, opts, io)),
    );

  program
    .command("paths")
    .description(
      "Where flows start (routes, consumers, schedules, CLI commands, from code and from Terraform and CDK) and the calls each makes, by function, file, and line",
    )
    .argument(
      "[entry]",
      'an entry point\'s label, file, or handler, such as "POST /bookings", or a place or resource, such as "apps/api" or "/orders"',
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--depth <n>", "how deep to follow calls (default 5)")
    .option("--hops", "fold calls inside one element: show only the hops between elements")
    .option("--all", "list every entry point, even when there are many")
    .action(
      (
        entry: string | undefined,
        opts: { model?: string; depth?: string; all?: boolean; hops?: boolean },
      ) => run(paths(entry, opts, io)),
    );

  program
    .command("find")
    .description(
      "Parts of the model by words or by what they are (type, kind, inside an element, owning a file, missing a description, use, deploy, or fields), with the ID to edit; --outline for the element tree",
    )
    .argument("[words...]", 'words, such as "checkout pricing"')
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--type <type>", "element, actor, journey, data, or environment")
    .option("--kind <kind>", "an element, actor, or data kind, or a journey's importance")
    .option("--under <id>", "only what's inside this element")
    .option("--path <path>", "elements whose code covers this file or directory, the owner first")
    .option("--missing <gaps>", `what they lack, comma-separated: ${FIND_GAPS.join(", ")}`)
    .option("--outline", "the element tree, from the top or from --under")
    .option("--depth <n>", "with --outline, how many levels (default 3)")
    .option("--limit <n>", "how many to list (default 40)")
    .action((words: string[], opts: FindOptions) => run(findCommand(words, opts, io)));

  program
    .command("edit")
    .description(
      "Change the model by ID: add, set, remove, rename (references follow), use, and step. Writes only the lines it changes, and says what it fixed and broke",
    )
    .argument("[ops]", "the ops as JSON (one, or a list), or - for stdin")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --file <path>", "read the ops from a JSON file (- for stdin)")
    .option(
      "--by <author>",
      "mark what's added as suggested by this author, such as agent:claude-code",
    )
    .option("--dry-run", "say what would change, and write nothing")
    .action((ops: string | undefined, opts: EditOptions) => run(editCommand(ops, opts, io)));

  program
    .command("show")
    .description(
      "One thing in the model: an element, actor, journey, data entry, Entry.field (its lineage), Triage record, or sealed fact",
    )
    .argument("<id>", "such as payments.charges, Refund.amount_cents, or step:refund#2")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--code", "print the code snippets an element points at")
    .action((id: string, opts: { model?: string; code?: boolean }) => run(show(id, opts, io)));

  program
    .command("map")
    .description(
      "How the repository's files map onto the model: coverage, unmapped files, stale paths",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--unmapped", "list every unmapped file")
    .option("--json", "print the result as JSON")
    .action((opts: { model?: string; json?: boolean; unmapped?: boolean }) => run(map(opts, io)));

  program
    .command("mcp")
    .description("Start the MCP server on stdio, for coding agents")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .action(async (opts: { model?: string }) => {
      const { runStdio } = await import("@archdoc/mcp");
      await runStdio({ model: opts.model, cwd: io.cwd, version });
    });

  const triage = program
    .command("triage")
    .description(
      "Triage records: a bug, the leads followed, and the path the failing request took to its root cause, attached to the journey step where it showed up (.archdoc/triage/)",
    );
  triage
    .command("start")
    .description(
      "Start a record from a bug report: places the error, and writes .archdoc/triage/<id>.yaml to fill in",
    )
    .argument("[file]", "the error, log, stack trace, or issue text, from a file or - (stdin)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-t, --title <title>", "the bug in one line, as a user would say it")
    .option("--id <id>", "the record's ID (default: from the title or the error)")
    .option("--link <url>", "where it was reported: the issue, ticket, or thread")
    .option("--by <who>", "who reported it: an actor ID, or a name")
    .option("--severity <level>", "low, normal, high, or critical")
    .option("--dry-run", "print the record without writing it")
    .action((file: string | undefined, opts: TriageStartOptions) =>
      run(triageStart(file, opts, io)),
    );
  triage
    .command("list")
    .description("List the records, open ones first")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option(
      "-s, --status <status>",
      "only this status (open, investigating, root-caused, fixed, wont-fix, cannot-reproduce), or open-all for every unclosed one",
    )
    .option("-e, --element <id>", "only records that name this element or its parts")
    .action((opts: { model?: string; status?: string; element?: string }) =>
      run(triageList(opts, io)),
    );
  triage
    .command("wait")
    .description(
      "Wait until the person sends a bug from the explorer's Triage tab (Send to agent), then show it and how to follow it",
    )
    .argument("[id]", "one record to wait for (default: any)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--timeout <seconds>", "give up after this long (default 600)")
    .action((id: string | undefined, opts: { model?: string; timeout?: string }) =>
      run(triageWait(id, opts, io)),
    );
  triage
    .command("migrate")
    .description("Move traces from before 0.8 (.archdoc/traces/) to Triage records")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--dry-run", "say what would move without moving it")
    .action((opts: { model?: string; dryRun?: boolean }) => run(triageMigrate(opts, io)));

  const plan = program
    .command("plan")
    .description(
      "Plans: a change designed with the agent on the explorer's map before it's built, each part with the person's intent, then carried out as tasks (.archdoc/plans/)",
    );
  plan
    .command("start")
    .description(
      "Start a plan from the idea, and say how the person adds what they want in the explorer",
    )
    .argument("<goal...>", "the idea in a sentence, or - (stdin)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-t, --title <title>", "the change in one line")
    .option("--id <id>", "the plan's ID (default: from the title or the goal)")
    .option("--by <who>", "whose plan it is: human:@handle")
    .option("-p, --path <paths...>", "files the change will likely touch")
    .option("--dry-run", "print the plan without writing it")
    .action((words: string[], opts: PlanStartOptions) => run(planStart(words, opts, io)));
  plan
    .command("list")
    .description("List the plans and what's open in each")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option(
      "-s, --status <status>",
      "only this status (drafting, reviewing, ready, executing, done, abandoned), or open",
    )
    .action((opts: { model?: string; status?: string }) => run(planList(opts, io)));
  plan
    .command("read")
    .description(
      "Read a plan: what the person changed since your last read, every item with its intent, what it reaches, and the check",
    )
    .argument("<id>", "the plan's ID")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--peek", "don't mark what changed as read")
    .action((id: string, opts: { model?: string; peek?: boolean }) => run(planRead(id, opts, io)));
  plan
    .command("wait")
    .description("Wait until the person sends the plan from the explorer, then read it")
    .argument("<id>", "the plan's ID")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--timeout <seconds>", "give up after this long (default 600)")
    .action((id: string, opts: { model?: string; timeout?: string }) =>
      run(planWait(id, opts, io)),
    );
  plan
    .command("respond")
    .description(
      "Answer a plan: notes, replies, suggested changes and steps, tasks, and status, as JSON ops",
    )
    .argument("<id>", "the plan's ID")
    .argument("[ops]", "one op or a list, as JSON, or - (stdin)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --file <path>", "read the ops from a file, or - (stdin)")
    .option("--by <who>", "who's answering: agent:<name>")
    .action(
      (id: string, ops: string | undefined, opts: { model?: string; file?: string; by?: string }) =>
        run(planRespond(id, ops, opts, io)),
    );
  plan
    .command("task")
    .description("Set a task's status while the plan is carried out")
    .argument("<id>", "the plan's ID")
    .argument("<task>", "the task's ID, such as t1")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-s, --status <status>", "todo, doing, done, or skipped", "done")
    .option("--note <text>", "what happened")
    .action((id: string, task: string, opts: { model?: string; status?: string; note?: string }) =>
      run(planTask(id, task, opts, io)),
    );

  program
    .command("check")
    .description(
      "What's wrong or stale: model problems, undeclared dependencies, rules, stale paths, Triage records, and sealed facts whose code changed. With --base, what the change does",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option(
      "-b, --base <ref>",
      "mark what changed since this ref introduced, and fail only on that",
    )
    .option(
      "-f, --format <format>",
      "text, markdown, json, or github (workflow annotations on the diff)",
      "text",
    )
    .option("--fail-on <severity>", "error, warning, or never", "error")
    .option("--no-code", "check the model only, without analyzing code")
    .option("--all", "list every finding, not only the change's (or the first few)")
    .option("--seals", "only facts whose sealed code changed, in full; exits 1 while there are any")
    .option(
      "--done",
      "whether a new model is done: what it still lacks (levels, descriptions, test code, unconnected elements, actors, journeys, steps); exits 1 while anything is",
    )
    .action(
      (opts: {
        model?: string;
        base?: string;
        format?: string;
        failOn?: string;
        code?: boolean;
        all?: boolean;
        seals?: boolean;
        done?: boolean;
      }) => run(check(opts, io)),
    );

  program
    .command("seal")
    .description(
      "Record that the model still describes the code these facts point at (archdoc.sum); without facts, seal the new ones",
    )
    .argument("[facts...]", "facts to seal, such as element:toolchain.cli, or an element ID")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--all", "seal every fact, changed or not (to start, or after checking them all)")
    .option("--by <who>", "who checked, such as agent:claude-code")
    .option("--dry-run", "say what would be sealed without writing archdoc.sum")
    .action(
      (facts: string[], opts: { model?: string; all?: boolean; by?: string; dryRun?: boolean }) =>
        run(seal(facts, opts, io)),
    );

  program
    .command("report")
    .description("The architectural impact of a change, as markdown for a pull request comment")
    .requiredOption(
      "-b, --base <ref>",
      "the branch or commit the change is compared with, such as main, or a model file",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .option("--no-diagrams", "leave out the Mermaid diagrams of the change and its journeys")
    .option("--explorer-url <url>", "a page that shows this change in the explorer, to link to")
    .action(
      (opts: {
        model?: string;
        base?: string;
        format?: string;
        diagrams?: boolean;
        explorerUrl?: string;
      }) => run(report(opts, io)),
    );

  program
    .command("diff")
    .description(
      "What changed in the model: actors, elements, relationships, journeys, data, rules",
    )
    .argument(
      "[range]",
      "HEAD (default), a ref, a..b, a...b (what a pull request shows), or a model file",
    )
    .argument("[after]", "with a model file as the range, the model file to compare it with")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "text, markdown, mermaid, or json", "text")
    .option("--exit-code", "exit 1 when the model changed")
    .action(
      (
        range: string | undefined,
        after: string | undefined,
        opts: { model?: string; format?: string; exitCode?: boolean },
      ) => run(diff(range, opts, io, after)),
    );

  program
    .command("sync")
    .helpGroup("Experimental, sharing models across repos:")
    .description(
      "Pin the model's imports in archdoc.lock and vendor other repos' models, then check references into them",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option(
      "-u, --update [namespaces...]",
      "move imports (all, or the ones named) to the newest version their range allows",
    )
    .option("--frozen", "change nothing; fail if archdoc.lock doesn't match imports (for CI)")
    .action((opts: { model?: string; update?: boolean | string[]; frozen?: boolean }) =>
      run(sync(opts, io)),
    );

  program
    .command("publish")
    .helpGroup("Experimental, sharing models across repos:")
    .description("Write a versioned, validated bundle of the model for other repos to import")
    .argument("[version]", "release version, such as 5.2.0 (default: the release tag on HEAD)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-o, --out <dir>", "directory to write the bundle to, or - for stdout", "dist")
    .action((version: string | undefined, opts: { model?: string; out?: string }) =>
      run(publish({ ...opts, version }, io)),
    );

  const landscape = program
    .command("landscape")
    .helpGroup("Experimental, sharing models across repos:")
    .description("Compose every repo's model into one landscape (run in the landscape repo)");
  landscape
    .command("build")
    .description("Check the composed landscape and write a static explorer site for GitHub Pages")
    .argument("[path]", "the landscape repo, .archdoc directory, or model file", ".")
    .option("-o, --out <dir>", "directory to write the site to", "site")
    .option("--force", "write the site even when the landscape has errors")
    .action((path: string, opts: { out?: string; force?: boolean }) =>
      run(landscapeBuild(path, opts, io)),
    );

  program
    .command("migrate")
    .helpGroup("Other commands:")
    .description(
      "Convert a v1 model (users and components, from ArchDoc 0.2 and earlier) to the current format",
    )
    .argument("<file>", "v1 model file")
    .option("-n, --namespace <namespace>", "namespace for the model (default: from the file name)")
    .option("--name <name>", "display name for the model")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action((file: string, opts: { namespace?: string; name?: string; out?: string }) =>
      run(migrate(file, opts, io)),
    );

  program
    .command("schema")
    .description("Print the JSON Schema for v2 model files, for editor validation")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action((opts: { out?: string }) => run(schema(opts, io)));

  return program;
}
