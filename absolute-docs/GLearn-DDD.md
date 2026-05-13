# GLearn — Design & Development Document

**Version:** 0.1 (Pre-Hackathon Draft)
**Owner:** Vlad
**Last Updated:** May 2026
**Status:** Architecture lock-in phase
**Assumes built:** GOrchestrator, GMirror, GToM, GBrain, GStack
**Related Documents:** GOrchestrator-DDD.md, GMirror-DDD.md, GToM-DDD.md

---

## 0. Reading Guide

This document is the architectural and build-plan reference for **GLearn**, the meta-learning and reflective layer in the now-six-tool agent stack.

GLearn is the system that reads across everything the other five tools have accumulated, identifies higher-order patterns that no individual tool can see from its local vantage, and produces structured proposals that refine the other tools' configurations, profiles, libraries, and calibration weights.

This DDD assumes the other three new tools (GOrchestrator, GMirror, GToM) are built and operating as specified in their respective v0.x DDDs. Data shapes referenced here (RunRecord, Verdict, AuthenticityAssessment, etc.) are defined in those documents.

**Critically, this document declares what GLearn is *not*** — see §1.3. It is bounded scope by design. The boundary is structural, not aspirational. If you find yourself extending GLearn to do things outside that boundary, you are no longer building GLearn; you are building something else.

Sections 1–3: what and why.
Sections 4–8: how.
Section 9: build plan, hackathon through V3.
Sections 10–12: risk, open questions, appendix.

---

## 1. Executive Summary

GLearn is a batch-mode reflective system that periodically reads the canonical data produced by the rest of the stack, mines for patterns the other tools cannot see from their local vantage points, and emits typed, validated, counterfactually-backtested proposals that the other tools can accept, modify, or reject.

In the broader stack metaphor: GBrain is the memory, GStack is the hands, GOrchestrator is the crew boss, GMirror is the braindance, GToM is the cognitive immune system. **GLearn is the strategist who reviews the day's runs at night**, sees patterns invisible inside any single job, and writes a refined playbook for tomorrow.

### 1.1 What it is

- A scheduled batch analyzer over the cross-stack data corpus in GBrain.
- A pattern miner — statistical and structural — that looks for things only visible at scale: drift, miscalibration, dominance of certain configurations, failure-mode redundancy, persona/scenario coverage gaps.
- A hypothesis generator that proposes specific refinements to specific tools.
- A counterfactual evaluator that backtests proposals against historical data before they ship.
- A proposal-lifecycle manager: emit, track acceptance, monitor post-deployment effect, roll back if regression detected.
- An audit trail for every refinement that has ever shipped through the stack.

### 1.2 What it is not

This list is non-negotiable. Each item is a known failure mode for systems in this category.

- **It is not autonomous.** Every refinement above a defined impact threshold requires human (or owning-tool) approval. There is no autonomous self-modification path.
- **It is not real-time.** It runs on cadences from nightly to monthly. It does not act inside an in-flight task.
- **It is not a self-improving system in the recursive-self-improvement sense.** It refines configurations, weights, thresholds, and libraries. It does not modify the base models, does not rewrite its own code, does not generate new capabilities.
- **It does not generate new goals.** It refines *how* the system pursues goals. The goals themselves come from outside the stack.
- **It is not a substitute for human review.** The human-in-the-loop is a feature, not an optimization target to remove.
- **It is not the AGI step.** It is a quality-of-system improvement for an already-strong agent platform. Building it well makes the stack measurably better. Building it does not bring AGI closer.

### 1.3 Headline metrics (targets, hedged)

- **Proposal acceptance rate:** target 50–70% of emitted proposals accepted by the owning tool after counterfactual validation. Below 50% means the proposer is too noisy; above 80% means it's too conservative.
- **Proposed-improvement realization:** target 60%+ of accepted proposals deliver at least 70% of their backtested improvement when deployed. Below this, GLearn's counterfactuals are over-fitted.
- **Rollback rate:** target ≤10% of deployed proposals rolled back within 30 days. Above this, proposals are degrading the system as often as helping.
- **Pattern surfacing latency:** for patterns visible in the data, target detection within 14 days of becoming statistically significant. Below this, GLearn isn't earning its keep.
- **Cost per proposal:** target <$5 in compute per emitted proposal in V1, falling to <$1 by V2. Reflection is valuable; it cannot become the dominant cost line.

These are targets, not commitments. Real numbers depend heavily on the diversity of the underlying corpus and how aggressively counterfactual validation is tuned.

---

## 2. Problem Statement

### 2.1 The gap each tool's local learning loop leaves

Each of the existing five tools has its own learning loop:

- GOrchestrator updates its exploit/perturb/explore ratios based on per-task-family outcomes.
- GMirror updates its synthetic-user population calibration when real-world outcomes diverge from verdicts.
- GToM updates its vulnerability state model and authenticity scoring weights based on regret signals.
- GBrain aggregates winning configurations and known failure modes.
- GStack updates skill manifests when skills are improved.

These are good. They are also each *local*. Each tool sees its own data, refines its own parameters, and operates blind to patterns that span tools.

The gaps are real and accumulate:

**Cross-tool patterns invisible to any single tool.** GMirror's verdicts and GOrchestrator's selections are correlated through scoring profiles. If certain scoring profiles produce systematically-overrated attempts that later fail in production, neither tool alone can detect this — the signal is in the cross-tool join. GLearn can detect it.

**Drift that's slow at the daily scale but obvious at the weekly scale.** A particular task family's quality may decay 1% per week — invisible inside a single run, statistically clear over 8 weeks. Each tool's local loop is too tight to see slow drift.

**Library bloat and structural rot.** GMirror's failure-mode library grows monotonically. After 6 months it has redundant entries, outdated severity ratings, and stale scenario templates. The library was never refactored because no tool owns the "refactor the library" job. GLearn owns it.

**Coverage gaps that only show up in aggregate.** GMirror's synthetic-user population may be missing an entire persona slice that real users represent. Each individual verdict is fine; the aggregate miss is structural. Visible only by joining GMirror's coverage with GBrain's real-user analytics.

**Configuration-space exploration that doesn't generalize.** GOrchestrator's per-task-family exploration is good locally but may produce systematic blind spots — configurations that no task family explores even though they would win across families. Visible only at the cross-family level.

**Meta-calibration.** GToM's authenticity scoring may itself be miscalibrated. Each authenticity score has a confidence, and the per-score confidence is calibrated locally. The *meta*-calibration — is confidence itself reliable? — requires aggregate analysis.

Each of these is a real, recurring failure mode in production agent systems. GLearn exists to address them as a category.

