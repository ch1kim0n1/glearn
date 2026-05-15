import { GLearn } from '../src/core/glearn';
import { Pattern } from '../src/types/index';

const now = new Date().toISOString();

function pattern(id: string, type: Pattern['pattern_type'], confidence = 0.8): Pattern {
  return {
    pattern_id: id,
    pattern_type: type,
    description: `${type} pattern`,
    confidence,
    evidence: ['e1', 'e2', 'e3'],
    source_tools: ['GStack', 'GMirror'],
    first_observed: now,
    observation_count: 20,
  };
}

function makeLearnerWithPatternBatches(batches: Pattern[][]) {
  const learner = new GLearn();
  const calls: string[] = [];
  const modelsByTier = {
    tier1: 'claude-haiku-4-5-20251001',
    tier2: 'claude-sonnet-4-6',
    tier3: 'claude-opus-4-7',
  };

  (learner as any).patternMiner = {
    minePatterns: async () => batches[calls.length],
  };
  (learner as any).llmClient = {
    getModelByTier: (tier: keyof typeof modelsByTier) => {
      calls.push(tier);
      return modelsByTier[tier];
    },
    getTotalCostUsd: () => 0,
  };

  return { learner, calls };
}

describe('GLearn multi-model consensus', () => {
  it('invokes tier3 when tier1 and tier2 fail consensus', async () => {
    const tier1 = [pattern('11111111-1111-4111-8111-111111111111', 'configuration_optimization', 0.9)];
    const tier2 = [pattern('22222222-2222-4222-8222-222222222222', 'coverage_gap', 0.9)];
    const tier3 = [pattern('33333333-3333-4333-8333-333333333333', 'configuration_optimization', 0.88)];
    const { learner, calls } = makeLearnerWithPatternBatches([tier1, tier2, tier3]);

    const result = await (learner as any).minePatternsWithEscalation();
    const consensus = (learner as any).lastConsensusSummary;

    expect(result).toEqual(tier1);
    expect(calls).toEqual(['tier1', 'tier2', 'tier3']);
    expect(consensus.tier3_invoked).toBe(true);
    expect(consensus.agreed).toBe(true);
    expect(consensus.agreement_ratio).toBeCloseTo(2 / 3);
    expect(consensus.per_dimension_agreement.confidence.wilson_95_ci.lower).toBeGreaterThanOrEqual(0);
    expect(consensus.small_sample_note).toBe(true);
  });

  it('early-stops when tier1 and tier2 agree', async () => {
    const tier1 = [pattern('44444444-4444-4444-8444-444444444444', 'cost_anomaly', 0.82)];
    const tier2 = [pattern('55555555-5555-4555-8555-555555555555', 'cost_anomaly', 0.8)];
    const tier3 = [pattern('66666666-6666-4666-8666-666666666666', 'coverage_gap', 0.9)];
    const { learner, calls } = makeLearnerWithPatternBatches([tier1, tier2, tier3]);

    const result = await (learner as any).minePatternsWithEscalation();
    const consensus = (learner as any).lastConsensusSummary;

    expect(result).toEqual(tier1);
    expect(calls).toEqual(['tier1', 'tier2']);
    expect(consensus.early_stopped).toBe(true);
    expect(consensus.tier3_invoked).toBe(false);
  });

  it('disqualifies model votes with missing dimensions', () => {
    const learner = new GLearn();
    const votes = [
      {
        tier: 'tier1',
        model_id: 'model-a',
        output: [pattern('77777777-7777-4777-8777-777777777777', 'cost_anomaly', 0.8)],
        dimensions: { confidence: 0.8, support: 0.8, evidence: 0.8 },
        disqualified: false,
      },
      {
        tier: 'tier2',
        model_id: 'model-b',
        output: [pattern('88888888-8888-4888-8888-888888888888', 'coverage_gap', 0.8)],
        dimensions: { confidence: 0.8, support: 0.8, evidence: 0.8, coverage: 0.8 },
        disqualified: false,
      },
      {
        tier: 'tier3',
        model_id: 'model-c',
        output: [pattern('99999999-9999-4999-8999-999999999999', 'coverage_gap', 0.81)],
        dimensions: { confidence: 0.81, support: 0.8, evidence: 0.8, coverage: 0.8 },
        disqualified: false,
      },
    ];

    const consensus = (learner as any).evaluatePatternConsensus(votes, true, false);

    expect(votes[0].disqualified).toBe(true);
    expect(votes[0].disqualification_reason).toContain('missing dimensions: coverage');
    expect(consensus.valid_votes).toBe(2);
    expect(consensus.agreed).toBe(true);
    expect(consensus.decision).toBe('accept_tier2');
  });
});
