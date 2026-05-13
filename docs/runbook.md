# GLearn Runbook

## Overview
GLearn is a pattern mining and optimization system that analyzes G-Stack activity to discover patterns and generate improvement proposals.

## Quick Start

### Installation
```bash
cd glearn
npm install
npm run build
```

### Basic Usage
```bash
# Run a learning cycle
glearn run

# Run with counterfactual evaluation
glearn run --counterfactual

# Check health
glearn health
```

## Operations

### Learning Cycle
**Command:** `glearn run [options]`

**Purpose:** Analyze G-Stack activity to mine patterns and generate proposals.

**Parameters:**
- `--counterfactual`: Run counterfactual evaluation on proposals

**Example:**
```bash
glearn run --counterfactual
```

**Output Schema:**
```json
{
  "cycle_id": "string",
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601",
  "patterns_found": 15,
  "proposals_generated": 8,
  "evaluations_completed": 5,
  "status": "completed"
}
```

### Pattern Listing
**Command:** `glearn patterns [options]`

**Purpose:** List discovered patterns from the learning cycle.

**Parameters:**
- `--type`: Filter by pattern type
- `--tool`: Filter by source tool

### Proposal Listing
**Command:** `glearn proposals`

**Purpose:** List generated proposals for system optimization.

### Proposal Approval
**Command:** `glearn approve <proposal-id> [options]`

**Purpose:** Approve a proposal for application.

**Parameters:**
- `--reviewer`: Reviewer name (default: user)

### Evaluation Mode
**Command:** `glearn eval [options]`

**Purpose:** Run evaluation on pattern mining performance.

**Parameters:**
- `-c, --corpus`: Path to test corpus JSON
- `--cycles N`: Number of cycles for statistical comparison (default: 1)
- `-o, --output`: Write output to file

### Statistics
**Command:** `glearn stats`

**Purpose:** Show statistics from recent learning cycles.

### Drift Detection
**Command:** `glearn drift`

**Purpose:** Check for pattern drift over time.

## Troubleshooting

### No Patterns Found
**Symptom:** Learning cycle completes with 0 patterns

**Solution:**
- Verify GBrain has sufficient historical data
- Check GStack, GOrchestrator, GMirror connectivity
- Review pattern miner configuration

### High Evaluation Cost
**Symptom:** Counterfactual evaluation exceeds budget

**Solution:**
- Disable counterfactual for initial runs
- Reduce corpus size for evaluation
- Use faster model tiers for counterfactual

### Proposal Quality Issues
**Symptom:** Generated proposals are not actionable

**Solution:**
- Review pattern miner parameters
- Increase proposal diversity settings
- Provide more historical data for learning

## Configuration

### Learning Cycle Parameters
```json
{
  "run_counterfactual": false,
  "pattern_miner": {
    "min_support": 0.1,
    "min_confidence": 0.7,
    "max_patterns": 100
  },
  "proposal_generator": {
    "max_proposals": 20,
    "diversity_threshold": 0.8
  }
}
```

## Integration Points

### GBrain
- Stores historical receipts and transcripts
- Provides pattern mining data source
- Stores approved proposals

### GStack
- Source of code review patterns
- Provides code quality metrics

### GOrchestrator
- Source of execution patterns
- Provides workflow optimization data

### GMirror
- Source of UX testing patterns
- Provides user feedback data

### GLearn MCP
- Exposes run, patterns, proposals, and approval operations
- Used by GAgent for learning in pipeline

## Monitoring

### Key Metrics
- Patterns discovered per cycle
- Proposal acceptance rate
- Evaluation latency
- Cost per learning cycle

### Alerting Thresholds
- Zero patterns found: Check data sources
- Proposal acceptance < 20%: Review pattern quality
- Cycle time > 10 minutes: Optimize pattern miner

## Maintenance

### Daily
- Review recent proposals
- Check learning cycle status

### Weekly
- Run full learning cycle with counterfactual
- Review pattern drift

### Monthly
- Update pattern miner parameters based on results
- Expand corpus for evaluation
