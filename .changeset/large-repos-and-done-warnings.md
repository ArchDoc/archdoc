---
"@archdoc/analyzers": patch
"@archdoc/core": patch
"@archdoc/cli": patch
"@archdoc/mcp": patch
---

`archdoc paths` stays readable in a big repository. With more than 60 entry points it answers with a summary: the entry points by place (the container they're in, or their package before there's a model), with counts by kind and routes grouped by resource, each line usually one journey. `entry` takes a place, a resource, or both (`"apps/api /orders"`) to list them, and one label to show its calls. `--hops` (`hops: true`) folds calls that stay inside one element, so a tree shows only the calls between elements. Call trees now follow handlers written as one-line arrows, such as `(req) => save(req)`. Init's brief uses the same summary.

`archdoc check --done` isn't done while `archdoc check` has a warning the code can answer: it counts and lists them with the errors, and sets aside the ones only a person settles (owners, seals, other repositories' models, the team's rules). It also asks for components in a big container and none in a small one, and for a description of each data entry. A new warning, `data/long-name`, flags a data entry whose name is too long for the chip the explorer draws on a step, and the explorer cuts a long name to fit, with the whole name as its tooltip.

`archdoc init` keeps a container with fewer than five source files lean, with no components. A dry run says plainly that it wrote nothing. The skill turns "figure out the architecture" into a model written to `.archdoc/`, works through every warning before it hands the model over, keeps big containers' components when it reshapes init's model, and names data entries with short nouns and a description.
