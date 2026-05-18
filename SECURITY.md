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

## Secret Rotation

Rotate secrets regularly using the CLI:

```bash
# Rotate auth secret used for JWT token signing
glearn secrets rotate glearn_auth_secret

# Rotate MCP bootstrap token
glearn secrets rotate glearn_mcp_token

# Rotate health shutdown token
glearn secrets rotate health_shutdown_token

# List all secrets
glearn secrets list
```

Secrets are stored in `GLEARN_SECRET_DIR` (default: `~/.glearn/secrets/`). Each rotation increments the version and records the timestamp. Rotate auth secrets:
- Immediately if compromised or suspected compromise
- On a regular schedule (e.g., quarterly) for production deployments
- Before deploying to new environments

After rotating `glearn_auth_secret`, restart the MCP server to use the new signing key. After rotating `glearn_mcp_token`, update any clients using the bootstrap token.
