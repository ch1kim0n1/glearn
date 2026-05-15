# GLearn Runbook

## Daily Checks

```bash
npm run verify
node dist/cli.js health
node dist/cli.js metrics --format prometheus
node dist/cli.js cost
```

Review health score, failed learning receipts, budget state, and GBrain circuit-breaker events.

## Run A Learning Cycle

```bash
node dist/cli.js run --counterfactual --priority normal
```

Expected result:

- Data ingestion completes or degrades with structured upstream errors.
- Patterns are mined and persisted.
- Proposals are generated with confidence and evidence.
- Counterfactual evaluations run when requested.
- A receipt is appended.
- Metrics, traces, and audit events are emitted.

## Review Proposals

```bash
node dist/cli.js proposals
node dist/cli.js approve <proposal-id> --reviewer ops
node dist/cli.js reject <proposal-id> --reviewer ops --reason "insufficient evidence"
```

High-impact proposals should include baseline metrics, expected impact, and rollback criteria before
approval.

## Backup And Restore

```bash
node dist/cli.js backup ./backups/glearn-$(date +%Y%m%d)
node dist/cli.js restore ./backups/glearn-20260515
```

After restore, run `health`, `patterns`, and `proposals` to verify state continuity.

## Release Checklist

1. `npm run verify`
2. `npm run build`
3. `npm run docs:api`
4. `git diff --check`
5. Confirm `README.md`, `CHANGELOG.md`, and generated API docs match the release.
6. Push to `master`.

## Incident Response

| Symptom | Action |
| --- | --- |
| No patterns found | Check corpus size, GBrain endpoint, and data-store persistence. |
| Proposal quality low | Review pattern confidence, baseline drift, and model-tier escalation. |
| Counterfactual cost high | Disable counterfactual on routine cycles or lower model-tier use. |
| GBrain writes skipped | Check circuit-breaker logs and `GBRAIN_ENDPOINT`. |
| Receipts missing | Check receipt path permissions and disk space. |
| Drift alerts noisy | Inspect metric windows and baseline sample size. |

## Maintenance Cadence

| Cadence | Work |
| --- | --- |
| Daily | Check health, failed receipts, and pending high-impact proposals. |
| Weekly | Run counterfactual cycle on the regression corpus. |
| Monthly | Review baselines, proposal acceptance rate, and pattern-miner thresholds. |
