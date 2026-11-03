# Judge calibration

2026-11-03T21:56:43.543Z · claude-opus-5-5 · 3 passes per model, median per dimension · $2.79

Digestibility is the mean of the rubric's dimensions, 1 to 5 mapped onto 0 to 100%. The golden model should score highest and the blob lowest.

| Fixture | Golden | Init | Blob | Ordered |
|---|---|---|---|---|
| go-service | 50% | 25% | 4% | yes |
| polyglot | 57% | 25% | 0% | yes |
| python-fastapi | 54% | 29% | 4% | yes |
| single-package | 57% | 43% | 18% | yes |
| ts-monorepo | 64% | 39% | 0% | yes |

By dimension (median over fixtures), golden / init / blob:

- Fidelity: 4 / 2 / 1 (largest spread between passes: 1)
- Granularity: 4 / 2 / 1 (largest spread between passes: 1)
- Coverage: 4 / 3 / 2 (largest spread between passes: 1)
- Relationships: 4 / 3 / 1 (largest spread between passes: 1)
- Infrastructure: 3 / 3 / 1 (largest spread between passes: 1)
- Descriptions: 3 / 1 / 1 (largest spread between passes: 1)
- Journeys: 1 / 1 / 1 (largest spread between passes: 0)
