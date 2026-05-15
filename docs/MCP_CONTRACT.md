# GLearn MCP Contract

GLearn exposes learning-cycle and proposal-management operations to MCP clients. The server name is
`glearn`, version `0.1.0`.

## Scopes

| Scope | Tools |
| --- | --- |
| Read | `glearn_patterns`, `glearn_get_patterns`, `glearn_proposals`, `glearn_get_proposals`, `glearn_health`, `glearn_get_receipts`, `glearn_get_drift`, `glearn_get_cost_stats` |
| Write | `glearn_run`, `glearn_approve` |

Write tools can trigger expensive model calls or change proposal state, so MCP hosts should require
explicit authorization before exposing them.

## Tools

### `glearn_run`

```json
{
  "time_range": { "start": "2026-05-01T00:00:00.000Z", "end": "2026-05-15T23:59:59.999Z" },
  "run_counterfactual": true,
  "priority": "normal"
}
```

Runs a learning cycle and returns a `LearningRun`.

### `glearn_patterns` and `glearn_get_patterns`

Return mined patterns. Optional filters may include type, affected tool, confidence floor, or limit.

### `glearn_proposals` and `glearn_get_proposals`

Return generated proposals and lifecycle state.

### `glearn_approve`

```json
{
  "proposal_id": "string",
  "reviewer": "string",
  "notes": "string"
}
```

Marks a proposal approved for the owning tool or operator workflow.

### `glearn_health`

Returns stack health, local diagnostics, and health score.

### `glearn_get_receipts`

Returns recent or date-filtered learning receipts.

### `glearn_get_drift`

Returns drift detector output for one metric or all tracked metrics.

### `glearn_get_cost_stats`

Returns budget reservations, committed spend, expired reservations, and remaining budget.

## Error Contract

Errors should include a readable message, a stable code when available, and retryability. Validation
and authorization errors are not retryable. Upstream network failures may be retryable when the
underlying client marks them retryable.

## Contract Checks

```bash
npm run check:mcp-contract
npm test -- test/mcp.test.ts
```
