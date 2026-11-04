---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Better system discovery for a new model. `archdoc check --done` (`archdoc_check` with `done: true`) says whether a model is done and what it still lacks, each with what to do: levels over the limits, elements with no description of their own, test and verification code modeled as elements, elements nothing connects to, missing actors, too few or too short journeys, and steps without an action or code, or on a container where a component would lead to the code. `archdoc init` leaves out tests, test packages, mocks, fixtures, benchmarks, smoke checks, and test-runner config. The archdoc skill has the agent find how each unconnected element is reached at runtime, list the entry points, trace the main flows through the code as journeys with a step per hop, and run the done check before it hands the model over. `scoreDiscovery` scores the same things for the evals.
