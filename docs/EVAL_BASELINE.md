# GLearn Evaluation Baseline

GLearn evaluation focuses on whether learning cycles discover useful, stable patterns and produce
reviewable proposals without exceeding cost or latency budgets.

## Corpus Dimensions

| Dimension | Examples |
| --- | --- |
| Pattern quality | Repeated failures, cost spikes, low-confidence outputs. |
| Proposal relevance | Tool-specific configuration improvements with clear acceptance criteria. |
| Counterfactual quality | Backtests that distinguish useful and harmful proposals. |
| Drift detection | Score, cost, and pattern-count shifts over time. |
| Failure behavior | Missing GBrain, empty corpus, budget exceeded, malformed receipts. |

## Running Evaluations

```bash
node dist/cli.js eval --corpus ./test/baselines/glearn-corpus.json --cycles 10 --output ./tmp/eval.json
npm run eval:summary -- --input ./tmp/eval.json
npm run eval:compare -- --baseline ./test/baselines/regression-baselines.jsonl --input ./tmp/eval.json
```

## Acceptance Thresholds

| Metric | Target |
| --- | --- |
| Pattern precision | `>= 0.80` on seeded corpora. |
| Proposal actionability | `>= 0.75` reviewable proposals. |
| Counterfactual consistency | `>= 0.70` agreement with known outcomes. |
| P95 learning-cycle latency | `< 10 minutes` for production corpora, `< 30s` for unit corpora. |
| Cost per default cycle | `<= $1.00` unless corpus explicitly raises budget. |
| Receipt completeness | `100%` of non-dry-run cycles. |

## Statistical Rules

- Use at least 10 cycles before accepting baseline movement.
- Report Wilson intervals for small samples.
- Treat fewer than 30 samples as small-sample evidence.
- Track cost and latency regressions independently from pattern quality.

## Updating Baselines

Update baselines only with an intentional behavior change and a changelog entry. Keep old baseline
files available for release comparison.
