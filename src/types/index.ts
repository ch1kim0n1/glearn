import { z } from 'zod';

// ============================================================================
// Core Type Schemas with Zod Validation
// ============================================================================

export const PatternSchema = z.object({
  pattern_id: z.string().uuid(),
  pattern_type: z.enum([
    'cross_tool_correlation',
    'drift_detection',
    'coverage_gap',
    'configuration_optimization',
    'failure_mode_cluster',
    'cost_anomaly',
    'bid_cycle',
    'repair_window',
    'labor_drift',
    'attachment_signal',
  ]),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  source_tools: z.array(z.string()),
  first_observed: z.string().datetime(),
  observation_count: z.number().int().positive(),
  metadata: z.record(z.any()).optional(),
});

export type Pattern = z.infer<typeof PatternSchema>;

export const ProposalSchema = z.object({
  proposal_id: z.string().uuid(),
  proposal_type: z.enum([
    'configuration_change',
    'profile_update',
    'library_expansion',
    'calibration_adjustment',
    'workflow_optimization',
  ]),
  target_tool: z.enum(['GBrain', 'GStack', 'GOrchestrator', 'GMirror', 'GToM', 'GAgent']),
  target_component: z.string(),
  current_value: z.any(),
  proposed_value: z.any(),
  rationale: z.string(),
  expected_impact: z.object({
    improvement: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    evidence_count: z.number().int().nonnegative(),
  }),
  risk_assessment: z.object({
    risk_level: z.enum(['low', 'medium', 'high']),
    potential_side_effects: z.array(z.string()),
    rollback_plan: z.string(),
  }),
  status: z.enum(['pending', 'approved', 'rejected', 'applied', 'rolled_back']),
  created_at: z.string().datetime(),
  reviewed_at: z.string().datetime().optional(),
  reviewed_by: z.string().optional(),
});

export type Proposal = z.infer<typeof ProposalSchema>;

export const CounterfactualEvaluationSchema = z.object({
  evaluation_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  baseline_metrics: z.record(z.string(), z.number()),
  counterfactual_metrics: z.record(z.string(), z.number()),
  delta: z.record(z.string(), z.number()),
  statistical_significance: z.number().min(0).max(1),
  conclusion: z.enum(['positive', 'neutral', 'negative']),
  recommendation: z.enum(['apply', 'ignore', 'needs_more_data']),
  reasoning: z.string().optional(),
  evaluated_at: z.string().datetime(),
});

export type CounterfactualEvaluation = z.infer<typeof CounterfactualEvaluationSchema>;

export const LearningRunSchema = z.object({
  run_id: z.string().uuid(),
  run_type: z.enum(['pattern_mining', 'proposal_generation', 'counterfactual_eval']),
  status: z.enum(['running', 'completed', 'failed']),
  patterns_found: z.number().int(),
  proposals_generated: z.number().int(),
  evaluations_completed: z.number().int(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  error_message: z.string().optional(),
});

export type LearningRun = z.infer<typeof LearningRunSchema>;

export const DataIngestionRequestSchema = z.object({
  source_tool: z.enum(['GBrain', 'GStack', 'GOrchestrator', 'GMirror', 'GToM']),
  data_type: z.enum([
    'run_records',
    'verdicts',
    'failure_modes',
    'cognitive_states',
    'attempt_results',
    'configurations',
  ]),
  time_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  filters: z.record(z.any()).optional(),
});

export type DataIngestionRequest = z.infer<typeof DataIngestionRequestSchema>;

// ============================================================================
// DYAD Relational Learning Types
// ============================================================================

export const RelationalEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bid'),
    participant: z.enum(['a', 'b']),
    bid_type: z.string(),
    timestamp: z.string().datetime(),
    bid_id: z.string().optional(),
  }),
  z.object({
    type: z.literal('response'),
    to_bid_id: z.string(),
    response_type: z.enum(['toward', 'away', 'against', 'ignored']),
    timestamp: z.string().datetime(),
    participant: z.enum(['a', 'b']).optional(),
  }),
  z.object({
    type: z.literal('repair_attempt'),
    initiator: z.enum(['a', 'b']),
    success: z.boolean(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal('emotional_shift'),
    participant: z.enum(['a', 'b']),
    from: z.string(),
    to: z.string(),
    timestamp: z.string().datetime(),
  }),
]);

