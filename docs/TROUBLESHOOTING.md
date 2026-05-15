# GLearn Troubleshooting

## No Patterns Found

Check:

```bash
node dist/cli.js health
node dist/cli.js receipts
node dist/cli.js patterns
```

Common causes are empty input data, GBrain outage, schema mismatch, or a confidence threshold that
is too high for the current sample size.

## Proposal Generation Produces Low-Value Changes

Review the underlying pattern evidence and confidence. Low-value proposals usually mean the input
patterns are too broad, too sparse, or not tied to an owning tool. Run a smaller corpus with seeded
patterns to isolate the issue.

## Counterfactual Evaluation Is Too Expensive

Counterfactual work can trigger additional model calls. Disable it for routine cycles:

```bash
node dist/cli.js run
```

Use `glearn cost` to inspect committed spend and reservations.

## GBrain Is Unavailable

Symptoms include circuit-breaker warnings, timeout logs, and failed health rows. Verify
`GBRAIN_ENDPOINT`, call `/health` directly, then rerun the learning cycle after the circuit-breaker
window expires.

For authenticated or MCP-backed GBrain deployments, also verify `GBRAIN_AUTH_TOKEN`,
`GBRAIN_INTEGRATION_MODE`, and `GBRAIN_MCP_ENDPOINT`. GLearn continues with an empty GBrain context
when the observation stream is unavailable, so check logs for graceful-degradation warnings if a
learning cycle succeeds with no GBrain-derived patterns.

## MCP Contract Check Fails

Run:

```bash
npm run check:mcp-contract
rg "glearn_" src/mcp/server.ts
```

Update the MCP server, tests, and contract documentation together if a tool name changes.

## TypeDoc Generation Fails

Run:

```bash
npx typedoc@0.25.13 --options typedoc.json
```

Fix unresolved entry points or TypeScript syntax first. Warnings about private local types should
be reviewed but do not block docs if public API output is generated.

## Receipts Cannot Be Written

Check directory permissions, disk space, and JSONL lock files. Receipt writes are append-only; do
not edit old receipts to repair a failed cycle.