### 2.2 Why now

Three convergent factors.

**The other five tools accumulate structured data fast enough that within months of production operation, the cross-tool corpus is large enough to mine.** This wasn't true for any earlier generation of agent systems because they didn't produce structured cross-tool data at all.

**Software-engineering practice has converged on the post-mortem / retrospective as the right model for systemic improvement.** GLearn is, structurally, a continuously-running retrospective process applied to an AI system. The cultural template is mature; the technical implementation is the new part.

**Counterfactual backtesting is now tractable.** Replaying historical scenarios with modified configurations was prohibitively expensive a few years ago. With cheaper inference and structured replay support (which GOrchestrator and GMirror provide natively), it's now within budget for nightly proposal validation.

### 2.3 Why GLearn specifically

The category — meta-learning over agent systems — has historically been research-shaped, not product-shaped. Most published work is either too theoretical to ship (Schmidhuber, AIXI) or too narrow to compose (Reflexion-style per-task self-improvement). The intermediate layer — a production-grade, bounded-scope, cross-tool reflective system — is mostly empty.

The defensibility:

- **Bounded scope, enforced architecturally.** Many systems in this category overpromise (recursive self-improvement, autonomous goal generation) and never ship. GLearn's boundaries are documented as non-negotiable. This makes it shippable.
- **Counterfactual validation as a first-class step.** Most reflection systems propose changes without backtesting them. GLearn requires backtesting before emission. This is the difference between a system that proposes good ideas and a system that proposes good ideas that *also actually work*.
- **Typed proposals per consuming tool.** Free-text "suggestions" don't compose. Typed, schema-validated proposals do. Each consuming tool has its own proposal type. This lets the proposals flow through normal validation paths instead of free-text review.
- **Cross-tool reach.** Single-tool reflection layers exist. Cross-tool ones don't, because they require the cross-tool data corpus to exist first. The five-tool stack creates that corpus.

---

## 3. System Overview

### 3.1 Conceptual model

A GLearn cycle has six phases:

1. **Snapshot.** At the cycle's start, take a consistent snapshot of the cross-tool data corpus from GBrain.
2. **Mine.** Run pattern miners over the snapshot. Each miner is specialized for a category of insight (drift detection, redundancy detection, coverage gap analysis, meta-calibration, etc.).
3. **Hypothesize.** For each pattern, generate one or more candidate refinement proposals. A proposal is a typed, structured suggestion targeted at a specific consuming tool.
4. **Backtest.** For each candidate proposal, run counterfactual evaluation against historical data. Does this proposal, applied retroactively, produce better outcomes? By how much, with what confidence?
5. **Emit.** Proposals that pass backtesting thresholds are emitted to the owning tool. Low-impact proposals can be auto-accepted; high-impact proposals require human or tool-level review.
6. **Track.** Once a proposal is accepted and deployed, GLearn monitors its post-deployment effect against the backtested prediction. If the deployed effect is significantly worse than predicted, rollback is triggered.

### 3.2 One-line mental model

> **Read the day's runs. Find what no single run can show. Propose how to do better. Prove it would have worked. Ship it carefully. Watch what happens.**

### 3.3 The pattern miners — what GLearn actually looks for

GLearn is structured around a set of specialized miners. Each miner has a domain, a class of pattern it looks for, and a target tool for any proposals it generates.

| Miner | Looks for | Proposes to |
|---|---|---|
| Drift Detector | Slow degradation in quality, cost, or latency over time | The affected tool |
| Configuration Dominance Analyzer | Configurations that win across many task families | GOrchestrator |
| Coverage Gap Finder | Synthetic-user persona slices underrepresented vs real-user data | GMirror |
| Failure-Mode Redundancy | Failure-mode library entries that have converged or duplicated | GMirror |
| Scoring-Profile Calibrator | Profiles whose scores systematically diverge from production outcomes | GMirror |
| Authenticity Miscalibration | Authenticity scores whose confidence is itself miscalibrated | GToM |
| Manipulation-Pattern Drift | Manipulation patterns whose detection precision has degraded | GToM |
| Vulnerability-Dimension Coverage | Vulnerability dimensions missing from the GToM schema based on observed user behavior | GToM (proposes new dimension) |
| Sandbox-Cost Inefficiency | GOrchestrator sandbox configurations with worse cost/quality than alternatives | GOrchestrator |
| Cross-Tool Score Correlation | When two tools' scores correlate or anti-correlate in unexpected ways | Both tools |
| Failure-Pattern Emergence | Novel failure patterns appearing in production that the existing libraries don't catch | The affected tool |
| Meta-Failure-Mode Detector | Patterns in the failure-mode library itself — what kinds of failures keep slipping through? | GMirror's library structure |

Each miner is a separate, well-defined component. New miners can be added as new categories of insight become important. The miner registry is extensible.

### 3.4 Cyberpunk framing

GLearn is the *strategist*. The crew dispatches at dawn. The fixer watches the run from a back room. The empath flags incoming hostile influence. The braindance plays back what the synthetic users felt. The crew comes home, paid or dead, with their gear and their stories.

The strategist watches the recordings at night. With coffee. With a wall of footage and a pegboard of notes. She doesn't run jobs. She reads them. She sees that the netrunner who keeps dying on the third subnet always has the same tool loadout. She sees that the braindance is missing the persona of the corp's actual customer base — they keep testing against suits, but the customers are kids. She sees that the empath's vulnerability scoring is too lenient on Tuesday nights, when everyone's tired.

She writes notes. Some are small: "swap the loadout." Some are big: "we need a new persona class entirely." She brings them to the crew the next morning. They accept or argue. The accepted ones get tried on the next run. If they pay off, they become standard. If they don't, the notes get filed for next time.

She doesn't do the runs. She doesn't pick the goals. She doesn't even decide what gets adopted. She just sees what the people in the field, by the nature of being in the field, can't.

---

## 4. Architecture

### 4.1 Component diagram

