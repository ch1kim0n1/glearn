# GLearn Architecture

## System Overview

GLearn is a machine learning pattern detection and proposal generation system designed to learn from data and generate actionable insights.

## Core Components

### PatternMiner
- Detects patterns in structured and unstructured data
- Extracts recurring sequences and correlations
- Maintains a pattern registry with metadata

### ProposalGenerator
- Generates proposals based on detected patterns
- Uses LLM APIs for intelligent proposal creation
- Supports multi-model escalation for quality

### CounterfactualEvaluator
- Evaluates alternative scenarios ("what-if" analysis)
- Compares outcomes across different conditions
- Provides confidence scores for evaluations

### ReceiptRegistry
- Manages learning receipts and cryptographic proofs
- Ensures reproducibility of learning runs
- Tracks provenance of all learned patterns

### DriftDetector
- Monitors concept drift in patterns over time
- Alerts when patterns become outdated
- Supports automatic retraining triggers

### CostLedger
- Tracks LLM API costs across operations
- Provides cost breakdown by operation and model
- Supports cost optimization recommendations

### MultiModelManager
- Manages tiered model selection
- Implements quality-based escalation
- Optimizes cost vs. quality tradeoffs

## Database Architecture

GLearn uses an engine abstraction layer supporting:
- SQLite (default, embedded)
- PostgreSQL (production)
- In-memory (testing)

### Schema
- patterns: Detected patterns with metadata
- proposals: Generated proposals
- counterfactuals: Evaluation results
- receipts: Learning run receipts
- learning_runs: Run metadata and status

## Data Flow

```
Data Ingestion → Pattern Mining → Proposal Generation → Counterfactual Evaluation → Receipt Generation
```

## Configuration

Configuration is hierarchical:
1. Default config in code
2. Config file (JSON/YAML)
3. Environment variables
4. CLI flags

## Security

- OAuth 2.0 authentication support
- Token-based authorization
- Audit logging for all operations
- Encryption at rest (PostgreSQL)

## Performance

- Lazy loading of patterns
- Batch processing for large datasets
- Caching of frequently accessed data
- Connection pooling for databases
