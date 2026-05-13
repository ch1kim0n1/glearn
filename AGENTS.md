# Agent Guidance for GLearn

GLearn is the meta-learning layer for the G-Stack. Agents should keep learning proposals auditable, reversible, and grounded in evidence.

## Rules

- Preserve MCP tool names and schemas unless intentionally changing public contracts.
- Update tests and docs for all public behavior changes.
- Keep proposal application advisory and approval-gated.
- Run `npm run verify` after edits.
- Run `npm run ci:local` before release-level changes.

## Contract Surfaces

- CLI: `src/cli.ts`
- MCP: `src/mcp/server.ts`
- Pattern mining: `src/core/pattern-miner.ts`
- Proposal generation: `src/core/proposal-generator.ts`
- Counterfactual evaluation: `src/core/counterfactual.ts`