```
                ┌────────────────────────────────────────────────────────┐
                │                       GLearn                           │
                │                                                        │
                │  ┌───────────────────┐                                  │
   Scheduler ───┼─►│  Cycle Controller │                                  │
   (nightly,    │  └─────────┬─────────┘                                  │
    weekly,     │            │                                            │
    monthly)    │            ▼                                            │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Corpus Snapshotter                           │      │
   GBrain ◄─────┼──┤  (pulls consistent cross-tool data view)      │      │
                │  └─────────────────┬─────────────────────────────┘      │
                │                    │                                    │
                │                    ▼                                    │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Miner Pool                                   │      │
                │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ...   │      │
                │  │  │ Drift    │ │ Coverage │ │ Calib    │       │      │
                │  │  │ Detector │ │ Gap      │ │ Miner    │       │      │
                │  │  └─────┬────┘ └─────┬────┘ └─────┬────┘       │      │
                │  └────────┼────────────┼────────────┼────────────┘      │
                │           ▼            ▼            ▼                   │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Pattern Aggregator & Deduplicator            │      │
                │  └─────────────────┬─────────────────────────────┘      │
                │                    │                                    │
                │                    ▼                                    │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Hypothesis Generator                         │      │
                │  │  (pattern → candidate proposals)              │      │
                │  └─────────────────┬─────────────────────────────┘      │
                │                    │                                    │
                │                    ▼                                    │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Counterfactual Evaluator                     │      │
                │  │  (backtest proposals against historical data) │      │
                │  └─────────────────┬─────────────────────────────┘      │
                │                    │                                    │
                │                    ▼                                    │
                │  ┌───────────────────────────────────────────────┐      │
                │  │  Proposal Emitter & Lifecycle Tracker         │      │
                │  └─────────────────┬─────────────────────────────┘      │
                │                    │                                    │
                └────────────────────┼────────────────────────────────────┘
                                     │
                                     ▼
                  ┌──────────────────┴──────────────────┐
                  │                                     │
                  ▼              ▼            ▼         ▼
              GOrchestrator   GMirror      GToM       GBrain
              (config props)  (profile,    (calib,    (taxonomy,
                              library)     manip pat) aggregate)

   Sidecar:
   ────────
   GBrain  ◄── post-deployment outcome tracking (read; for rollback monitoring)
```

### 4.2 Core components

#### 4.2.1 Cycle Controller

**Responsibility:** Schedule, gate, and coordinate GLearn cycles.

GLearn does not run continuously. It runs on cadences:

- **Nightly:** lightweight cycles. Drift detection, calibration miners, small-scale proposals. Budget: <30 minutes of compute.
- **Weekly:** medium cycles. Cross-tool correlation, redundancy detection, configuration-dominance analysis, larger proposals. Budget: <4 hours of compute.
- **Monthly:** heavy cycles. Structural analyses, library refactor proposals, dimension-coverage analyses, novel-pattern emergence. Budget: <24 hours.

Cycles are gated: a cycle does not start if the prior cycle of the same cadence is still running or if rollback monitoring is in a critical state. The controller is the only component that can start a cycle.

#### 4.2.2 Corpus Snapshotter

**Responsibility:** Produce a consistent, point-in-time view of the cross-tool data corpus.

Mining over a moving target produces inconsistent results. The snapshotter pulls a coordinated read of:

- GBrain run records, failure modes, calibration aggregates, real-user analytics aggregates.
- GMirror verdict history, failure-mode library state, synthetic-user population state, scenario library state.
- GToM cognitive state snapshots (aggregated, anonymized), vulnerability dimension definitions, manipulation taxonomy state.
- GOrchestrator configuration history, win/loss aggregates per task family.
- Cross-tool outcome data: which deployed configurations led to production failures, regret events, user complaints.

The snapshot is materialized into GLearn's working store and is the single source of truth for the cycle. Updates to the upstream stores during a cycle do not affect the cycle's mining.

Snapshots are content-addressed and stored for audit. A proposal can always be re-validated against the snapshot it was generated from.

#### 4.2.3 Miner Pool

**Responsibility:** Run specialized pattern miners over the corpus snapshot.

Miners are independent, isolated, and parallelizable. Each miner:

- Reads from the snapshot (read-only access).
- Produces a set of `Pattern` records (typed, structured).
- Has its own confidence reporting.
- Has its own cost budget per cycle.

A miner failure does not affect other miners. The cycle proceeds with whatever miners succeeded.

The miner registry is extensible. Adding a new miner is a deliberate, reviewed step. Each new miner must:
- Declare what category of pattern it detects.
- Have a statistical or structural definition of "significant pattern" so it doesn't over-fire.
- Pass an offline validation suite on a fixture corpus before being enabled.

The initial set of miners is in §3.3.

#### 4.2.4 Pattern Aggregator & Deduplicator

**Responsibility:** Take patterns from multiple miners, deduplicate, prioritize, and prepare them for hypothesis generation.

A single underlying phenomenon may be visible to multiple miners. The aggregator detects this and consolidates. Priority is determined by:

- Estimated impact if addressed (in expected quality lift or cost reduction).
- Confidence the pattern is real.
- Novelty (patterns not seen in recent cycles get priority).
- Stakes (patterns affecting high-stakes task families get priority).

Output: a ranked list of `Pattern` records ready for hypothesis generation.

#### 4.2.5 Hypothesis Generator

**Responsibility:** For each pattern, produce one or more candidate refinement proposals.

Hypothesis generation is structured per pattern type. A drift pattern produces proposals about thresholds and weights. A coverage-gap pattern produces proposals about adding synthetic users or scenarios. A failure-mode redundancy pattern produces proposals about library refactoring.

For each pattern, the generator may produce:
- A single canonical proposal (when the pattern has an obvious response).
- A small set of candidate proposals (when there are competing plausible responses).
- An "investigation request" (when the pattern is real but no specific proposal is obvious — flagged for human attention rather than auto-proposed).

Generation uses a combination of:
- **Templated proposals** for well-understood pattern categories.
- **LLM-assisted generation** for novel patterns, with structured prompts and output schemas.
- **Existing-pattern lookup** for patterns similar to ones previously handled successfully.

Every proposal is typed against the consuming tool's proposal schema (§4.4).

#### 4.2.6 Counterfactual Evaluator

**Responsibility:** Backtest each candidate proposal against historical data to estimate its likely impact and confidence.

This is the component that separates GLearn from "AI suggestion box" products. Every proposal goes through counterfactual evaluation before emission. The evaluator:

- Selects a held-out subset of historical runs/verdicts/assessments relevant to the proposal.
- Re-runs (or simulates re-running) those historical cases with the proposed refinement applied.
- Compares outcomes: would the refinement have produced better results? By how much? With what statistical significance?
- Returns a structured `BacktestResult` with predicted improvement, confidence, and sensitivity to assumptions.

The methods vary by proposal type:

- For configuration changes in GOrchestrator: replay historical task signatures with the new configuration distribution; compare aggregate scores.
- For scoring-profile changes in GMirror: re-score historical attempts with the new profile; compare against ground-truth production outcomes where available.
- For threshold/weight changes in GToM: re-run authenticity scoring over historical decisions; compare against regret signals.
- For library/taxonomy refactors: structural backtesting — does the refactored library still catch all the failures the original catches, plus some additional ones?

