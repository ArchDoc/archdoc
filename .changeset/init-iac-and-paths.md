---
"@archdoc/analyzers": patch
"@archdoc/core": patch
"@archdoc/cli": patch
"@archdoc/mcp": patch
---

`archdoc init` reads the AWS CDK and Terraform. It models the DynamoDB tables (with what each stores, keyed the way the table is), SQS queues, SNS topics, and the AWS services the code calls (such as SES), adds the uses the IAM grants and SDK calls show, places each function, table, and queue in an environment per CDK stack or Terraform workspace, and adds a scheduler actor for scheduled jobs. Every element now sits inside a system, so the explorer's Context view shows one box. Init writes actors and environments to files of their own, and tells the agent which docs and deployment files to read first and where flows start.

New: `archdoc paths` (and the `archdoc_paths` MCP tool) lists where flows start (API routes, queue consumers, schedules, CLI commands, and pages, from the code and from CDK and Terraform) and the calls each one makes, down to the datastores, queues, and services it touches, in TypeScript, Python, and Go. The agent uses it to trace journeys instead of writing scripts to explore the repository.

`archdoc check --done` asks for more before a model is done: a system element, a journey per main flow (and for most routes, consumers, and schedules), what each step that crosses into another container, a datastore, a queue, or an external carries, what each datastore stores, and an environment for every container, datastore, and queue when the repository has deployment files. The skill asks for the same.
