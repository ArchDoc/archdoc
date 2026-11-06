---
"@archdoc/core": minor
---

`archdoc check --done` flags a model's shape, not only what it's missing, so an agent fixes what a reader trips over before handing the model over: a queue or datastore that uses its own consumers, an element that uses its own parent or child, the same call listed to an element and to a part inside it, a child whose code isn't inside its parent's, siblings whose `code:` claims the same files (a `code: **`), a one-file helper component in a big container, generated code (protobuf and gRPC stubs) modeled as a part, deployment files no environment maps, datastores and queues outside the system, and numbered copies of data entries (`CartItem2`). `scoreDiscovery` scores them as four new parts: uses shape, code shape, deploy mapped, and data distinct. `genproto/` and `__generated__/` directories count as generated code.