**Critically, the evaluator distinguishes:**
- **Strong backtest** (full replay possible, ground truth available): high confidence.
- **Weak backtest** (replay involves model calls, results approximate): medium confidence.
- **Structural backtest** (no replay, just structural reasoning): low confidence.

Proposals are emitted with their backtest strength tier explicit. Consumers can require strong-backtest only for high-impact changes.

The evaluator has its own cost budget. Expensive backtests are reserved for high-priority proposals.

#### 4.2.7 Proposal Emitter & Lifecycle Tracker

**Responsibility:** Emit proposals to consuming tools, track their lifecycle, and monitor post-deployment outcomes.

A proposal's lifecycle:

1. **Emitted.** Generated, backtested, sent to consuming tool's proposal queue.
2. **Review.** The consuming tool's owner (or, for auto-accept-eligible proposals, the tool itself) reviews. Outcomes: accept, modify-and-accept, reject, defer.
3. **Deployed.** Accepted proposal is applied. Version tag created.
4. **Monitored.** GLearn observes outcomes against the predicted improvement.
5. **Confirmed or Rolled Back.** If outcomes match prediction within tolerance, proposal becomes part of the baseline. If outcomes are significantly worse than predicted, rollback is triggered.

The lifecycle tracker is the durable record of every proposal that has ever been emitted, including the backtests that produced it, the decision made, and the post-deployment outcome. This is critical:

- It is the system's institutional memory of *why* configurations look the way they do.
- It is the source of truth for "have we tried this before?" queries.
- It is the calibration signal for GLearn itself — over time, GLearn learns which kinds of proposals tend to deliver vs. fail.

### 4.3 Cross-cutting design decisions

#### 4.3.1 Read-only on data, write-only via proposals

GLearn does not directly modify any tool's state. It reads from the snapshot. It emits proposals. Consuming tools apply proposals through their own normal update mechanisms.

This means: a bug in GLearn cannot corrupt the system. The worst GLearn can do is propose bad refinements, which the consuming tools (and their human owners) can reject.

This is the central architectural commitment that makes GLearn safe to deploy.

#### 4.3.2 Typed proposals over free-text suggestions

Every proposal is a structured record validated against the consuming tool's schema. There is no "GLearn produces natural-language suggestions for humans to read." That model doesn't scale and is hard to audit.

The cost is upfront: each consuming tool must define its proposal schema. The benefit is that proposals can be reviewed, validated, applied, rolled back, and learned from automatically.

#### 4.3.3 Counterfactual validation is mandatory

No proposal emits without a counterfactual backtest. If the backtest is impossible (structural change with no replayable history), the proposal emits with a "no backtest available — flagged for human investigation" tag instead of being auto-accepted.

The mandate is what separates this system from suggestion-box products.

#### 4.3.4 Bounded autonomy, by impact tier

Proposals are auto-accept-eligible by impact tier:

- **Tier 1 (trivial impact):** auto-accept after backtest passes. Example: marginal threshold adjustments under a defined magnitude.
- **Tier 2 (moderate impact):** auto-accept eligible if backtest is strong and rollback risk is bounded; tool-owner can require manual review.
- **Tier 3 (significant impact):** manual review required from a designated reviewer.
- **Tier 4 (structural change):** manual review required, plus a written rationale, plus a documented rollback plan.

The thresholds for these tiers are configurable per consuming tool and per deployment. Conservative deployments (regulated industries, high-stakes domains) can require manual review at lower tiers.

#### 4.3.5 Rollback is first-class

Every accepted proposal carries metadata sufficient to roll back. The roll-back path is tested as part of proposal acceptance — it is not enough for a proposal to be a good change; it must also be a *reversible* change.

#### 4.3.6 GLearn does not learn about itself

This is the most important boundary. GLearn refines configurations of other tools. It does not refine its own miners, hypothesis generators, or evaluators. Those are versioned, tested, and updated through normal engineering process.

The reason: a system that modifies its own self-modification logic is exactly the kind of system whose failure modes are unpredictable. Keeping GLearn's machinery out of GLearn's mining scope keeps the system bounded.

There is one narrow exception: GLearn tracks its own *proposal precision* (how often proposals deliver as predicted) and surfaces miscalibration as a signal for human engineers to review. It does not auto-fix that miscalibration.

### 4.4 Data model

#### 4.4.1 Core types

```typescript
type Cycle = {
  cycle_id: UUID;
  cadence: 'nightly' | 'weekly' | 'monthly';
  started_at: Timestamp;
  ended_at: Timestamp;
  snapshot_id: UUID;
  miner_results: MinerResult[];
  patterns_found: Pattern[];
  proposals_emitted: Proposal[];
  status: 'running' | 'completed' | 'aborted';
};

type Pattern = {
  pattern_id: UUID;
  miner_id: string;
  category: PatternCategory;
  description: string;             // human-readable
  affected_tools: ToolRef[];
  evidence: EvidenceRef[];
  statistical_significance: number; // [0,1]
  estimated_impact: ImpactEstimate;
  priority: number;
};

type Proposal = {
  proposal_id: UUID;
  cycle_id: UUID;
  pattern_id: UUID;
  target_tool: ToolRef;
  proposal_type: string;            // tool-specific schema
  payload: any;                     // typed per target tool
  impact_tier: 1 | 2 | 3 | 4;
  backtest: BacktestResult;
  rollback_plan: RollbackPlan;
  emitted_at: Timestamp;
  status: 'pending' | 'accepted' | 'modified_accepted' | 'rejected' | 'deferred';
};

type BacktestResult = {
  strength: 'strong' | 'weak' | 'structural' | 'unavailable';
  predicted_improvement: number;    // metric-specific
  confidence: number;               // [0,1]
  sample_size: number;
  sensitivity_analysis: SensitivityReport;
  cost: CostBreakdown;
};

type ProposalOutcome = {
  proposal_id: UUID;
  deployed_at: Timestamp;
  observed_improvement: number;
  predicted_vs_observed_delta: number;
  status: 'confirmed' | 'underperforming' | 'rolled_back';
  rollback_reason?: string;
};
```

#### 4.4.2 Per-tool proposal schemas

Each consuming tool defines its own proposal types. Examples:

**GOrchestrator proposal types:**
- `config_distribution_adjustment` — adjust exploit/perturb/explore ratios for a task family.
- `default_n_change` — change default attempt count for a task signature.
- `sandbox_backend_recommendation` — propose switching sandbox backend for cost reasons.

