import { describe, it, expect } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { CounterfactualEvaluator } from '../src/core/counterfactual';
import { Proposal, CounterfactualEvaluation } from '../src/types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposal_id: uuidv4(),
    proposal_type: 'configuration_change',
    target_tool: 'GOrchestrator',
    target_component: 'parallelism',
    current_value: { max_parallelism: 5 },
    proposed_value: { max_parallelism: 3 },
    rationale: 'Reduce cost by lowering parallelism',
    expected_impact: {
      improvement: 0.3,
      confidence: 0.75,
      evidence_count: 10,
    },
    risk_assessment: {
      risk_level: 'medium',
      potential_side_effects: ['May slow execution'],
      rollback_plan: 'Revert if success rate drops',
    },
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CounterfactualEvaluator', () => {
  const evaluator = new CounterfactualEvaluator();

  // --------------------------------------------------------------------------
  // 1. evaluateProposal returns a CounterfactualEvaluation with required fields
  // --------------------------------------------------------------------------
  it('evaluateProposal returns an object with all required fields', async () => {
    const proposal = makeProposal();
    const baseline = { success_rate: 0.7, avg_cost: 0.5, error_rate: 0.1 };
    const counterfactual = { success_rate: 0.8, avg_cost: 0.4, error_rate: 0.05 };

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);

    // IDs
    expect(result.evaluation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(result.proposal_id).toBe(proposal.proposal_id);

    // Metrics objects
    expect(result.baseline_metrics).toEqual(baseline);
    expect(result.counterfactual_metrics).toEqual(counterfactual);

    // Delta
    expect(typeof result.delta).toBe('object');

    // Statistical significance in [0, 1]
    expect(result.statistical_significance).toBeGreaterThanOrEqual(0);
    expect(result.statistical_significance).toBeLessThanOrEqual(1);

    // Conclusion and recommendation are valid enum values
    expect(['positive', 'neutral', 'negative']).toContain(result.conclusion);
    expect(['apply', 'ignore', 'needs_more_data']).toContain(result.recommendation);

    // Timestamp
    expect(typeof result.evaluated_at).toBe('string');
  });

  // --------------------------------------------------------------------------
  // 2. Delta is computed correctly: delta[k] = counterfactual[k] - baseline[k]
  // --------------------------------------------------------------------------
  it('computes delta as counterfactual minus baseline for each key', async () => {
    const proposal = makeProposal();
    const baseline = { cost: 1.0, score: 0.6 };
    const counterfactual = { cost: 0.7, score: 0.9 };

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);

    expect(result.delta['cost']).toBeCloseTo(0.7 - 1.0, 10);
    expect(result.delta['score']).toBeCloseTo(0.9 - 0.6, 10);
  });

  it('uses baseline value when a key is missing from counterfactual metrics', async () => {
    const proposal = makeProposal();
    const baseline = { cost: 1.0, score: 0.6 };
    // 'score' is missing from counterfactual
    const counterfactual = { cost: 0.7 };

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual as any);

    // Missing key falls back to baseline → delta should be 0
    expect(result.delta['score']).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 3. Conclusion logic
  // --------------------------------------------------------------------------
  it('returns positive conclusion when most deltas are positive and significance is high', async () => {
    const proposal = makeProposal();
    // Large positive changes relative to baseline → high significance, positive deltas
    const baseline = { a: 1.0 };
    const counterfactual = { a: 5.0 }; // +400%

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.conclusion).toBe('positive');
  });

  it('returns negative conclusion when most deltas are negative and significance is high', async () => {
    const proposal = makeProposal();
    const baseline = { a: 5.0 };
    const counterfactual = { a: 1.0 }; // large decrease

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.conclusion).toBe('negative');
  });

  it('returns neutral conclusion when deltas are tiny (low significance)', async () => {
    const proposal = makeProposal();
    // Identical metrics → zero delta → significance = 0
    const baseline = { cost: 0.5 };
    const counterfactual = { cost: 0.5 };

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.conclusion).toBe('neutral');
    expect(result.statistical_significance).toBeLessThan(0.3);
  });

  // --------------------------------------------------------------------------
  // 4. Recommendation logic
  // --------------------------------------------------------------------------
  it('recommends apply for a strongly positive result', async () => {
    const proposal = makeProposal();
    const baseline = { score: 1.0 };
    const counterfactual = { score: 5.0 }; // big improvement

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.recommendation).toBe('apply');
  });

  it('recommends ignore for a strongly negative result', async () => {
    const proposal = makeProposal();
    const baseline = { score: 5.0 };
    const counterfactual = { score: 1.0 }; // big degradation

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.recommendation).toBe('ignore');
  });

  // --------------------------------------------------------------------------
  // 5. batchEvaluate returns one evaluation per proposal
  // --------------------------------------------------------------------------
  it('batchEvaluate returns one result per proposal', async () => {
    const proposals = [makeProposal(), makeProposal(), makeProposal()];
    const baseline = { cost: 0.5, success_rate: 0.8, error_rate: 0.05 };

    const results = await evaluator.batchEvaluate(proposals, baseline);

    expect(results.length).toBe(proposals.length);
    for (let i = 0; i < proposals.length; i++) {
      expect(results[i].proposal_id).toBe(proposals[i].proposal_id);
    }
  });

  it('batchEvaluate returns empty array for empty proposals list', async () => {
    const baseline = { cost: 0.5, success_rate: 0.8 };
    const results = await evaluator.batchEvaluate([], baseline);
    expect(results).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 6. batchEvaluate each result passes field validation
  // --------------------------------------------------------------------------
  it('every batchEvaluate result has all required fields', async () => {
    const proposals = [makeProposal(), makeProposal()];
    const baseline = { cost: 1.0, success_rate: 0.7 };

    const results = await evaluator.batchEvaluate(proposals, baseline);

    for (const r of results) {
      expect(r.evaluation_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(r.statistical_significance).toBeGreaterThanOrEqual(0);
      expect(r.statistical_significance).toBeLessThanOrEqual(1);
      expect(['positive', 'neutral', 'negative']).toContain(r.conclusion);
      expect(['apply', 'ignore', 'needs_more_data']).toContain(r.recommendation);
      expect(typeof r.evaluated_at).toBe('string');
    }
  });

  // --------------------------------------------------------------------------
  // 7. proposal_id is preserved in evaluation
  // --------------------------------------------------------------------------
  it('evaluateProposal preserves the proposal_id in the evaluation', async () => {
    const proposalId = uuidv4();
    const proposal = makeProposal({ proposal_id: proposalId });
    const baseline = { metric: 0.5 };
    const counterfactual = { metric: 0.6 };

    const result = await evaluator.evaluateProposal(proposal, baseline, counterfactual);
    expect(result.proposal_id).toBe(proposalId);
  });

  it('uses structured LLM causal reasoning when available', async () => {
    const llmClient = {
      getModelByTier: () => 'test-model',
      call: async () => ({
        content: JSON.stringify({
          significance: 0.72,
          conclusion: 'positive',
          recommendation: 'apply',
          reasoning: 'Lower cost with higher success is causally consistent with the proposal.',
        }),
        input_tokens: 10,
        output_tokens: 10,
        model_id: 'test-model',
        cost_usd: 0,
        latency_ms: 1,
      }),
    };
    const llmEvaluator = new CounterfactualEvaluator(llmClient as any);

    const result = await llmEvaluator.evaluateProposal(
      makeProposal(),
      { success_rate: 0.7, cost: 1.0 },
      { success_rate: 0.8, cost: 0.8 },
    );

    expect(result.statistical_significance).toBe(0.72);
    expect(result.conclusion).toBe('positive');
    expect(result.recommendation).toBe('apply');
    expect(result.reasoning).toContain('causally consistent');
  });
});
