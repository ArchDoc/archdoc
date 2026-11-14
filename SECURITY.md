# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on
[ArchDoc/archdoc](https://github.com/ArchDoc/archdoc/security/advisories/new).
Please don't open a public issue. We aim to acknowledge a report within three
working days and to agree on a disclosure date with you.

Fixes go into the newest release only, so upgrade to it.

## What runs where

- The **CLI and MCP server** run on your machine with your permissions. They
  read the repository, write the model under `.archdoc/` (and elsewhere only
  where you point `--out`), and reach the network only for `archdoc sync` (the
  repositories `imports` names) and for `npx` itself.
  Git calls refuse URLs and refs that look like options, and the `ext::`
  transport.
- **`archdoc view`** listens on 127.0.0.1 and answers only to `127.0.0.1`,
  `localhost`, and `[::1]` (so a site that rebinds its own name to your machine
  is refused). It writes plans and Triage records, only from JSON its own page
  sends.
- The **GitHub Action** runs the CLI released with it (`npx -y @archdoc/cli@<version>`).
  Pin the action to a release tag or commit, not `@main`.

## How releases are published

Every `@archdoc/*` package is published from `.github/workflows/release.yml` by
npm trusted publishing (OIDC, no npm token), with provenance, and staged:
a maintainer approves each version on npm before it goes live. Check a
version's provenance with `npm audit signatures`.