**GMirror proposal types:**
- `synthetic_user_persona_addition` — add new persona to population.
- `scenario_library_addition` — add new scenario.
- `failure_mode_consolidation` — merge redundant failure modes.
- `scoring_profile_weight_adjustment` — adjust scoring profile weights.
- `red_team_probe_addition` — add new adversarial probe.

**GToM proposal types:**
- `manipulation_pattern_threshold_adjustment` — adjust detection threshold for a pattern.
- `vulnerability_dimension_addition` — propose a new vulnerability dimension.
- `authenticity_scoring_weight_adjustment` — adjust authenticity score weights.
- `conscience_floor_addition` — propose adding pattern to the non-negotiable floor (requires special review).

**GBrain proposal types:**
- `signature_hash_refinement` — refine task signature hashing logic.
- `aggregation_pipeline_adjustment` — adjust how winning-config statistics are aggregated.
- `taxonomy_extension` — propose new categories in the failure-mode taxonomy.

Note that some proposal types (like `conscience_floor_addition`) inherit special review requirements from the consuming tool's own architecture. GLearn cannot override these. A proposal to weaken the conscience floor, for example, cannot be auto-accepted at any tier.

### 4.5 Failure modes per component

| Component | Failure mode | Detection | Mitigation |
|---|---|---|---|
| Cycle controller | Cycle starts while previous in critical state | Pre-flight check | Defer cycle; alert |
| Snapshotter | Inconsistent read across stores | Snapshot validation hash | Abort cycle; retry |
| Miner | Over-fires (low-significance patterns flagged) | Pattern aggregator dedup + statistical filter | Tune significance threshold; flag miner for review |
| Miner | Under-fires (misses real patterns) | Audit by comparison with known historical issues | Strengthen miner or add new miner |
| Hypothesis generator | Generates proposals targeting wrong tool | Schema validation at emission | Reject; route to investigation |
| Counterfactual evaluator | Over-optimistic backtests (predicted gains don't materialize) | Proposal outcome tracking | Calibration loop tightens prediction; flag if systematic |
| Counterfactual evaluator | Backtest cost runs over budget | Budget enforcement | Skip expensive backtests; emit with weaker backtest tier |
| Proposal emitter | Proposal accepted by tool but fails post-deployment | Outcome monitoring | Automatic rollback; calibration update |
| Lifecycle tracker | Loses track of a proposal | Append-only log; reconciliation | Restore from log |
| Whole system | Proposes change that consuming tool incorrectly accepts | Rollback when degradation observed | Conservative impact tiers; mandatory human review at higher tiers |

**Invariant 1:** GLearn does not modify other tools' state directly. Ever.
**Invariant 2:** No proposal emits without a backtest (even if the backtest is "unavailable, flagged for review").
**Invariant 3:** Every proposal is rollbackable.
**Invariant 4:** GLearn does not modify its own machinery.

---

## 5. Research Foundations

This section establishes the intellectual lineage. GLearn is grounded in several traditions, each contributing to a different part of the architecture.

### 5.1 Meta-learning and learning-to-learn

- **Thrun & Pratt.** *Learning to Learn* (1998). The foundational framing of meta-learning as a field.
- **Schmidhuber.** Work on self-improving systems and gödel machines. Theoretical extremes; useful for understanding what the limits *would* look like if unbounded, and why bounding is necessary.
- **Finn, Abbeel, Levine.** Model-Agnostic Meta-Learning (MAML, 2017). The modern meta-learning template.

What GLearn borrows: the framing of *learning about how the system learns*, with the discipline of treating the meta-process as a separate, bounded layer. What it deliberately does *not* borrow: Schmidhuber's unbounded self-improvement framing. That's the boundary GLearn enforces.

### 5.2 Reflection and self-refinement in LLMs

- **Madaan et al.** Self-Refine (2023). LLM iteratively critiques and improves its own output.
- **Shinn et al.** Reflexion (2023). Verbal reinforcement learning through reflection.
- **Yao et al.** Tree of Thoughts (2023). Structured reasoning over solution spaces.

What GLearn borrows: the principle that LLMs can produce structured critiques and refinements over their own work, when given the right scaffolding. What it differs on: GLearn operates at the *system* level, not the per-task level. Reflexion-style per-task refinement is something individual GStack skills can implement; GLearn does the meta-level.

### 5.3 Software-engineering retrospective culture

- **Beyer, Jones, Petoff, Murphy.** *Site Reliability Engineering* (Google SRE Book). The post-mortem culture.
- **Agile retrospective practice.** Kerth's "Project Retrospectives" framework.
- **Continuous improvement / kaizen literature.**

What GLearn borrows: the structural insight that periodic reflection on accumulated outcomes, with structured outputs and follow-through, is how complex systems improve. The post-mortem template (what happened, why, what we'll do differently) maps cleanly to the Pattern → Hypothesis → Proposal flow.

### 5.4 Causal inference

- **Pearl.** *Causality* (2009). Do-calculus and the formal framework.
- **Imbens & Rubin.** Causal Inference for Statistics, Social, and Biomedical Sciences.
- **Counterfactual reasoning literature** broadly.

What GLearn borrows: the discipline of distinguishing correlation from causation in observational data, and the formal framework of counterfactual reasoning that underlies the backtest evaluator. Without this discipline, GLearn would propose changes based on spurious correlations.

### 5.5 Bandit algorithms and online optimization

- **Sutton & Barto.** *Reinforcement Learning: An Introduction* (2018). Foundational.
- **Bandit algorithm literature** — UCB, Thompson sampling, contextual bandits.
- **Bayesian optimization** for hyperparameter tuning.

What GLearn borrows: the framing of GOrchestrator's exploit/perturb/explore as a bandit problem, and the analysis tools for evaluating whether that bandit is well-tuned over time.

### 5.6 Active learning

- **Settles.** Active Learning Literature Survey (2009).
- **Modern active-learning work** for sample-efficient model improvement.

What GLearn borrows: the principle of identifying the most informative cases to invest analysis or backtest budget on, rather than treating all data equally.

### 5.7 The composite stance

GLearn integrates across these traditions:

- The *what to look for* comes from retrospective practice.
- The *how to validate* comes from causal inference and counterfactual reasoning.
- The *how to bound* comes from a deliberate rejection of unbounded self-improvement framings.
- The *how to prioritize* comes from active learning and bandit algorithms.
- The *what to do with results* comes from how production engineering teams handle post-mortems: structured findings, owners, follow-through, retro of retros.

The result is a system that is recognizable to research and recognizable to production engineering, but is the integration of both.

---

## 6. Integration Contracts

### 6.1 GLearn ↔ GBrain

#### 6.1.1 Reads (snapshot)

```
POST /gbrain/snapshot
  body:
    {
      cycle_id: UUID,
      desired_scope: SnapshotScope,
      consistency_required: boolean
    }
  returns:
    {
      snapshot_id: UUID,
      manifest: SnapshotManifest,
      access_uri: string
    }
```

Snapshots are heavy reads but they are bounded in frequency (one per cycle). GBrain serves them from read replicas to avoid impacting production traffic.

#### 6.1.2 Writes (audit trail only)

GLearn writes nothing to GBrain that is not its own operational audit data: cycle records, proposal lifecycle records, post-deployment monitoring events. GLearn does not write refinements to GBrain; refinements flow to the consuming tools.

### 6.2 GLearn ↔ GOrchestrator

```
POST /gorchestrator/proposals
  body:
    {
      proposal: Proposal,
      backtest: BacktestResult
    }
  returns: { proposal_id: UUID, status: 'queued' }

POST /gorchestrator/proposals/{id}/decision
  body:
    {
      decision: 'accept' | 'modify_accept' | 'reject' | 'defer',
      modifications?: any,
      reviewer: ReviewerRef,
      rationale?: string
    }
  returns: { ack: boolean }
```

Acceptance triggers deployment via GOrchestrator's normal versioning path. GLearn does not deploy directly.

### 6.3 GLearn ↔ GMirror

Symmetric to the GOrchestrator contract. Proposal types are GMirror-specific (see §4.4.2).

A note: proposals about the manipulation taxonomy or synthetic-user population are particularly sensitive — they have downstream effects on what GMirror catches and reports. These default to higher impact tiers requiring human review.

### 6.4 GLearn ↔ GToM

Symmetric. Proposal types are GToM-specific.

**Special case: conscience floor.** Proposals to *add* patterns to the conscience floor follow the standard flow. Proposals to *weaken or remove* anything from the conscience floor are blocked at the GToM API layer regardless of tier. GLearn cannot weaken the conscience. This is the architectural commitment from the GToM DDD.

### 6.5 GLearn ↔ GStack

Limited. GStack skills are versioned by their owners; GLearn does not propose skill code changes. What it can propose:

- Skill manifest refinements (recommended-skill lists per task type).
- Skill output audit thresholds (when wrapped by GToM's conscience).

Anything more substantive (proposed skill behavior changes) is flagged for human investigation rather than emitted as an auto-accept proposal.

### 6.6 GLearn ↔ Human Reviewers

For Tier 3 and Tier 4 proposals, GLearn exposes a review interface:

- A queue of pending proposals.
- For each: the pattern that motivated it, the backtest results, the proposed change, the rollback plan.
- Review actions: accept, modify-and-accept, reject (with reason), request more analysis, defer.

Reviewers' decisions are themselves logged as signal — over time, GLearn calibrates against reviewer patterns. If a reviewer consistently rejects a category of proposal, the hypothesis generator deprioritizes that category for future cycles.

This is not autonomous learning about reviewer behavior in a goal-seeking sense — it is plain calibration. The reviewer remains authoritative.

---

## 7. Observability

### 7.1 What gets logged

- Every cycle: start, end, duration, miners run, patterns found, proposals emitted.
- Every pattern: detection, evidence, statistical significance.
- Every proposal: full lifecycle from emission through deployment outcome.
- Every backtest: inputs, methodology, result, cost.
- Every rollback: trigger, reason, restoration evidence.
- Every reviewer decision.

### 7.2 Dashboards

- **Cycle health dashboard:** are cycles running on schedule? Within budget? Producing useful proposals?
- **Proposal pipeline dashboard:** queue depth per tool, acceptance rate, time-to-decision, post-deployment outcome.
- **Calibration dashboard:** predicted improvement vs observed improvement, over time, per proposal type. The single most important dashboard for GLearn's trustworthiness.
- **Miner effectiveness dashboard:** which miners are producing high-acceptance, high-realization proposals vs which are noisy?
- **Rollback dashboard:** what kinds of proposals get rolled back? Patterns in rollback signal weaknesses in backtesting.

### 7.3 The calibration imperative

A reflection layer whose proposals don't deliver as predicted is worse than no reflection layer. The calibration dashboard is the proof-of-value of GLearn. If predicted improvements consistently don't materialize, the system loses trust quickly — and rightly so.

This is why backtest strength is reported explicitly, why post-deployment monitoring is mandatory, and why the calibration dashboard is public to all consuming tool owners.

---

## 8. Cost and Performance Model

### 8.1 Cost breakdown per cycle

The dominant cost driver is counterfactual evaluation. Within that:

- Strong backtests (full replay): $$$ per proposal.
- Weak backtests (model-call approximation): $$ per proposal.
- Structural backtests: $ per proposal.

Mining is cheap (statistical and structural operations over a snapshot). Hypothesis generation is moderate (a few LLM calls per pattern). Lifecycle tracking is near-free.

### 8.2 Cycle-level budgets

| Cadence | Compute budget | Proposal cap | Backtest strength tier |
|---|---|---|---|
| Nightly | <30 min compute | ≤50 proposals | Mostly weak/structural |
| Weekly | <4 hours compute | ≤200 proposals | Mix of strong/weak |
| Monthly | <24 hours compute | ≤1000 proposals | Strong where possible |

Budgets are enforced. A cycle that hits its budget emits what it has and stops.

### 8.3 The cost-quality tradeoff

GLearn's value is gated by counterfactual quality. Cheaper backtests = noisier predictions = lower acceptance rate = lower realization rate. The team should expect to spend more on backtesting over time as the corpus grows and stakes rise.

A cycle whose backtests are too cheap to be trusted is worse than no cycle.

---

## 9. Build Plan & Milestones

### 9.1 Hackathon MVP (the weekend)

**Goal:** a demo that shows GLearn watching the system, finding a pattern no single run could surface, and proposing a fix that visibly improves the next run.

**Scope:**

- **One cycle cadence:** nightly only.
- **Two miners:**
  - Configuration Dominance Analyzer (looks across GOrchestrator runs for configurations that win across task families).
  - Failure-Mode Coverage Gap (looks across GMirror verdicts for systematic blind spots).
- **One proposal type per tool:**
  - GOrchestrator: `config_distribution_adjustment`.
  - GMirror: `synthetic_user_persona_addition`.
- **Hand-seeded corpus:** the demo's historical data is constructed deliberately so the patterns are present and the proposals will produce a visible improvement.
- **Hypothesis generator:** templated, with one LLM-assisted variant for novel patterns.
- **Counterfactual evaluator:** weak backtests only (model-call approximation), with structured replay against the seeded corpus.
- **Proposal lifecycle:** all auto-accept (Tier 1 only, with a visible "auto-accepted" badge); rollback path stubbed.
- **All integrations with GBrain, GOrchestrator, GMirror, GToM:** real APIs, stubbed responses where needed for demo flow.
- **Dashboards:** cycle dashboard and calibration dashboard, cyberpunk-themed.

**Demo flow (90 seconds):**

Part 1 — The pattern emerges (30s):
1. Cut to the war room dashboard. A week of run data scrolls past — cards flying by showing GOrchestrator runs, GMirror verdicts, GToM assessments.
2. GLearn's nightly cycle kicks off. The "Configuration Dominance Analyzer" lights up. A pattern is found: "Across 47 runs in the 'code-refactor' family, configurations with high exploration ratios consistently outperformed exploitation configurations — but the current GOrchestrator policy still favors exploitation."
3. The pattern card shows the evidence: a small chart with 47 dots, exploration winning by a clear margin.

Part 2 — The proposal and backtest (30s):
4. The Hypothesis Generator produces a proposal: "Increase exploration ratio from 0.2 to 0.4 for the code-refactor task family."
5. The Counterfactual Evaluator runs a backtest. A progress bar fills as 30 historical runs are re-simulated.
6. Backtest result appears: "Predicted improvement: 18% lift in task success. Confidence: 0.78. Backtest strength: weak (model-approximation)."
7. The proposal is auto-accepted (Tier 1). A "deployed" badge appears.

Part 3 — The realization (30s):
8. Cut to a live GOrchestrator run on a code-refactor task, using the new configuration distribution. Multiple attempts race.
9. Outcome: the run succeeds with measurably better metrics than the historical baseline shown in a side panel.
10. The calibration dashboard updates. Predicted lift: 18%. Observed lift: 22%. The proposal is marked "confirmed."

Closing beat (~5s):
11. The war-room pegboard updates: one new pinned note. The cycle log shows the proposal lifecycle complete. The strategist's work is done for the night.

**Time budget:**
- Friday night: snapshot mechanic, working corpus, both miners (10h).
- Saturday morning: hypothesis generator, counterfactual evaluator (model-approximation backtests) (8h).
- Saturday afternoon: proposal emission + lifecycle tracking, integration stubs (6h).
- Saturday night: cyberpunk-themed dashboard, demo wiring (6h).
- Sunday: polish, pitch, the "strategist" framing (8h).

**Risks:**

- **The pattern must be visible in the seeded data.** If judges don't see the cross-run pattern emerge, the whole demo doesn't land. Mitigation: seed deliberately, make the chart obvious, narrate the pattern clearly.
- **The backtest beat is the moat moment.** A reflection system without backtesting is a suggestion box. The backtest progress bar and result must be central to the demo. Mitigation: make the backtest visual; show the historical data being re-simulated.
- **The observed improvement must roughly match the prediction.** If the predicted-vs-observed delta is huge in the demo, the calibration story collapses. Mitigation: tune the seeded data to make this work; have backup pre-recorded final runs.

### 9.2 V1 — Production-shaped prototype (post-hackathon, ~8 weeks)

**Goal:** the architecture from this DDD, end to end, on real data.

**New scope vs MVP:**

- All three cadences (nightly, weekly, monthly).
- Full initial miner set (all 12 from §3.3).
- Full proposal type coverage for all four consuming tools.
- Strong-tier backtesting for high-impact proposals.
- Impact tiering with manual-review path for Tier 3 and Tier 4 proposals.
- Rollback mechanism end-to-end.
- Calibration dashboard with predicted-vs-observed tracking over weeks.
- Reviewer interface for human-in-the-loop.
- Integration with real GBrain, GOrchestrator, GMirror, GToM stores (not stubs).
- Auditability of every proposal back to the pattern that motivated it.

**Milestones:**

- **Weeks 1–2:** Snapshotter, cycle controller, miner framework.
- **Weeks 3–4:** Full miner set; pattern aggregator.
- **Week 5:** Hypothesis generator and per-tool proposal schemas.
- **Weeks 6–7:** Counterfactual evaluator with strong-tier support; lifecycle tracker.
- **Week 8:** Reviewer interface, dashboards, polish.

**Exit criteria:**

- A complete cycle runs end-to-end on real production data without manual intervention.
- At least 50 proposals emitted across the first 4 weeks of operation.
- Proposal acceptance rate ≥40% (rising target as calibration improves).
- Realization rate of accepted proposals ≥50%.
- Rollback rate ≤15%.

### 9.3 V2 — Hardened (months 3–5)

**New scope:**

- Multi-tenant deployments with per-tenant calibration.
- Federated learning of proposal patterns across tenants (with strong privacy preservation; share aggregate calibration signal, not raw proposals).
- New miner: novel-pattern emergence detection (looking for patterns the existing miner set wasn't designed to catch).
- Cost optimization: smarter backtest budgeting based on expected value of information.
- Proposal grouping (related proposals bundled for atomic review).
- Reviewer assist: LLM-generated review summaries for human reviewers.
- Better calibration: per-miner, per-tool, per-task-family.

**Milestones:**

- **Month 3:** Multi-tenancy + privacy preservation.
- **Month 4:** Novel-pattern miner + cost optimization.
- **Month 5:** Reviewer assist + advanced calibration.

### 9.4 V3 — Ecosystem (months 5+)

- Open miner-definition spec (community-contributed miners).
- Open proposal-schema spec (interoperability across agent stacks).
- Public benchmark for meta-learning over agent systems (academic-facing).
- SDK for integrating GLearn-style reflection into other agent platforms.
- Annual structural review process (does the miner set itself need rework?).

### 9.5 Engineering principles to enforce throughout

- **Read-only on data; write-only via proposals.** Never violated.
- **No proposal without a backtest.** Never violated.
- **Calibration is public.** Predicted-vs-observed always visible.
- **Bounded autonomy by tier.** Tier 3 and Tier 4 always require human review.
- **GLearn does not modify GLearn.** Never violated.
- **The conscience floor cannot be weakened by GLearn.** Architecturally enforced upstream.
- **Rollback is first-class.** Every accepted proposal carries its rollback plan.

---

## 10. Risks & Mitigations

### 10.1 Technical risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Counterfactual backtests systematically over-predict gains | High | Critical | Calibration loop tightens; weak-tier proposals required to clear higher confidence bars |
| Miners over-fire (too many low-significance patterns) | High | High | Statistical filters; pattern aggregator dedup; per-miner significance tuning |
| Miners miss real patterns (under-fire) | Medium | High | Annual structural review; new-miner addition process |
| Causal confusion (correlations mistaken for causes) | High | Critical | Counterfactual framework; explicit confounding analysis in evaluator |
| Concept drift (patterns from past don't apply to future) | High | High | Cycle recency weighting; rollback monitoring catches drift in retrospect |
| Cost runs over budget on backtesting | Medium | Medium | Hard budget caps; downgrade backtest strength tier when budget tight |
| Proposal queue stuck waiting for human review | Medium | Medium | Auto-defer after N days; surface stale proposals; SLA on reviewer response |
| GLearn's own machinery has a bug that propagates bad proposals | Medium | High | Mandatory backtest gate; rollback first-class; bounded impact tiers |

### 10.2 Product risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Pattern-matched to "AI suggestion box" products and discounted | Medium | High | Lead with counterfactual backtesting as the differentiator |
| Tool owners resent proposals from a meta-system | Medium | High | Proposals are advisory; tool owners always authoritative; framing is "extra pair of eyes" not "boss" |
| Calibration dashboard reveals embarrassing miss rates early | High | Medium | Treat as a feature: visibility builds trust over time; conservative initial proposal cadence |
| Customers want GLearn to be more autonomous | High | Medium | Defer; bounded autonomy is the safety feature; do not yield |
| Customers want GLearn to do things outside scope (generate goals, modify base models) | Medium | Medium | Refuse; document the boundaries publicly |

### 10.3 Ethical and systemic risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| GLearn's optimization creates monoculture (all tools converge to same configurations) | Medium | High | Diversity constraints in proposal generation; explicit anti-monoculture miners |
| GLearn proposes weakening of safety constraints (e.g., conscience floor) | Medium | Critical | Architecturally blocked at GToM API; cannot happen regardless of impact tier |
| Reviewers rubber-stamp proposals without real review | Medium | High | Reviewer calibration tracking; require rationale for high-tier accepts |
| GLearn becomes opaque (engineers don't know why configurations are what they are) | High | High | Mandatory audit trail; "why is this configuration what it is?" must always be answerable |
| Drift in what GLearn considers "improvement" (e.g., optimizing measurable metrics at expense of unmeasurable ones) | High | High | Multi-dimensional success metrics; periodic human review of what's being optimized |

### 10.4 Hackathon-specific risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Reflection / batch / meta is hard to make exciting in 90 seconds | Critical | Critical | Lean hard on the war-room visual; pegboard animation; the "strategist" framing carries the demo |
| The pattern isn't visible enough to land | High | Critical | Seed corpus deliberately; pre-build the chart; rehearse narration |
| Backtest beat feels like a loading spinner | High | High | Visual replay: show historical runs being re-simulated with the new config in side panels |
| The "improvement on next run" beat fails | Medium | Critical | Pre-record the final run for the worst case; live-run only if rehearsed solid |
| Audience confuses GLearn with the other tools | Medium | Medium | Strong opening line: "the other five tools work. GLearn watches them work and writes them a better playbook for tomorrow." |

---

## 11. Open Questions

1. **Causal robustness in counterfactual evaluation.** Replay-based backtests assume that the only difference between original and counterfactual is the proposed change. In practice, model nondeterminism and environmental change confound this. How much can we trust replay? Open and ongoing.

2. **The right cadence for monthly cycles.** A month is a long time in an evolving production system. Should monthly cycles run on a 4-week rolling basis instead of calendar months? V1 starts with calendar months; revisit.

3. **Miner extensibility risk.** Adding new miners is supposed to be lightweight. But each new miner introduces a new failure surface and a new calibration target. How do we keep the set lean? Open governance question.

4. **The "novel pattern" problem.** GLearn's miners are designed for known categories of pattern. Truly novel patterns (kinds nobody's thought of) won't be caught. V2's novel-pattern emergence miner is a start but is itself an open research problem.

5. **Cross-tenant transfer.** Can patterns learned in tenant A's data inform tenant B? Privacy says no for raw data; aggregates may be safe. Federated approaches in V2 — research-grade, deserves care.

6. **Backtest gaming.** Once tool owners know proposals must pass backtests, will they optimize for backtest-friendliness rather than real improvement? Goodhart risk. Mitigation: post-deployment monitoring is the ground truth, not backtests; proposals that pass backtest but fail in production are flagged.

7. **The boundary on "structural changes."** What counts as a structural change to a tool vs. a parameter tweak? The taxonomy here matters because Tier 4 requires extra review. Initial answer: schema or library changes are structural; parameter changes are not. Will need refinement.

8. **Calibration over reviewer behavior.** GLearn calibrates against reviewer accept/reject patterns. Could this feedback loop subtly converge toward proposals that "look good to reviewers" rather than proposals that actually work? Open concern; mitigation is that post-deployment outcomes are also part of the calibration target.

9. **Sunset criteria.** If GLearn turns out not to be earning its keep — proposals aren't realized, calibration is bad, rollback rate is high — what's the sunset criteria? Set in advance, not in the moment.

---

## 12. Appendix

### 12.1 Glossary

- **Cycle** — one run of GLearn on a given cadence.
- **Snapshot** — point-in-time consistent view of the cross-tool data corpus.
- **Miner** — specialized component that looks for a category of pattern.
- **Pattern** — structured record of something interesting found by a miner.
- **Hypothesis / Proposal** — typed refinement targeted at a consuming tool.
- **Backtest** — counterfactual evaluation of a proposal against historical data.
- **Backtest strength** — strong / weak / structural / unavailable.
- **Impact tier** — 1 (trivial) to 4 (structural); gates auto-accept eligibility.
- **Realization** — observed improvement of a deployed proposal vs. predicted.
- **Rollback** — automated reversion of a deployed proposal that underperforms.
- **The strategist** — the cyberpunk framing for GLearn's role in the crew.

### 12.2 Versioning

This document is v0.1. Material changes require a version bump.

### 12.3 The architectural insight worth restating

The five existing tools each have a local learning loop that operates within their own data and their own time horizon. They are good at refining themselves on the slice of the world they can see. They are blind to what spans tools, spans time, or spans tasks.

GLearn is the layer that sees what no single tool can see. It is structurally bounded — read-only on data, write-only via proposals, no self-modification, no goal generation, mandatory backtesting, mandatory rollback — because the failure modes of unbounded reflective systems are well-known and severe.

It is the *strategist*, not the *commander*. It writes notes. The crew reads them.

This is the system that makes the rest of the stack get measurably better over months instead of staying static. It is not the AGI step. It is the *making-the-product-good* step. Those are different things. This document is committed to that distinction.

Build it bounded. Make it earn its keep through calibration. Let it shine in its own modest, well-defined way.

---

*End of GLearn DDD v0.1.*
