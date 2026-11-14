# Contributing to ArchDoc

Thanks for helping! [The documentation](https://archdoc.github.io) says what ArchDoc does, and [`docs/revival/`](./docs/revival/README.md) has the design notes behind it: what we're building and why. A change to anything [COMPATIBILITY.md](./COMPATIBILITY.md) covers needs a major version, or an additive change that keeps the old behavior.

## Ground rules

- **Dogfood.** ArchDoc models itself in [`.archdoc/`](./.archdoc). If your change adds, removes, or moves a package or a dependency between packages, update the model in the same PR.
- **The core stays deterministic.** `@archdoc/core` contains no LLM calls and no network access. Surfaces (CLI, MCP, web, Action) are thin adapters over core.
- **People approve, agents suggest.** Facts that an analyzer or an agent produces carry `provenance`. They become real only through a reviewed diff.
- **Exit tests, not dates.** A phase is done when its exit test passes on a real repo.

## Setup

You need Node 22.12+ (or 24) and pnpm 10.

```bash
corepack enable
pnpm install
```

| Command | What it does |
|---|---|
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Apply Biome fixes and formatting |
| `pnpm typecheck` | `tsc -b` for every package (also builds `dist/`), then typechecks tests and the explorer |
| `pnpm build` | Builds the packages and the explorer (`apps/web/dist`) |
| `pnpm test` | Vitest, run against package sources |

CI runs lint, typecheck, and test on Node 22 and 24 with `CI=true`.

### Working on the explorer

Run the model server and the Vite dev server side by side. Vite proxies `/api` to the CLI and hot-reloads the UI:

```bash
pnpm build
pnpm archdoc view --watch --port 4321     # terminal 1
pnpm -F @archdoc/web dev                  # terminal 2, then open the URL it prints
```

The graph logic in `apps/web/src/graph/` is plain TypeScript with tests in `apps/web/test/`. Keep decisions about what's visible there, not in components.

## Making a change

1. Open or find an issue. For a change to the model format, use the **Spec change** template so the discussion happens before the code.
2. Branch from `main`, and keep the PR focused on one change.
3. Add or update tests next to the code (`packages/*/test`).
4. If the change affects a published package, run `pnpm changeset` and commit the generated file.
5. Open the PR. CI must be green before review.

## Releasing

Releases go out from `main` through [`.github/workflows/release.yml`](./.github/workflows/release.yml), and npm holds each one until a maintainer approves it.

1. Changes that affect a published package come with a changeset (`pnpm changeset`).
2. On `main`, the workflow keeps a "chore: version packages" pull request up to date: the new versions and changelogs from the pending changesets.
3. Merging it runs the release: a clean build (`pnpm clean && pnpm build`), the packed-package check (`pnpm smoke`), then `pnpm release`, which packs each package whose version isn't on npm yet and stages it with `npm stage publish`. npm authenticates the workflow with trusted publishing, so there's no token, and adds provenance. Only the `stage` job can do this: it runs in the `npm` environment, which each package's trusted publisher names, and it can't write to the repository; the job that keeps the version pull request can write but can't speak for npm.
4. A maintainer approves the staged versions with two-factor authentication: `npm stage list`, then `npm stage approve`, or on npmjs.com. Approve in dependency order (`spec`, `core`, `analyzers`, `federation`, `mcp`, `cli`), so the CLI never goes live before what it needs. `pnpm approve-staged` does this for you: it lists the staged versions, asks once, and approves each in that order.

5. Then [`.github/workflows/publish.yml`](./.github/workflows/publish.yml), which runs hourly and on demand (`gh workflow run publish.yml`), finishes the release once every package is live on npm: it tags the commit that set the version `v<version>`, writes the GitHub release from the changelogs (`node scripts/release-notes.mjs <version>` prints it), and moves the `release` branch there. The Claude Code marketplace installs the plugin from `release`, so the plugin never runs a CLI that isn't on npm yet.

A change that breaks something [COMPATIBILITY.md](./COMPATIBILITY.md) covers needs a `major` changeset. A new field in the model format also raises `SPEC_VERSION`'s minor version (`2.1`), so older releases ask their users to upgrade instead of calling the field unknown.

All six packages share one version (a Changesets `fixed` group), and each release is tagged `v<version>`. The relaunch jumped from 0.1.1 to 0.3.0, because the v0 viewer's tags already use `v0.1.2` to `v0.2.0`. For a version Changesets can't reach like that, `pnpm set-version <x.y.z> "<changelog note>"` sets all six by hand and validates the result.

Each package's trusted publisher on npmjs.com is this repository, `release.yml`, and the environment `npm`; the `npm` environment on GitHub allows only `main`. Check one with `npx npm@latest trust list <package>`.

`pnpm release --dry-run` packs and lists what would be staged, without staging. To publish by hand instead, use `pnpm -r publish` from a clean, committed `main`, never `npm publish`, which would leave `workspace:*` in the dependencies.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): …`, `fix(cli): …`, `docs: …`, `chore: …`. The scope is the package name without `@archdoc/`.

## Code of conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By taking part, you agree to uphold it.
