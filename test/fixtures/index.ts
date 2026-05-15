/**
 * Test fixtures for GLearn
 * Provides reusable test data and mock objects
 */

import { Pattern, Proposal, CounterfactualEvaluation, LearningRun } from '../src/types/index.js';

export const mockPattern: Pattern = {
  pattern_id: '550e8400-e29b-41d4-a716-446655440000',
  pattern_type: 'cross_tool_correlation',
  description: 'Test pattern description',
  confidence: 0.9,
  evidence: ['evidence1', 'evidence2'],
  source_tools: ['GBrain', 'GStack'],
  first_observed: new Date('2024-01-01').toISOString(),
  observation_count: 5,
  metadata: {},
};

export const mockProposal: Proposal = {
  proposal_id: '660e8400-e29b-41d4-a716-446655440001',
  proposal_type: 'configuration_change',
  target_tool: 'GBrain',
  target_component: 'search',
  current_value: 'old_value',
  proposed_value: 'new_value',
  rationale: 'Test rationale',
  expected_impact: {
    improvement: 0.85,
    confidence: 0.9,
    evidence_count: 3,
  },
  risk_assessment: {
    risk_level: 'low',
    potential_side_effects: ['side_effect_1'],
    rollback_plan: 'Rollback plan',
  },
  status: 'pending',
  created_at: new Date('2024-01-01').toISOString(),
};

export const mockCounterfactual: CounterfactualEvaluation = {
  evaluation_id: '770e8400-e29b-41d4-a716-446655440002',
  proposal_id: '660e8400-e29b-41d4-a716-446655440001',
  baseline_metrics: { metric1: 100, metric2: 50 },
  counterfactual_metrics: { metric1: 120, metric2: 60 },
  delta: { metric1: 20, metric2: 10 },
  statistical_significance: 0.95,
  conclusion: 'positive',
  recommendation: 'apply',
  reasoning: 'Test reasoning',
  evaluated_at: new Date('2024-01-01').toISOString(),
};

export const mockLearningRun: LearningRun = {
  run_id: '880e8400-e29b-41d4-a716-446655440003',
  run_type: 'pattern_mining',
  status: 'completed',
  patterns_found: 5,
  proposals_generated: 3,
  evaluations_completed: 2,
  started_at: new Date('2024-01-01').toISOString(),
  completed_at: new Date('2024-01-01T01:00:00').toISOString(),
};

export const mockGBrainData = {
  pages: [
    { id: 1, slug: 'test-page', title: 'Test Page', content: 'Test content' },
  ],
  chunks: [
    { id: 1, page_id: 1, content: 'Test chunk content' },
  ],
};

export const mockGStackData = {
  executions: [
    { id: 'exec-1', task: 'Test task', output: 'Test output' },
  ],
};

export const mockGOrchestratorData = {
  runs: [
    { id: 'run-1', task: 'Test task', attempts: [] },
  ],
};

export const mockGMirrorData = {
  verdicts: [
    { id: 'verdict-1', test_id: 'test-1', passed: true, score: 0.9 },
  ],
};

export const mockGToMData = {
  assessments: [
    { id: 'assess-1', decision: 'Test decision', authentic: true, score: 0.85 },
  ],
};

export const testConfig = {
  gbrainEndpoint: 'http://localhost:3000',
  gstackEndpoint: 'http://localhost:3001',
  gorchestratorEndpoint: 'http://localhost:3002',
  gmirrorEndpoint: 'http://localhost:3003',
  gtomEndpoint: 'http://localhost:3004',
  multiModelConfig: {
    default_tier: 'tier1',
    escalation_enabled: true,
    escalation_triggers: {
      min_confidence: 0.7,
      min_quality_score: 0.5,
      max_ambiguity: 0.5,
    },
    consensus_threshold: 0.8,
    cost_budget_usd_per_hour: 20.0,
    allow_tier3: true,
  },
};

export const mockEscalationMetrics = {
  total_tasks: 100,
  escalated_tasks: 10,
  tier1_success_rate: 0.9,
  tier2_success_rate: 0.85,
  tier3_success_rate: 0.95,
  tier1_count: 90,
  tier2_count: 8,
  tier3_count: 2,
  avg_cost_per_task_usd: 0.5,
  avg_latency_ms: 1000,
  tier1_avg_latency_ms: 800,
  tier2_avg_latency_ms: 1500,
  tier3_avg_latency_ms: 2500,
  consensus_agreement_rate: 0.85,
  budget_remaining_usd: 15.0,
};
