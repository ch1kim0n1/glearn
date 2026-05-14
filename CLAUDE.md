# GLearn — Agent-Readable Contract

## Purpose
GLearn is a learning and adaptation framework that tracks execution patterns, learns from feedback, and improves task performance over time via pattern mining, proposal generation, and counterfactual evaluation. It currently ingests **technical execution receipts** (latency, cost, correctness scores). For DYAD it must also ingest **relational event streams** — sequences of emotional bids, bid responses, repair attempts, and drift in emotional signatures over time.

## Current Core Capabilities
- Multi-tier pattern mining (Tier 1 Haiku → Tier 2 Sonnet escalation on low confidence)
- Proposal generation from detected patterns
- Counterfactual evaluation (what would have happened with a different config?)
- Circuit-breaker–protected GBrain client for semantic enrichment
- Receipt storage (JSONL per ISO week)
- Persistent state via `createPersistenceManager` (patterns, proposals, escalation metrics)
- SQLite persistence (`~/.glearn/glearn.db`) with schema_version + migration runner
- CLI commands: `eval`, `replay`, `regress`, `trend`, `drift`, `cost`

## API Contract (current)

```typescript
interface LearningRequest {
  task: string;
  execution: ExecutionReceipt;
  feedback?: {
    rating: number;       // 0–5
    comments?: string;
  };
}

interface LearningResult {
  learned: boolean;
  confidence: number;
  suggestions: string[];
}

interface Pattern {
  pattern_id: string;
  pattern_type: 'temporal' | 'semantic' | 'outcome';
  signature: string;
  frequency: number;
  confidence: number;
  affected_tools: string[];
}
```

---

## What Must Change for DYAD

### 1. DYAD Data Source Adapter
The current `ingestDataFromAllTools()` method pulls from GBrain, GStack, GOrchestrator, GMirror, and GToM. For DYAD, add a `DyadDataSource` adapter that ingests relational event streams:

```typescript
interface DyadDataSource {
  source: 'dyad';
  dyad_id: string;
  time_range: { start: string; end: string };
  events: RelationalEvent[];
}

type RelationalEvent =
  | { type: 'bid'; participant: 'a' | 'b'; bid_type: string; timestamp: string }
  | { type: 'response'; to_bid_id: string; response_type: 'toward' | 'away' | 'against'; timestamp: string }
  | { type: 'repair_attempt'; initiator: 'a' | 'b'; success: boolean; timestamp: string }
  | { type: 'emotional_shift'; participant: 'a' | 'b'; from: string; to: string; timestamp: string };
```

**File to create:** `src/data-sources/dyad-data-source.ts`
**File to modify:** `src/core/glearn.ts` — add `ingestDyadData(source: DyadDataSource)` and wire into `runLearningCycle()`

### 2. Relational Pattern Types
Extend the `Pattern` type with DYAD-specific pattern types:

```typescript
type PatternType =
  | 'temporal'          // existing: time-based execution pattern
  | 'semantic'          // existing: content similarity pattern
  | 'outcome'           // existing: execution outcome pattern
  | 'bid_cycle'         // NEW: recurring bid → no-response → bid escalation cycle
  | 'repair_window'     // NEW: time window after conflict when repair attempts succeed
  | 'labor_drift'       // NEW: gradual increase in one participant's emotional labor ratio
  | 'attachment_signal' // NEW: message patterns signaling attachment style
```

**File to modify:** `src/types/index.ts` — extend `PatternType` union

### 3. Relational Proposal Generator
The existing `ProposalGenerator` suggests technical optimizations (latency, cost, model choice). For DYAD, add a `RelationalProposalGenerator` that outputs relationship-science-grounded suggestions:

```typescript
interface RelationalProposal {
  proposal_id: string;
  dyad_id: string;
  pattern_ids: string[];          // which patterns triggered this
  insight_type: 'bid_pattern' | 'repair_opportunity' | 'labor_imbalance' | 'attachment_dynamic';
  insight: string;                // human-readable, non-blaming language
  confidence: number;
  grounding: string[];            // citations to Gottman/Johnson research
  should_surface: boolean;        // false if ethical refusal applies
}
```

**File to create:** `src/core/relational-proposal-generator.ts`

### 4. Counterfactual for Relationship Outcomes
The existing `CounterfactualEvaluator` asks "what if a different model config ran?" For DYAD, add `RelationalCounterfactualEvaluator` that asks "what if the bid had been acknowledged?" — evaluating predicted emotional trajectory divergence.

**File to create:** `src/core/relational-counterfactual.ts`

### 5. SQLite Schema Extension for DYAD
```sql
-- New table for relational patterns
CREATE TABLE IF NOT EXISTS relational_patterns (
  pattern_id    TEXT PRIMARY KEY,
  dyad_id       TEXT NOT NULL,
  pattern_type  TEXT NOT NULL,   -- bid_cycle, repair_window, labor_drift, etc.
  signature     TEXT NOT NULL,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  confidence    REAL NOT NULL
);

-- New table for emotional trajectory snapshots
CREATE TABLE IF NOT EXISTS emotional_snapshots (
  snapshot_id   TEXT PRIMARY KEY,
  dyad_id       TEXT NOT NULL,
  participant   TEXT NOT NULL,  -- 'a' or 'b'
  timestamp     TEXT NOT NULL,
  bid_rate      REAL,
  response_rate REAL,
  labor_ratio   REAL,
  repair_attempts INTEGER
);
```

**File to modify:** `src/core/glearn-persistence.ts` — add migrations for these tables.

### 6. DriftDetector — Relationship Health Metrics
The `DriftDetector` is initialized but not fed data. For DYAD, record these metrics into it on each learning cycle:
- `bid_acceptance_rate:{dyad_id}` — rolling 7-day bid acceptance rate
- `repair_success_rate:{dyad_id}` — rolling repair success rate
- `labor_ratio:{dyad_id}` — emotional labor balance

Alert on >20% drop (DriftDetector `alert_threshold` is already set at 0.3).

**File to modify:** `src/core/glearn.ts` — after each learning cycle, call `this.driftDetector.record(metricName, value)`

### 7. Cost Hard Gate
GLearn currently tracks cost but never enforces the budget. Add:

```typescript
// After each tier's LLM call in src/core/glearn.ts
const runCost = this.costLedger.getStatistics().total_usd;
if (runCost > this.multiModelConfig.cost_budget_usd_per_hour / 60) {
  throw new Error(`Cost hard gate: $${runCost.toFixed(4)} exceeds per-run budget`);
}
```

---

## Configuration
- `GLEARN_DB_PATH` — override default `~/.glearn/glearn.db`
- `GLEARN_STATE_PATH` — override persistence manager state file path
- `GLEARN_DYAD_MODE` — `true` to enable relational pattern mining

## Persistence
- SQLite: `~/.glearn/glearn.db` (`GLearnPersistenceManager`)
- State: `createPersistenceManager` (patterns, proposals, escalation metrics)
- Receipts: JSONL per ISO week

## Integration Points
- **Called by:** GOrchestrator (escalation decisions), GStack (long-term optimization loops), DYAD (relationship pattern learning)
- **Calls:** GBrain (semantic enrichment via circuit-breaker client), pattern miner, proposal generator, counterfactual evaluator
