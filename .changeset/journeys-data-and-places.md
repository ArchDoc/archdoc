---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/cli": patch
"@archdoc/mcp": patch
---

Journeys go from one element to the next. A new warning, `journey/disconnected-step`, flags a step that starts at an element no earlier step reached (an actor, or an external system acting on its own, may start a step any time), and the skill tells agents to read the code between two elements rather than jump. In the explorer, a step that doesn't follow a use is drawn straight across between its boxes, in red, instead of looping around the map, and its panel shows the error; a step's note shows on one line when a use and a subscription join the same boxes.

Actors have a new kind, `system`, for software that calls in on its own: another service, a scheduler or CronJob, a CI job, a webhook sender. `agent` is for AI agents. `archdoc init` makes the scheduler it finds in Terraform and CDK a `system`, `archdoc check --done` asks about an `agent` whose description doesn't say it's an AI, and the explorer colors and names each kind.

`archdoc check --done` asks for the fields of every data entry that has neither fields nor a schema `source:` (`done/data-fields`), and the skill tells agents where to find each one's definition. The discovery score counts data entries with fields and journey steps that start where the flow already is.

Infrastructure sits in one logical place: `deploy/loose-placement` warns when an element is deployed to an environment or node that has nodes inside it (`dev` beside `dev.aws.lambda`), and `deploy/split-node` when one service has two nodes in an environment (`dev.lambda` and `dev.aws.lambda`).

The explorer's Data tab opens on where the data lives: each datastore and queue with its tables, keys, the entry each holds, and who writes and uses it, then what travels between the parts. Each entry has a page with its schema, where it's stored, who makes and gets it, the journey steps that send or write it, and related entries; Map shows it on the system map as before. The map's key and its layout direction are one box, "Key and layout".

`archdoc init` keeps one app in one container: a workspace below the top of the repository (a Go server's `web/ui` with its app and modules) is one container with its packages as components, and a Go module's binary named after the module (`cmd/prometheus` in `github.com/prometheus/prometheus`) is one container with the module's packages. The skill says the same for when init can't tell.
