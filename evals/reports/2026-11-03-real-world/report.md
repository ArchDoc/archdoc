# Real-world evals, 2026-11-03

First run of `pnpm eval:agent --set real-world`: the five repositories in
`evals/real-world/`, one agent run each, judged by `claude-opus-5-5` (three
passes, median kept). Run in a Claude Code cloud session with the default
agent model, on `claude/project-thread-paiceo` at 7f1460d. Two runs
(eshop, online-boutique) were rerun after the judge crashed on Prometheus's
model (fixed: the judge prompt now goes on stdin).

Before trusting the judge, it was calibrated on the five fixtures
(`calibration.md`): it ranks golden above init above a single blob on all
five, and its passes never disagree by more than one point.

## Results

Recall is against each repository's partial reference (mean of the
containers, components, datastores, uses, nesting, and code recalls that
apply). Judge dimensions are 1 to 5; digestibility is their mean mapped onto
0 to 100%. Onboarding is how many newcomer questions the judge answered with a
component that covers the answer; files is how many files that component
covers (the median).

| Repository | Recall init → agent | Turns | Agent cost | Digestibility | Fidelity | Granularity | Coverage | Relationships | Infrastructure | Descriptions | Journeys | Onboarding | Files | Judge cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gson | 60% → 60% | 30 | $0.17 | 36% | 2 | 1 | 3 | 2 | 5 | 2 | 2 | 5 of 5 | 86 | $0.68 |
| prometheus | 69% → 69% | 47 | $0.28 | 14% | 2 | 1 | 2 | 2 | 1 | 1 | 2 | 6 of 6 | 88 | $2.28 |
| stripe-accept-a-payment | 41% → 41% | 18 | $0.16 | 11% | 1 | 1 | 2 | 2 | 1 | 1 | 2 | 2 of 5 | 26 | $0.77 |
| eshop | 62% → 67% | 81 | $0.42 | 25% (init 7%) | 2 | 1 | 3 | 2 | 1 | 2 | 3 | 5 of 5 | 16 | $2.07 |
| online-boutique | 60% → 78% | 21 | $0.31 | 50% (init 4%) | 4 | 3 | 2 | 3 | 1 | 4 | 4 | 3 of 5 | 11 | $0.71 |

Total: $1.34 for the agents, $6.51 for judging, $2.79 for calibration.

## What the runs show

- **The agent stops early and doesn't restructure.** Every run ended on its
  own after 18 to 81 turns and $0.16 to $0.42, far under the caps, saying
  the model was "only partly done". On gson, Prometheus, and the Stripe sample
  it left init's structure as it was (recall unchanged); it wrote some
  descriptions and a journey or two and stopped. The skill's step 2 says to
  describe each element and to "merge or split" where needed, but gives no
  target shape and no definition of done beyond `archdoc check` passing.
- **Granularity is the worst dimension everywhere (1 of 5 on four repos).**
  Init's every-layer sweep leaves per-file code elements (about 85 on gson),
  per-config-file components (`vite-config`, `eslint-config`,
  `tailwind-config`), test modules as containers, and on Prometheus four
  separate UI packages with their own components. Prometheus's model is
  240 KB of YAML; that's also why judging it cost $2.28.
- **Variants of one thing are listed flat.** The Stripe sample's servers in
  ten languages and clients in five became dozens of containers named after
  their package.json files, with 27 payment-method components; none of the
  four integrations the README names exists in the model.
- **Infrastructure is missing (1 of 5 on four repos).** Only compose files
  produce datastores, so Redis, Postgres, and RabbitMQ in eShop's Aspire host
  and Redis in Online Boutique's Kubernetes manifests never appear, and the
  agent didn't add them. No run mapped Kubernetes, Helm, Kustomize, Terraform,
  or Aspire definitions to what they deploy.
- **Names come from build files.** gson's modules became `gson-parent-2`,
  `gson-parent-3`, ... (the Maven parent's artifact ID), which the agent kept.
- **Onboarding answers land, but on big elements.** The judge found the
  answer in 21 of 26 questions, but the component it pointed to covered a
  median of 86 to 88 files on gson and Prometheus.
- **Online Boutique went best**: init's containers already matched the
  services, so the agent spent its turns on uses (0% → 88%), descriptions,
  and journeys.

## What to change in the skill for 0.5.1

1. Restructure before describing: give the target shape (about 3 to 12
   top-level elements, 3 to 10 children each), and say to fold per-file code
   elements and build-config files into their component, drop or mark test
   and tooling modules, and rename elements init named after build files.
2. Group variants: one element per thing the README names, with the
   language variants as its technology or as children, not as siblings.
3. Find infrastructure init can't: datastores, queues, and externals from
   Aspire hosts, Kubernetes manifests, Terraform, and connection strings;
   map deployment definitions to the elements they deploy.
4. Define done: the shape above, every element described, uses at the
   component level and through queues, two or three journeys. Not just a
   passing check.

Init issues worth fixing alongside (no new features): build-config files
becoming components, and Maven module IDs from the parent's artifact ID.

## Caveats

- One run per repository, so the spread between runs is unknown.
- Read-only shell commands (`cat`, `grep`, `git ls-files`) still run without
  being allowed: Claude Code allows them in any mode. The agent now has only
  the file tools, Bash, and the archdoc tools (`--tools`), and no settings
  from the calling session.
- Init-only judge scores exist for eshop and online-boutique only; the first
  run crashed before it judged init on the other three.
