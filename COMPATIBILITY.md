# Compatibility

From 1.0, ArchDoc follows [semantic versioning](https://semver.org). A model you commit today keeps working, and a CI job or agent setup you write today keeps running, until a major release says otherwise. This page says exactly what that covers.

## Two version numbers

- **ArchDoc's version** (`archdoc --version`, `1.4.2`) is the version of the packages on npm, the Claude Code plugin, and the release tags. Every `@archdoc/*` package and the plugin share it.
- **The model format** is the `archdoc:` line at the top of `.archdoc/archdoc.yaml` (`archdoc: "2.0"`). It counts separately because it changes far less often: ArchDoc 1.x reads format 2.x. Format 1 was the v0 viewer's (`users:` and `components:`); `archdoc migrate` converts it.

`archdoc --version` prints both: `1.0.0 (model format 2.0)`.

## What a minor or patch release won't break

**Your model.** A model that's valid in one 1.x release is valid in every later 1.x release: no field is removed, renamed, or changes meaning. New fields come with a new minor model format (`2.1`), and a file declares that format only when it uses them. An older ArchDoc that meets a newer format stops with `spec/newer-format` and says to upgrade, rather than reporting the new fields as unknown.

**What's in `.archdoc/`.** The formats of `archdoc.sum` (seals), Triage records (`.archdoc/triage/`), and plans (`.archdoc/plans/`) follow the same rule. A release that changes how a fact's code is fingerprinted keeps reading the seals you have and doesn't mark them changed.

**The CLI.** Command names, their arguments and flags, and exit codes stay, and the `--format json` and `--json` output only gains fields. Exit codes are:

| Code | Means |
|---|---|
| 0 | Done, and nothing failed |
| 1 | It ran and found what fails: errors (or, with `--strict` or `--fail-on warning`, warnings) |
| 2 | It couldn't run: a bad flag, or no model where it looked |

**The MCP tools.** Tool names and their input parameters stay; new optional parameters may be added.

## What can change in a minor release

- **New checks.** A minor release can add warnings, so `validate --strict` and `check --fail-on warning` may fail on a model that passed before. It won't turn a valid model invalid: a new error for a model that used to pass waits for a major release.
- **Text meant for reading.** Human-readable output, the wording of messages and of MCP answers, the skill, and the explorer change whenever they can be clearer. Parse `--format json`, not text.
- **New commands, flags, tools, and fields**, as long as what's there keeps working.

## Not covered

- **Anything experimental**, listed in [docs/experimental.md](./docs/experimental.md): sharing models across repos (`imports`, `sync`, `publish`, `landscape`, `archdoc.lock`), mappings and simulation, and the GitHub Action. `archdoc validate` notes when a model uses an experimental part of the format.
- **The JavaScript APIs** of the `@archdoc/*` packages. They're published for the CLI and the MCP server to use, and can change in any release. Install the same version of all of them.
- **Node.js versions.** ArchDoc supports the Node.js releases that are still maintained upstream, from 22.12. Dropping one that's reached end of life happens in a minor release.

## Upgrading

Upgrade the plugin with `/plugin marketplace update archdoc`, or run a newer `npx -y @archdoc/cli@<version>`. Each release's notes are on [GitHub Releases](https://github.com/ArchDoc/archdoc/releases), and each package's `CHANGELOG.md` has the details. When a team shares a model, upgrade together, or at least upgrade before you write a newer model format: an older ArchDoc will ask its users to upgrade.

Upgrading from 0.x: a model that validates with 0.9 validates with 1.0. Triage records from before 0.8, in `.archdoc/traces/`, move with `archdoc triage migrate`.
