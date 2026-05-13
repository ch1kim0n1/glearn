# GLearn — Meta-Learning and Reflective Layer

The strategist of the G-Stack. GLearn reads across everything the other tools have accumulated, identifies higher-order patterns, and produces structured proposals to refine configurations, profiles, and calibration weights.

## What It Does

- **Cross-tool pattern mining**: Identify patterns only visible at scale across GOrchestrator, GMirror, GToM data
- **Drift detection**: Detect when performance metrics change over time
- **Coverage gap analysis**: Find gaps in persona/scenario coverage
- **Hypothesis generation**: Propose specific refinements to tool configurations
- **Counterfactual evaluation**: Backtest proposals against historical data
- **Proposal lifecycle management**: Track proposals from emission to acceptance to rollback

## Core Constraint

GLearn is **not autonomous**. Every refinement above a defined impact threshold requires human (or owning-tool) approval. There is no autonomous self-modification path. GLearn is batch-mode, not real-time, and runs on cadences from nightly to monthly.

## Installation

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
# Run pattern mining on accumulated data
glearn mine --since "2026-01-01"

# Generate configuration proposals
glearn propose --tool gorchestrator --scope sampling

# Backtest a proposal against historical data
glearn backtest --proposal-id abc123 --since "2026-01-01"

# View active proposals
glearn proposals list --status pending

# Apply an approved proposal
glearn proposals apply --proposal-id abc123
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `mine` | Run pattern mining on accumulated data |
| `propose` | Generate configuration proposals |
| `backtest` | Backtest proposals against historical data |
| `proposals` | Manage proposal lifecycle |
| `patterns` | View detected patterns |
| `drift` | View drift detection results |

## Configuration

GLearn uses a configuration file (default: `~/.glearn/config.json`) to define:

- **Data sources**: GBrain endpoint, data retention policies
- **Mining cadence**: How often to run pattern mining
- **Proposal thresholds**: What impact level requires approval
- **Backtest window**: Historical data window for backtesting
- **Rollback triggers**: When to auto-rollback a proposal

Example configuration:

```json
{
  "dataSources": {
    "gbrain": "http://localhost:3000",
    "retentionDays": 90
  },
  "mining": {
    "cadence": "daily",
    "minDataPoints": 100
  },
  "proposals": {
    "approvalThreshold": "medium",
    "autoApplyBelow": "low",
    "rollbackOnRegression": true
  },
  "backtest": {
    "windowDays": 30,
    "minConfidence": 0.7
  },
  "drift": {
    "detectionThreshold": 0.2,
    "minDataPoints": 50
  }
}
```

## Architecture

GLearn consists of several core modules:

- **PatternMiner**: Statistical and structural pattern mining across cross-tool data
- **DriftDetector**: Detects when metrics change significantly over time
- **CoverageAnalyzer**: Identifies gaps in persona/scenario coverage
- **ProposalGenerator**: Generates specific, typed proposals for tool refinements
- **CounterfactualEvaluator**: Backtests proposals against historical data
- **ProposalLifecycle**: Manages proposal state from emission to acceptance to rollback

## Pattern Types

GLearn detects several pattern types:

1. **Configuration optimization** — High-cost or low-success configurations
2. **Coverage gap** — Scenarios or personas not adequately tested
3. **Cross-tool correlation** — Correlations between tools (e.g., cost vs. correctness)
4. **Drift detection** — Metrics changing significantly over time
5. **Failure mode redundancy** — Same failure patterns appearing repeatedly
6. **Persona performance** — Performance variation by synthetic user persona
7. **Scenario difficulty** — Scenarios that are consistently problematic

## Proposal Types

GLearn generates proposals for:

- **GOrchestrator**: Sampling strategies, configuration budgets, concurrency limits
- **GMirror**: Population composition, scenario generation, scoring thresholds
- **GToM**: Vulnerability thresholds, authenticity scoring, ICE sensitivity
- **GStack**: Skill routing, model selection, tool preferences

Each proposal includes:
- Target tool and scope
- Specific change (e.g., "increase exploit strategy to 0.4")
- Expected impact
- Confidence score
- Backtest results
- Acceptance criteria

## MCP Integration

GLearn exposes an MCP server for Claude Code integration:

```json
{
  "mcpServers": {
    "glearn": {
      "command": "glearn",
      "args": ["mcp"]
    }
  }
}
```

Exposed tools:
- `glearn_mine` — Run pattern mining
- `glearn_propose` — Generate proposals
- `glearn_backtest` — Backtest proposals
- `glearn_patterns` — Query detected patterns
- `glearn_proposals` — Manage proposals

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Full verification
npm run verify

# Watch mode
npm run dev
```

## Testing

GLearn includes comprehensive test coverage:

- Unit tests for core modules (pattern miner, proposal generator, counterfactual evaluator)
- Pattern detection tests with various data shapes
- Proposal generation tests for different tools
- Backtest validation tests
- Drift detection tests

Run tests:

```bash
npm test                    # All tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

## Environment Variables

- `GBRAIN_ENDPOINT` — Override GBrain endpoint
- `MINING_CADENCE` — Override mining cadence
- `APPROVAL_THRESHOLD` — Override approval threshold
- `BACKTEST_WINDOW_DAYS` — Override backtest window

## Contributing

See `ARCHITECTURE.md` for detailed design documentation.

## License

MIT
