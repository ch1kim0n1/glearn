# GLearn API Overview

Regenerate the browsable TypeScript API:

```bash
npm run docs:api
```

Generated output is committed under `docs/api`.

## CLI API

| Command | Inputs | Output |
| --- | --- | --- |
| `glearn run` | Optional time range, counterfactual flag, priority | Learning run summary and receipt. |
| `glearn patterns` | Type/source filters | Mined pattern list. |
| `glearn proposals` | Status/scope filters | Proposal list. |
| `glearn approve <id>` | Proposal id and reviewer metadata | Updated proposal state. |
| `glearn health` | Endpoint/environment config | Health rows and score. |
| `glearn eval` | Corpus path, cycles, output path | Evaluation report. |
| `glearn receipts` | Date and pagination filters | Stored receipts. |
| `glearn drift` | Optional metric name | Drift detector output. |
| `glearn cost` | Detail options | Budget ledger summary. |
| `glearn metrics` | Format options | Prometheus or JSON metrics snapshot. |

## TypeScript API

Primary classes:

- `GLearn` in `src/core/glearn.ts`: learning cycles, pattern/proposal retrieval, health checks,
  receipts, drift, cost, and observability exports.
- `PatternMiner` in `src/core/pattern-miner.ts`: data ingestion and pattern discovery.
- `ProposalGenerator` in `src/core/proposal-generator.ts`: typed proposal creation.
- `CounterfactualEvaluator` in `src/core/counterfactual.ts`: proposal backtesting.
- `GLearnPersistenceManager` in `src/core/glearn-persistence.ts`: SQLite schema and state writes.
- `ReceiptRegistry` in `src/core/receipt-registry.ts`: append-only JSONL receipt storage.
- `BudgetLedger` in `src/core/budget-ledger.ts`: budget reservation and cost accounting.
- `GLearnObservability` in `src/core/observability.ts`: metrics, traces, audit logs, and alerts.

## Learning Run Shape

```ts
type LearningRun = {
  run_id: string;
  run_type: 'pattern_mining' | string;
  status: 'running' | 'completed' | 'failed';
  patterns_found: number;
  proposals_generated: number;
  evaluations_completed: number;
  started_at: string;
  completed_at?: string;
  error_message?: string;
};
```

## Pattern And Proposal Contracts

Patterns capture a repeated signal with confidence, affected tools, and supporting evidence.
Proposals map one or more patterns to a recommended change, expected impact, confidence, and
approval state. High-impact proposals must remain pending until a human or owning tool approves.

## Compatibility

The package follows semver. Existing CLI flags, MCP tool names, and required input fields are
stable within a major version. New optional fields may appear in minor versions.
