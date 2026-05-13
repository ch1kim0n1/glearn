# GLearn Testing Guide

## Test Structure

```
test/
├── pattern-miner.test.ts       # PatternMiner tests
├── proposal-generator.test.ts  # ProposalGenerator tests
└── counterfactual.test.ts       # CounterfactualEvaluator tests
```

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test pattern-miner.test.ts
```

## Test Categories

### Unit Tests

**PatternMiner** (`test/pattern-miner.test.ts`)
- MinePatterns returns array
- MinePatterns returns empty array when no data ingested
- All returned patterns have required fields (UUID, type, confidence, evidence, source tools, description)
- Detects high-cost configuration as configuration_optimization
- Does NOT flag low-cost configurations as optimization
- Generates coverage_gap pattern when GMirror failure rate is high
- Does NOT generate coverage_gap when failure rate is low
- Produces cross_tool_correlation for strongly correlated data
- Detects drift_detection when vulnerability changes significantly
- GetPatterns returns same as last minePatterns
- GetPatternsByType filters correctly
- ClearPatterns empties stored patterns

**ProposalGenerator** (`test/proposal-generator.test.ts`)
- Generates proposals with required fields
- Creates proposals for different tools
- Includes expected impact and confidence
- References supporting patterns

**Counterfactual** (`test/counterfactual.test.ts`)
- Backtests proposals against historical data
- Compares proposed vs actual outcomes
- Validates expected impact

## Test Data Fixtures

Test helpers create minimal valid objects:

```typescript
function makeOrchestratorData(overrides?: Partial<GOrchestratorData>): GOrchestratorData { ... }
function makeMirrorData(overrides?: Partial<GMirrorData>): GMirrorData { ... }
function makeGToMData(states: Array<{ overall_vulnerability: number }>): GToMData { ... }
```

## Coverage Goals

- Core modules: > 90%
- Pattern detection tests: > 85%
- Overall: > 85%

## Adding Tests

1. Create test file in `test/`
2. Import from `@jest/globals`
3. Use `describe`, `it`, `expect`, `beforeEach`
4. Follow existing test patterns
5. Add helpers for fixture creation

## CI Testing

```bash
npm run verify    # typecheck + test
npm run ci:local  # verify + build
```
