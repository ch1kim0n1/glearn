# ADR 0001: GLearn Uses A Human-Approved Learning Loop

## Status

Accepted

## Context

GLearn can discover patterns and propose changes that affect stack behavior, cost, and quality.
Automatically applying those changes would make debugging and accountability harder, especially
when evidence is sparse or model confidence is low.

## Decision

GLearn generates proposals and evidence, but approval remains explicit. High-impact changes must be
reviewed by a human operator or the owning tool. Receipts, proposal state, and audit logs are the
source of truth for why a change was accepted or rejected.

## Consequences

- Operators retain control of stack behavior.
- Proposal quality can be measured independently from application rate.
- GLearn must persist enough evidence for review and rollback.
- MCP write tools require stricter authorization than read-only inspection tools.

## Alternatives Considered

- Fully autonomous proposal application. Rejected because it weakens accountability and rollback.
- No proposal lifecycle tracking. Rejected because it loses the connection between evidence,
  review, and applied changes.
