# GLearn Security Model

GLearn processes execution evidence and optimization proposals. Its security posture focuses on
keeping learning evidence auditable, protecting secrets in task data, and preventing unauthorized
proposal approval.

## Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| CLI user to local process | Unauthorized learning cycles, proposal approval, or unsafe flag values | OS user permissions, deployment policy, and validation for endpoint, path, ID, budget, and window flags. |
| MCP client to GLearn | Write-tool abuse | Token authentication, read/write scope checks, token-hash permission grants, and per-token rate limits. |
| GLearn to stack services | Upstream outage or malicious data | Circuit breakers, health checks, schema validation. |
| GLearn to persistence | Tampered learning evidence | SQLite transactions, append-only receipts, audit logs. |
| GLearn to logs/metrics | Sensitive prompt leakage | Structured logging and PII redaction. |
| Public health endpoint | Shutdown abuse or endpoint flooding | Bearer-protected shutdown and per-client rate limits. |

## Secrets And Rotation

Secrets must come from the local file-backed secret manager or a deployment secret source. The file
secret manager reads `GLEARN_SECRET_DIR` or defaults to `~/.glearn/secrets`; legacy environment
variables are accepted only as a migration fallback. Never commit API keys, database passwords,
webhook URLs, or signing keys. The privacy quality gate scans docs and source for common secret
patterns.

Use `glearn secrets rotate <name>` to generate a new value, or pass `--value` when a deployment
system has already generated it. `glearn secrets list` prints only names, versions, timestamps, and
sources. It never prints secret values. The legacy `api-key` command now stores provider keys in the
same secret manager.

## Proposal Approval

High-impact proposals must not auto-apply. Approval records should include reviewer identity,
timestamp, evidence, and rollback criteria. MCP hosts should treat `glearn_approve` as a privileged
write operation.

Configure MCP auth with `glearn_mcp_token` in the secret manager. For multi-user deployments, set
`GLEARN_PERMISSIONS_FILE` to a JSON file containing SHA-256 token hashes:

```json
{
  "tokens": {
    "sha256-token-hex": ["read"],
    "sha256-admin-token-hex": ["read", "write", "admin"]
  }
}
```

The permission file narrows granted scopes; it does not expand bootstrap or issued-token scopes.
Requests that fail authentication, scope checks, or rate limits fail closed.

## Receipts And Audit Logs

Receipts and audit logs can contain task metadata and model evidence. Production deployments should
store them in access-controlled locations and ship structured logs to centralized monitoring with
appropriate retention.

Security-relevant MCP denials and rate-limit events are written to the local JSONL audit stream
with redaction applied before persistence. Receipts are redacted before signing and writing.

## Network Posture

Prefer local or private-service networking for GBrain, GStack, GOrchestrator, GMirror, and GToM
endpoints. Do not expose GLearn MCP directly to public networks without TLS, authentication,
authorization, rate limits, and request logging.

The health server exposes `/health/live`, `/health/ready`, and `/health/shutdown`. Shutdown requires
the `health_shutdown_token` secret and all health routes share the `GLEARN_HEALTH_RATE_LIMIT_RPM`
per-client limit.
