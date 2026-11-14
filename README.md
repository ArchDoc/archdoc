# ArchDoc

**Understand your architecture while AI builds it.**

ArchDoc keeps a model of your system's architecture in your repository, next to the code: who uses the system, what it's made of (each part mapped to the code that implements it), how people reach their goals through it, and what data moves where. Your coding agent reads the model before it edits, so it knows where a change belongs and what it affects, and it updates the model with the code, so the model stays true. You read it in the explorer, starting from what people do.

People own the model. A deterministic engine answers every question about it, with no LLM inside, so the same question gets the same answer in your editor, your terminal, and your agent. Your own coding agent does the reasoning.

Documentation: **[archdoc.github.io](https://archdoc.github.io)**

## Install

**Claude Code.** Install the plugin. It brings the skill and the MCP tools, pinned to a released CLI:

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

Then open a repository and ask Claude to "start an architecture model for this repository". Where there's one already, just start a task: Claude reads the model first.

**Cursor, Codex, and other agents.** Paste a snippet into `AGENTS.md`, copy the skill, and register the MCP server: [`integrations/agent-skills`](./integrations/agent-skills).

**The CLI** runs anywhere with Node.js 22.12 or later, on macOS, Linux, and Windows:

```bash
npx -y @archdoc/cli init     # start a model in this repository
npx -y @archdoc/cli view     # open it in the explorer
```

## What's in a model

A model lives in `.archdoc/`, in one file or as many as the team likes:

| Section | Answers |
|---|---|
| **Actors** | *Who* uses the system: people, roles, teams, partner organizations, and AI agents |
| **Elements** | *What* it's made of: systems, containers, components, and datastores, each mapped to code paths, files, or functions |
| **Journeys** | *How* an actor reaches a goal, step by step across elements, checked against the relationships the model declares |
| **Data** | *With what*: what's sent and stored, sensitive fields, and how values flow between tables |

```yaml
# .archdoc/archdoc.yaml
archdoc: "2.0"
namespace: rides
name: Rides Platform

actors:
  passenger:
    kind: person
    description: Books and pays for rides from the mobile app.
    uses:
      mobile-app: Requests rides, pays, rates drivers

elements:
  mobile-app:
    kind: container
    technology: React Native
    code: [{ path: apps/mobile/** }]
    uses:
      api-gateway: Calls all backend APIs
  api-gateway:
    kind: container
    code: [{ path: services/gateway/** }]

journeys:
  book-a-ride:
    actor: passenger
    goal: Get a ride to a destination
    importance: critical
    steps:
      - { from: passenger, to: mobile-app, action: Enters destination and confirms }
      - { from: mobile-app, to: api-gateway, action: POST /trips }
```

[The model](https://archdoc.github.io/docs/model) covers every part of the format, including data, rules, and where each part runs. ArchDoc's own model is in [`.archdoc/`](./.archdoc).

## What you do with it

- **Start a model.** `archdoc init` writes one from what the repository declares (packages, services, imports, schemas, and infrastructure as code), every fact marked inferred. Your agent then shapes, describes, and traces it until `archdoc check --done` says it's done, and asks you to review it.
- **Change code with your agent.** Each task is context, edit, check, seal: the agent asks `archdoc context` where to start and what the change affects, edits the code and the model together, runs `archdoc check` for what it broke or left stale, and seals the facts it checked. [Agents](https://archdoc.github.io/docs/agents).
- **Explore.** `archdoc view` opens the explorer: journeys as stories, a map one level at a time, data and its lineage, and click-through to code. [Explorer](https://archdoc.github.io/docs/explorer).
- **Triage a bug.** Hand your agent a bug, and it follows it hop by hop to its root cause, in a Triage record drawn on the map. [Triage](https://archdoc.github.io/docs/triage).
- **Plan a change.** Say what you want where on the explorer's map, and your agent works out the architecture with you before it builds. [Plan](https://archdoc.github.io/docs/plan).
- **Keep it honest.** `archdoc check` compares the model with the code: dependencies the model doesn't declare, broken rules and journeys, stale paths, schema drift, and facts whose code changed since someone last checked them.

`archdoc --help` lists every command, and each MCP tool has a CLI command of the same name.

## Privacy

ArchDoc runs on your machine and sends nothing anywhere: no telemetry, no analytics, no accounts. It uses the network only when `npx` downloads it, and when the experimental `archdoc sync` fetches other repositories' models with your own git credentials. The explorer listens on `localhost` only. Your agent reads ArchDoc's answers the way it reads any other tool's, so they go where the rest of your agent's context goes.

## Versions and compatibility

ArchDoc follows semantic versioning. A model that's valid in one 1.x release stays valid in every later one, and the CLI's commands, flags, exit codes, and JSON output, and the MCP tools' names and inputs, don't break in a minor release. [COMPATIBILITY.md](./COMPATIBILITY.md) says exactly what's covered, and [docs/experimental.md](./docs/experimental.md) lists what isn't yet: sharing models across repos, decision rules, and the GitHub Action. Release notes are on [GitHub Releases](https://github.com/ArchDoc/archdoc/releases).

ArchDoc 0.2 and earlier (the `@archdoc/archdoc-ui` viewer) used a different format; `archdoc migrate` converts it. That code is frozen on the [`legacy/v0`](https://github.com/ArchDoc/archdoc/tree/legacy/v0) branch.

## Repository layout

```
packages/
  spec/        @archdoc/spec        the model format: schema (Zod), TypeScript types, JSON Schema, v1 migration
  core/        @archdoc/core        load, validate, diff, and query models (no LLM, no network)
  analyzers/   @archdoc/analyzers   what the code does: dependencies, schemas, entry points
  cli/         @archdoc/cli         the archdoc command, and the server for the explorer
  mcp/         @archdoc/mcp         the MCP server for coding agents
  federation/  @archdoc/federation  sharing models across repos (experimental)
apps/
  web/                              the explorer (React, React Flow, ELK)
integrations/
  claude-plugin/                    the Claude Code plugin (marketplace in .claude-plugin/)
  agent-skills/                     setup for Cursor, Codex, and other agents
  github-action/                    pull request review (experimental)
  landscape-template/               a landscape repo for many teams' models (experimental)
examples/                           one model per part of the format, and examples/org, a demo org
.archdoc/                           ArchDoc's own model
```

## Development

You need Node.js 22.12 or later and pnpm 10 (`corepack enable` sets it up).

```bash
pnpm install && pnpm build
pnpm archdoc view --watch --open   # ArchDoc's own model, from your build
pnpm playground --open             # a demo org of four repositories, in .playground/
pnpm lint && pnpm typecheck && pnpm test
```

[CONTRIBUTING.md](./CONTRIBUTING.md) says how to propose changes, and [SECURITY.md](./SECURITY.md) how to report a vulnerability.

## License

[MIT](./LICENSE)
