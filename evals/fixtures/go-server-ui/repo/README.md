# Pulse

Pulse checks that HTTP endpoints are up. The **Pulse server** probes each
target on its interval, keeps the results in its local store, evaluates alert
rules over them, and posts firing alerts to a webhook. It serves an HTTP API
and the **web UI**, where operators see targets, run queries, and see alerts.

`pulsectl` is the command-line tool: it checks a config file and runs a query
against a store offline.

- `cmd/pulse`: the server's entry point; its packages are at the top of the repository.
- `cmd/pulsectl`: the command-line tool.
- `web/ui`: the web UI, a pnpm workspace with the app, the legacy app, and the query editor module.
