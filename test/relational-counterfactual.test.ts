import { RelationalCounterfactualEvaluator } from '../src/core/relational-counterfactual';
import { RelationalCounterfactualInput } from '../src/types/index';

const baseInput = (actual_response: RelationalCounterfactualInput['actual_response']): RelationalCounterfactualInput => ({
  dyad_id: 'dyad-1',
  event: {
    type: 'bid',
    participant: 'a',
    bid_type: 'attention',
    bid_id: 'bid-1',
    timestamp: '2026-05-16T10:00:00.000Z',
  },
  actual_response,
  message_window: [
    {
      type: 'bid',
      participant: 'a',
      bid_type: 'attention',
      bid_id: 'bid-1',
      timestamp: '2026-05-16T10:00:00.000Z',
    },
    {
      type: 'response',
      to_bid_id: 'bid-1',
      response_type: actual_response,
      timestamp: '2026-05-16T10:01:00.000Z',
    },
  ],
});

const llmClient = {
  getModelByTier: () => 'test-model',
  call: jest.fn(async (_prompt: string, _options: any) => ({
    content: JSON.stringify({
      predicted_state_30min: 'settled',
      predicted_state_24h: 'available for repair',
      repair_probability: 0.7,
      escalation_probability: 0.2,
    }),
    input_tokens: 10,
    output_tokens: 10,
    model_id: 'test-model',
    cost_usd: 0,
    latency_ms: 1,
  })),
};

describe('RelationalCounterfactualEvaluator', () => {
  beforeEach(() => {
    llmClient.call.mockClear();
  });

  it('uses the same message window for ignored vs acknowledged comparison', async () => {
    const evaluator = new RelationalCounterfactualEvaluator(llmClient as any);
    await evaluator.evaluate(baseInput('ignored'));

    expect(llmClient.call).toHaveBeenCalledTimes(2);
    const firstPrompt = llmClient.call.mock.calls[0][0];
    const secondPrompt = llmClient.call.mock.calls[1][0];
    expect(firstPrompt).toContain('"bid_id": "bid-1"');
    expect(secondPrompt).toContain('"bid_id": "bid-1"');
    expect(firstPrompt).toContain('"response_type": "ignored"');
    expect(secondPrompt).toContain('"response_type": "ignored"');
  });

  it('returns zero divergence when the actual response was toward', async () => {
    const evaluator = new RelationalCounterfactualEvaluator(llmClient as any);
    const result = await evaluator.evaluate(baseInput('toward'));

    expect(result.divergence_score).toBe(0);
    expect(result.key_bifurcation.split(' ').length).toBeGreaterThan(5);
  });

  it('evaluates repair rejected vs accepted with fallback trajectories', async () => {
    llmClient.call.mockRejectedValue(new Error('offline'));
    const evaluator = new RelationalCounterfactualEvaluator(llmClient as any);
    const result = await evaluator.evaluate({
      dyad_id: 'dyad-1',
      event: {
        type: 'repair_attempt',
        initiator: 'b',
        success: false,
        timestamp: '2026-05-16T10:05:00.000Z',
      },
      actual_response: 'against',
      message_window: baseInput('against').message_window,
    });

    expect(result.divergence_score).toBeGreaterThan(0);
    expect(result.original_trajectory.repair_probability).toBeLessThan(result.alternative_trajectory.repair_probability);
    llmClient.call.mockReset();
  });
});
