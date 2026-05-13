# Contributing to GLearn

GLearn changes must preserve pattern, proposal, counterfactual, and approval contracts unless tests and docs are updated at the same time.

## Development Flow

1. Install dependencies with `npm install`.
2. Change source under `src/` and tests under `test/`.
3. Run `npm run verify`.
4. Run `npm run ci:local` for release-level changes.

## Quality Requirements

- Add tests for new pattern types, proposal logic, backtest behavior, or MCP tools.
- Keep README, ARCHITECTURE, TESTING, and OPERATIONS aligned with implementation.
- Do not commit focused tests or secrets.
- Keep eval scripts and package scripts available for local audit loops.
