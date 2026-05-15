# Changelog

All notable changes to GLearn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Eval command with --cycles N support for statistical comparison
- Stats and drift CLI commands
- Comprehensive documentation (runbook)
- Production documentation set covering API usage, MCP contracts, migrations, eval baseline,
  troubleshooting, security model, data flow, integration, ADRs, and generated TypeDoc API output.
- `docs:api` script and TypeDoc configuration for regenerating `docs/api`.
- Typed GBrain integration client for GLearn observation ingestion, stats, health, and receipt writes
  with HTTP/MCP transports, auth, timeouts, retries, circuit breaker, and response validation.

### Changed
- Improved pattern miner performance
- Enhanced proposal generation quality
- GLearn now queries GBrain's takes observation stream before local pattern mining and degrades
  gracefully when GBrain is unavailable.

## [0.1.0] - 2026-05-13

### Added
- Pattern mining, proposal generation, counterfactual evaluation, and learning-cycle foundations
- Jest-based unit, CLI, MCP, and e2e mocked tests
- Quality gates for package contracts, documentation, privacy scanning, test isolation, MCP contracts, and CLI smoke checks
- Eval scripts for local audit history, summary, comparison, and test-tier selection
- MCP server with 5 operations (run, patterns, proposals, approve, health)
- CLI commands: run, patterns, proposals, approve, health
- Integration with GBrain, GStack, GOrchestrator, GMirror, and GToM
- Learning cycle orchestration
