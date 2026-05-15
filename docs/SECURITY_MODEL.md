# GLearn Security Model

GLearn processes execution evidence and optimization proposals. Its security posture focuses on
keeping learning evidence auditable, protecting secrets in task data, and preventing unauthorized
proposal approval.

## Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| CLI user to local process | Unauthorized learning cycles or proposal approval | OS user permissions and deployment policy. |
| MCP client to GLearn | Write-tool abuse | Host authentication and write-scope enforcement. |
| GLearn to stack services | Upstream outage or malicious data | Circuit breakers, health checks, schema validation. |
| GLearn to persistence | Tampered learning evidence | SQLite transactions, append-only receipts, audit logs. |
| GLearn to logs/metrics | Sensitive prompt leakage | Structured logging and PII redaction. |

## Secrets

Secrets must come from environment variables or secret stores. Never commit API keys, database
passwords, webhook URLs, or signing keys. The privacy quality gate scans docs and source for common
secret patterns.

## Proposal Approval

High-impact proposals must not auto-apply. Approval records should include reviewer identity,
timestamp, evidence, and rollback criteria. MCP hosts should treat `glearn_approve` as a privileged
write operation.

## Receipts And Audit Logs

Receipts and audit logs can contain task metadata and model evidence. Production deployments should
store them in access-controlled locations and ship structured logs to centralized monitoring with
appropriate retention.

## Network Posture

Prefer local or private-service networking for GBrain, GStack, GOrchestrator, GMirror, and GToM
endpoints. Do not expose GLearn MCP directly to public networks without TLS, authentication,
authorization, rate limits, and request logging.
