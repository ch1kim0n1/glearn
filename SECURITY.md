# GLearn Security

GLearn mines cross-tool patterns and proposes improvements. It must avoid unsafe autonomous modification and treat historical tool data as sensitive operational telemetry.

## Principles

- Do not hardcode credentials, tokens, private endpoints, or secrets.
- Treat pattern evidence, proposals, and backtest results as sensitive system data.
- Keep proposal generation advisory unless explicitly approved by a human or policy gate.
- Fail closed on malformed pattern, proposal, counterfactual, or MCP contracts.
- Do not allow autonomous self-modification without auditable approval.

## Checks

Run:

```bash
npm run check:privacy
npm run check:mcp-contract
npm run verify
```

Before release, run `npm run ci:local` to include build and CLI smoke checks.
