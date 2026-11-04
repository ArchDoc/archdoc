---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
---

Model where the system runs, and see it in the explorer. A new `environments:` section holds each environment (production, staging, local) and its infrastructure as nodes inside nodes (cloud, region, cluster, namespace, managed service), each with `kind`, `technology`, and the `code` that defines it. Containers, datastores, and queues say where they run with `deploy`: a node's path such as `production.aws.eks`, a list of them, or `{ to, replicas, url, technology, code }`. The explorer's new Infrastructure tab draws one environment at a time, with each container on its node and the uses between them; `archdoc show` prints an environment or a node with what runs on it, and where an element is deployed. `validate` fails on a `deploy` that names nothing and warns about containers that don't say where they run once a model has environments; `check` warns about deployment code that matches no file, and seals flag a node's or deployment's code when it changes.
