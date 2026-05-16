import { RelationalProposalGenerator } from '../src/core/relational-proposal-generator';
import { Pattern } from '../src/types/index';

const makePattern = (pattern_type: Pattern['pattern_type'], description = 'observed relational pattern'): Pattern => ({
  pattern_id: '550e8400-e29b-41d4-a716-446655440000',
  pattern_type,
  description,
  confidence: 0.82,
  evidence: ['five observed events'],
  source_tools: ['DYAD'],
  first_observed: '2026-05-16T10:00:00.000Z',
  observation_count: 5,
  metadata: { dyad_id: 'dyad-1' },
});

const llmClient = {
  getModelByTier: () => 'test-model',
  call: jest.fn(async () => ({
    content: JSON.stringify({
      insight_type: 'bid_pattern',
      insight: 'It seems like bids are easier to repair when they are acknowledged early.',
      confidence: 0.81,
      grounding: ['Johnson (EFT): attachment bids and responsiveness'],
      suggested_actions: ['Acknowledge the next bid briefly.'],
    }),
    input_tokens: 10,
    output_tokens: 10,
    model_id: 'test-model',
    cost_usd: 0,
    latency_ms: 1,
  })),
};

describe('RelationalProposalGenerator', () => {
  beforeEach(() => {
    llmClient.call.mockClear();
  });

  it('generates a grounded bid_pattern proposal with a non-blaming system prompt', async () => {
    const generator = new RelationalProposalGenerator(llmClient as any);
    const [proposal] = await generator.generate([makePattern('bid_cycle')], { dyad_id: 'dyad-1' });

    expect(llmClient.call).toHaveBeenCalledTimes(1);
    expect(llmClient.call.mock.calls[0][0]).toContain('Never assign blame');
    expect(proposal.insight_type).toBe('bid_pattern');
    expect(proposal.grounding.length).toBeGreaterThan(0);
    expect(proposal.should_surface).toBe(true);
  });

  it('generates a labor_imbalance proposal for labor_drift patterns', async () => {
    llmClient.call.mockRejectedValueOnce(new Error('offline'));
    const generator = new RelationalProposalGenerator(llmClient as any);
    const [proposal] = await generator.generate([makePattern('labor_drift')], { dyad_id: 'dyad-1' });

    expect(proposal.insight_type).toBe('labor_imbalance');
    expect(proposal.insight).toContain('emotional labor imbalance');
    expect(proposal.grounding.length).toBeGreaterThan(0);
  });

  it('suppresses proposals when ethical refusal applies', async () => {
    const classifier = {
      classify: jest.fn(async () => ({ should_refuse: true, reason: 'unsafe' })),
    };
    const generator = new RelationalProposalGenerator(llmClient as any, classifier);
    const [proposal] = await generator.generate([makePattern('bid_cycle')], { dyad_id: 'dyad-1' });

    expect(classifier.classify).toHaveBeenCalled();
    expect(proposal.should_surface).toBe(false);
  });
});
