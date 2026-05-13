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
