# GLearn Architecture

## System Overview

GLearn is a batch-mode reflective system that mines patterns across G-Stack data, generates proposals for tool refinements, and backtests them before deployment.

## Core Components

### 1. PatternMiner
**Location**: `src/core/pattern-miner.ts`

Mines statistical and structural patterns:
- Ingests data from GOrchestrator, GMirror, GToM
- Detects configuration optimization opportunities
- Identifies coverage gaps in personas and scenarios
- Finds cross-tool correlations
- Detects drift in metrics over time

### 2. DriftDetector
**Location**: Integrated in PatternMiner

Detects metric drift:
- Compares recent metrics to historical baselines
- Identifies significant changes (> threshold)
- Requires minimum data points for reliability
- Tracks drift direction and magnitude

### 3. CoverageAnalyzer
**Location**: Integrated in PatternMiner

Analyzes coverage gaps:
- Identifies under-tested personas
- Finds missing scenario types
- Detects performance variations across segments
- Recommends coverage improvements

### 4. ProposalGenerator
**Location**: `src/core/proposal-generator.ts`

Generates specific proposals:
- Creates typed, validated proposals
- Targets specific tools and scopes
- Includes expected impact and confidence
- References supporting patterns

### 5. CounterfactualEvaluator
**Location**: `src/core/counterfactual.ts`

Backtests proposals:
- Applies proposals to historical data
- Simulates outcomes with proposed changes
- Compares to actual historical outcomes
- Validates expected impact

### 6. ProposalLifecycle
**Location**: Integrated in system

Manages proposal state:
- Tracks proposals from emission to acceptance
- Monitors post-deployment effects
- Supports rollback if regression detected
- Maintains audit trail

## Pattern Types

### Configuration Optimization
- High-cost configurations
- Low-success configurations
- Dominant configurations (lack of diversity)

### Coverage Gap
- Under-tested personas
- Missing scenario types
- Performance variations by segment

### Cross-Tool Correlation
- Cost vs. correctness correlation
- Configuration vs. outcome correlation
- Metric correlations across tools

### Drift Detection
- Performance degradation over time
- Metric changes after deployments
- Unexpected metric shifts

### Failure Mode Redundancy
- Repeated failure patterns
- Persistent failure modes
- Failure mode clustering

## Data Flow

```
Data Ingestion (from GBrain)
    ↓
PatternMiner (mine patterns across tools)
    ↓
DriftDetector (detect metric changes)
    ↓
CoverageAnalyzer (identify gaps)
    ↓
ProposalGenerator (generate proposals)
    ↓
CounterfactualEvaluator (backtest proposals)
    ↓
ProposalLifecycle (track and manage)
    ↓
Proposal Application (if approved)
    ↓
Post-Deployment Monitoring
```

## Proposal Structure

```typescript
interface Proposal {
  proposal_id: string;
  target_tool: 'gorchestrator' | 'gmirror' | 'gtom' | 'gstack';
  scope: string;
  change: Record<string, unknown>;
  expected_impact: {
    metric: string;
    direction: 'increase' | 'decrease';
    magnitude: number;
  };
  confidence: number;
  supporting_patterns: Pattern[];
  backtest_results: BacktestResult;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'rolled_back';
  created_at: string;
}
```

## Key Design Decisions

### Non-Autonomous
- Every proposal above threshold requires approval
- No autonomous self-modification
- Human or owning-tool approval required

### Batch Mode
- Runs on cadences (nightly to monthly)
- Not real-time, not in-flight
- Scheduled analysis, not reactive

### Bounded Scope
- Refines configurations, weights, thresholds
- Does not modify base models
- Does not rewrite code
- Does not generate new capabilities

### Counterfactual Validation
- Every proposal must be backtested
- Historical validation before deployment
- Rollback if regression detected

## Configuration Schema

```typescript
interface GLearnConfig {
  dataSources: {
    gbrain: string;
    retentionDays: number;
  };
  mining: {
    cadence: 'daily' | 'weekly' | 'monthly';
    minDataPoints: number;
  };
  proposals: {
    approvalThreshold: 'low' | 'medium' | 'high';
    autoApplyBelow: string;
    rollbackOnRegression: boolean;
  };
  backtest: {
    windowDays: number;
    minConfidence: number;
  };
  drift: {
    detectionThreshold: number;
    minDataPoints: number;
  };
}
```

## Error Handling Strategy

- **GBrain unavailable**: Skip mining cycle, log error
- **Insufficient data**: Skip pattern type, continue with others
- **Backtest failure**: Mark proposal as low confidence, don't auto-apply
- **Proposal application failure**: Roll back, log error

## Extension Points

- **Custom pattern detectors**: Domain-specific pattern mining
- **Alternative proposal types**: Different refinement categories
- **Custom backtest strategies**: Different validation approaches
- **Custom rollback triggers**: Alternative regression detection

## Testing Strategy

- Unit tests for each core module
- Pattern detection tests with various data shapes
- Proposal generation tests for different tools
- Backtest validation tests
- Drift detection tests with synthetic drift
- Proposal lifecycle tests