export type RelationalEvent = z.infer<typeof RelationalEventSchema>;

export const DyadDataSourceSchema = z.object({
  source: z.literal('dyad'),
  dyad_id: z.string(),
  time_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
  events: z.array(RelationalEventSchema),
});

export type DyadDataSource = z.infer<typeof DyadDataSourceSchema>;

export const LearningRequestSchema = z.object({
  request_id: z.string(),
  source_tool: z.literal('DYAD'),
  data_type: z.literal('relational_event'),
  dyad_id: z.string(),
  timestamp: z.string().datetime(),
  payload: RelationalEventSchema,
  metadata: z.record(z.any()).optional(),
});

export type LearningRequest = z.infer<typeof LearningRequestSchema>;

export const RelationalPatternRecordSchema = z.object({
  pattern_id: z.string(),
  dyad_id: z.string(),
  pattern_type: z.enum(['bid_cycle', 'repair_window', 'labor_drift', 'attachment_signal']),
  signature: z.string(),
  first_seen: z.string().datetime(),
  last_seen: z.string().datetime(),
  occurrence_count: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

export type RelationalPatternRecord = z.infer<typeof RelationalPatternRecordSchema>;

export const EmotionalSnapshotRecordSchema = z.object({
  snapshot_id: z.string(),
  dyad_id: z.string(),
  participant: z.enum(['a', 'b']),
  timestamp: z.string().datetime(),
  bid_rate: z.number().nullable().optional(),
  response_rate: z.number().nullable().optional(),
  labor_ratio: z.number().nullable().optional(),
  repair_attempts: z.number().int().nullable().optional(),
});

export type EmotionalSnapshotRecord = z.infer<typeof EmotionalSnapshotRecordSchema>;

export const DyadContextSchema = z.object({
  dyad_id: z.string(),
  participants: z.object({
    a: z.string().optional(),
    b: z.string().optional(),
  }).optional(),
  ethical_refusal: z.boolean().optional(),
  notes: z.string().optional(),
});

export type DyadContext = z.infer<typeof DyadContextSchema>;

export const RelationalProposalSchema = z.object({
  proposal_id: z.string(),
  dyad_id: z.string(),
  pattern_ids: z.array(z.string()),
  insight_type: z.enum(['bid_pattern', 'repair_opportunity', 'labor_imbalance', 'attachment_dynamic']),
  insight: z.string(),
  confidence: z.number().min(0).max(1),
  grounding: z.array(z.string()).min(1),
  should_surface: z.boolean(),
  suggested_actions: z.array(z.string()),
});

export type RelationalProposal = z.infer<typeof RelationalProposalSchema>;

export const EmotionalTrajectorySchema = z.object({
  predicted_state_30min: z.string(),
  predicted_state_24h: z.string(),
  repair_probability: z.number().min(0).max(1),
  escalation_probability: z.number().min(0).max(1),
});

export type EmotionalTrajectory = z.infer<typeof EmotionalTrajectorySchema>;

export const RelationalCounterfactualInputSchema = z.object({
  dyad_id: z.string(),
  event: RelationalEventSchema,
  actual_response: z.enum(['toward', 'away', 'against', 'ignored']),
  message_window: z.array(RelationalEventSchema),
});

export type RelationalCounterfactualInput = z.infer<typeof RelationalCounterfactualInputSchema>;

export const RelationalCounterfactualResultSchema = z.object({
  counterfactual_id: z.string(),
  original_trajectory: EmotionalTrajectorySchema,
  alternative_trajectory: EmotionalTrajectorySchema,
  divergence_score: z.number().min(0).max(1),
  key_bifurcation: z.string(),
  confidence: z.number().min(0).max(1),
});

export type RelationalCounterfactualResult = z.infer<typeof RelationalCounterfactualResultSchema>;

export interface DyadHealthMetrics {
  dyad_id: string;
  timestamp: string;
  bid_acceptance_rate: number;
  repair_success_rate: number;
  labor_ratio: number;
  bid_count: number;
  repair_attempt_count: number;
}

export interface DyadHealthAlert {
  dyad_id: string;
  metric: 'bid_acceptance_rate' | 'repair_success_rate' | 'labor_ratio';
  message: string;
  previous_value?: number;
  current_value: number;
  change?: number;
  timestamp: string;
}

// ============================================================================
// Tool-Specific Data Types
// ============================================================================

export const GBrainDataSchema = z.object({
  pages: z.array(z.object({
    page_id: z.string(),
    content: z.string(),
    entities: z.array(z.string()),
    links: z.array(z.object({
      target: z.string(),
      type: z.string(),
    })),
  })),
  searches: z.array(z.object({
    query: z.string(),
    results: z.number(),
    timestamp: z.string().datetime(),
  })),
});

export type GBrainData = z.infer<typeof GBrainDataSchema>;

export const GStackDataSchema = z.object({
  runs: z.array(z.object({
    run_id: z.string(),
    skill: z.string(),
    success: z.boolean(),
    duration_ms: z.number(),
    cost_usd: z.number(),
  })),
  skill_usage: z.record(z.string(), z.number()),
});

export type GStackData = z.infer<typeof GStackDataSchema>;

export const GOrchestratorDataSchema = z.object({
  run_records: z.array(z.object({
    task_id: z.string(),
    attempts: z.number(),
    winner: z.string(),
    total_cost_usd: z.number(),
    total_wall_time_ms: z.number(),
  })),
  configuration_performance: z.record(z.string(), z.object({
    success_rate: z.number(),
    avg_cost: z.number(),
    avg_duration: z.number(),
  })),
});

export type GOrchestratorData = z.infer<typeof GOrchestratorDataSchema>;

export const GMirrorDataSchema = z.object({
  verdicts: z.array(z.object({
    verdict_id: z.string(),
    overall: z.enum(['pass', 'pass_with_warnings', 'risky', 'fail']),
    correctness: z.number(),
    user_outcome: z.number(),
    failure_modes: z.number(),
  })),
  failure_modes: z.array(z.object({
    failure_mode_id: z.string(),
    description: z.string(),
    observation_count: z.number(),
  })),
});

export type GMirrorData = z.infer<typeof GMirrorDataSchema>;

export const GToMDataSchema = z.object({
  vulnerability_states: z.array(z.object({
    timestamp: z.string().datetime(),
    overall_vulnerability: z.number(),
    trend: z.enum(['increasing', 'decreasing', 'stable']),
  })),
  authenticity_scores: z.array(z.object({
    timestamp: z.string().datetime(),
    authenticity_score: z.number(),
    confidence: z.number(),
  })),
});

export type GToMData = z.infer<typeof GToMDataSchema>;

// ============================================================================
// Analysis Types
// ============================================================================

export const CrossToolAnalysisSchema = z.object({
  analysis_id: z.string().uuid(),
  correlation_pairs: z.array(z.object({
    tool_a: z.string(),
    tool_b: z.string(),
    metric_a: z.string(),
    metric_b: z.string(),
    correlation: z.number().min(-1).max(1),
    significance: z.number().min(0).max(1),
  })),
  insights: z.array(z.string()),
  analyzed_at: z.string().datetime(),
});

export type CrossToolAnalysis = z.infer<typeof CrossToolAnalysisSchema>;

export const DriftDetectionSchema = z.object({
  drift_id: z.string().uuid(),
  tool: z.string(),
  metric: z.string(),
  baseline_value: z.number(),
  current_value: z.number(),
  drift_magnitude: z.number(),
  drift_direction: z.enum(['increase', 'decrease']),
  significance: z.number().min(0).max(1),
  detected_at: z.string().datetime(),
});

export type DriftDetection = z.infer<typeof DriftDetectionSchema>;

export const CoverageGapSchema = z.object({
  gap_id: z.string().uuid(),
  tool: z.string(),
  gap_type: z.enum(['scenario', 'persona', 'configuration', 'skill']),
  description: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  recommendations: z.array(z.string()),
  detected_at: z.string().datetime(),
});

export type CoverageGap = z.infer<typeof CoverageGapSchema>;

// ============================================================================
// Learning Verdict
// ============================================================================

export const LearningVerdictSchema = z.object({
  verdict_id: z.string().uuid(),
  learning_run_id: z.string().uuid(),
  overall: z.enum(['successful', 'partial', 'failed', 'needs_more_data']),
  patterns_found: z.number().int().nonnegative(),
  patterns_validated: z.number().int().nonnegative(),
  proposals_generated: z.number().int().nonnegative(),
  proposals_applied: z.number().int().nonnegative(),
  data_quality_score: z.number().min(0).max(1),
  statistical_significance: z.number().min(0).max(1),
  insights: z.array(z.string()),
  limitations: z.array(z.string()),
  created_at: z.string().datetime(),
  execution_receipt: z.any().optional(), // ExecutionReceipt from quality-rubric
});

export type LearningVerdict = z.infer<typeof LearningVerdictSchema>;

// ============================================================================
// Multi-Model Consensus Types
// ============================================================================

export const MultiModelConfigSchema = z.object({
  default_tier: z.enum(['tier1', 'tier2', 'tier3']),
  escalation_enabled: z.boolean(),
  escalation_triggers: z.object({
    min_confidence: z.number().min(0).max(1),
    min_quality_score: z.number().min(0).max(1),
    max_ambiguity: z.number().min(0).max(1),
  }),
  consensus_threshold: z.number().min(0).max(1),
  cost_budget_usd_per_hour: z.number().positive(),
  allow_tier3: z.boolean(),
});

export type MultiModelConfig = z.infer<typeof MultiModelConfigSchema>;

export const ModelTierSchema = z.enum(['tier1', 'tier2', 'tier3']);

export type ModelTier = z.infer<typeof ModelTierSchema>;

export const TierConfigSchema = z.object({
  name: z.string(),
  model_id: z.string(),
  cost_per_1k_tokens_usd: z.number(),
  avg_latency_ms: z.number(),
  use_case: z.string(),
});

export type TierConfig = z.infer<typeof TierConfigSchema>;

export const EscalationMetricsSchema = z.object({
  total_tasks: z.number().int(),
  escalated_tasks: z.number().int(),
  tier1_success_rate: z.number().min(0).max(1),
  tier2_success_rate: z.number().min(0).max(1),
  tier3_success_rate: z.number().min(0).max(1),
  tier1_count: z.number().int(),
  tier2_count: z.number().int(),
  tier3_count: z.number().int(),
  avg_cost_per_task_usd: z.number(),
  avg_latency_ms: z.number(),
  tier1_avg_latency_ms: z.number(),
  tier2_avg_latency_ms: z.number(),
  tier3_avg_latency_ms: z.number(),
  consensus_agreement_rate: z.number().min(0).max(1),
  budget_remaining_usd: z.number(),
});

export type EscalationMetrics = z.infer<typeof EscalationMetricsSchema>;

export const ConsensusResultSchema = z.object({
  similarity_score: z.number().min(0).max(1),
  decision: z.enum(['accept_tier1', 'accept_tier2', 'accept_tier3', 'merge']),
  reason: z.string(),
  tier1_output: z.any(),
  tier2_output: z.any(),
  final_output: z.any(),
});

export type ConsensusResult = z.infer<typeof ConsensusResultSchema>;

// ============================================================================
// Shared Quality Rubric Types (for regression gating and receipts)
// ============================================================================
export * from './quality-rubric.js';
