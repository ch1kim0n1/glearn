import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { PatternMiner } from '../src/core/pattern-miner';
import { GOrchestratorData, GMirrorData, GToMData, GStackData, PatternSchema } from '../src/types/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrchestratorData(overrides: Partial<GOrchestratorData> = {}): GOrchestratorData {
  return {
    run_records: [
      { task_id: 't1', attempts: 2, winner: 'config-a', total_cost_usd: 0.10, total_wall_time_ms: 500 },
      { task_id: 't2', attempts: 3, winner: 'config-b', total_cost_usd: 0.20, total_wall_time_ms: 800 },
    ],
    configuration_performance: {},
    ...overrides,
  };
}

function makeMirrorData(overrides: Partial<GMirrorData> = {}): GMirrorData {
  return {
    verdicts: [
      { verdict_id: 'v1', overall: 'pass', correctness: 0.9, user_outcome: 0.85, failure_modes: 0 },
      { verdict_id: 'v2', overall: 'fail', correctness: 0.4, user_outcome: 0.3, failure_modes: 3 },
    ],
    failure_modes: [
      { failure_mode_id: 'fm1', description: 'Hallucination', observation_count: 5 },
    ],
    ...overrides,
  };
}

function makeGToMData(states: Array<{ overall_vulnerability: number }>): GToMData {
  return {
    vulnerability_states: states.map((s, i) => ({
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      overall_vulnerability: s.overall_vulnerability,
      trend: 'stable' as const,
    })),
    authenticity_scores: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PatternMiner', () => {
  let miner: PatternMiner;

  beforeEach(() => {
    miner = new PatternMiner();
  });

  // --------------------------------------------------------------------------
  // 1. Basic output shape
  // --------------------------------------------------------------------------
  it('minePatterns returns an array', async () => {
    miner.ingestData('GOrchestrator', makeOrchestratorData());
    const patterns = await miner.minePatterns();
    expect(Array.isArray(patterns)).toBe(true);
  });

  it('minePatterns returns empty array when no data is ingested', async () => {
    const patterns = await miner.minePatterns();
    expect(patterns).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 2. Required fields on every pattern
  // --------------------------------------------------------------------------
  it('all returned patterns have required fields', async () => {
    // Provide data that generates at least one pattern (high-failure mirror data)
    miner.ingestData('GMirror', makeMirrorData({
      verdicts: [
        { verdict_id: 'v1', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v2', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v3', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
      ],
      failure_modes: [],
    }));

    const patterns = await miner.minePatterns();
    expect(patterns.length).toBeGreaterThan(0);

    for (const p of patterns) {
      // IDs must be valid UUIDs
      expect(p.pattern_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(typeof p.pattern_type).toBe('string');
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(p.evidence)).toBe(true);
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(Array.isArray(p.source_tools)).toBe(true);
      expect(typeof p.description).toBe('string');
      expect(typeof p.first_observed).toBe('string');
      expect(typeof p.observation_count).toBe('number');
    }
  });

  // --------------------------------------------------------------------------
  // 3. High-cost configuration detected as configuration_optimization
  // --------------------------------------------------------------------------
  it('detects high-cost configuration as configuration_optimization pattern', async () => {
    miner.ingestData('GOrchestrator', makeOrchestratorData({
      configuration_performance: {
        'config-expensive': { success_rate: 0.5, avg_cost: 1.20, avg_duration: 2000 },
      },
    }));

    const patterns = await miner.minePatterns();
    const configPatterns = patterns.filter(p => p.pattern_type === 'configuration_optimization');

    expect(configPatterns.length).toBeGreaterThan(0);
    const expensivePattern = configPatterns.find(
      p => p.metadata?.config === 'config-expensive'
    );
    expect(expensivePattern).toBeDefined();
    expect(expensivePattern!.confidence).toBeGreaterThan(0);
  });

  it('does NOT flag low-cost configurations as optimization patterns', async () => {
    miner.ingestData('GOrchestrator', makeOrchestratorData({
      configuration_performance: {
        'config-cheap': { success_rate: 0.9, avg_cost: 0.10, avg_duration: 400 },
      },
    }));

    const patterns = await miner.minePatterns();
    const configPatterns = patterns.filter(p => p.pattern_type === 'configuration_optimization');
    expect(configPatterns.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. GMirror failure modes produce coverage_gap patterns
  // --------------------------------------------------------------------------
  it('generates coverage_gap pattern when GMirror failure rate is high', async () => {
    // 4 out of 5 verdicts are failures → 80 % failure rate > threshold 0.3
    miner.ingestData('GMirror', makeMirrorData({
      verdicts: [
        { verdict_id: 'v1', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v2', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v3', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v4', overall: 'fail', correctness: 0.2, user_outcome: 0.1, failure_modes: 2 },
        { verdict_id: 'v5', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
      ],
      failure_modes: [
        { failure_mode_id: 'fm1', description: 'Hallucination', observation_count: 10 },
      ],
    }));

    const patterns = await miner.minePatterns();
    const gapPatterns = patterns.filter(
      p => p.pattern_type === 'coverage_gap' && p.source_tools.includes('GMirror')
    );
    expect(gapPatterns.length).toBeGreaterThan(0);
  });

  it('does NOT generate a coverage_gap pattern when GMirror failure rate is low', async () => {
    miner.ingestData('GMirror', makeMirrorData({
      verdicts: [
        { verdict_id: 'v1', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
        { verdict_id: 'v2', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
        { verdict_id: 'v3', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
        { verdict_id: 'v4', overall: 'pass', correctness: 0.9, user_outcome: 0.9, failure_modes: 0 },
        { verdict_id: 'v5', overall: 'fail', correctness: 0.3, user_outcome: 0.2, failure_modes: 1 },
      ],
      failure_modes: [],
    }));

    const patterns = await miner.minePatterns();
    const mirrorGapPatterns = patterns.filter(
      p => p.pattern_type === 'coverage_gap' && p.source_tools.includes('GMirror')
    );
    expect(mirrorGapPatterns.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 5. Cross-tool correlation when |r| > 0.5
  // --------------------------------------------------------------------------
  it('produces cross_tool_correlation pattern for strongly correlated GOrchestrator + GMirror data', async () => {
    // Build perfectly positively correlated cost ↔ correctness arrays
    const n = 10;
    const runRecords = Array.from({ length: n }, (_, i) => ({
      task_id: `t${i}`,
      attempts: 1,
      winner: 'config-a',
      total_cost_usd: 0.1 * (i + 1),
      total_wall_time_ms: 100,
    }));
    const verdicts = Array.from({ length: n }, (_, i) => ({
      verdict_id: `v${i}`,
      overall: 'pass' as const,
      correctness: 0.1 * (i + 1),
      user_outcome: 0.5,
      failure_modes: 0,
    }));

    miner.ingestData('GOrchestrator', { run_records: runRecords, configuration_performance: {} });
    miner.ingestData('GMirror', { verdicts, failure_modes: [] });

    const patterns = await miner.minePatterns();
    const corrPatterns = patterns.filter(p => p.pattern_type === 'cross_tool_correlation');
    expect(corrPatterns.length).toBeGreaterThan(0);
    for (const p of corrPatterns) {
      expect(p.confidence).toBeGreaterThan(0.5);
      expect(p.confidence).toBeLessThanOrEqual(1);
    }
  });

  // --------------------------------------------------------------------------
  // 6. Drift detection
  // --------------------------------------------------------------------------
  it('detects drift_detection pattern when vulnerability changes significantly over time', async () => {
    // First 5 states: low vulnerability; last 6 states: high vulnerability → drift > 0.2
    // Need length > 10 (11+) to trigger the drift check
    const states = [
      ...Array.from({ length: 5 }, () => ({ overall_vulnerability: 0.1 })),
      ...Array.from({ length: 6 }, () => ({ overall_vulnerability: 0.8 })),
    ];
    miner.ingestData('GToM', makeGToMData(states));

    const patterns = await miner.minePatterns();
    const driftPatterns = patterns.filter(p => p.pattern_type === 'drift_detection');
    expect(driftPatterns.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 7. getPatterns / getPatternsByType helpers
  // --------------------------------------------------------------------------
  it('getPatterns returns the same patterns as the last minePatterns call', async () => {
    miner.ingestData('GMirror', makeMirrorData({
      verdicts: Array.from({ length: 5 }, (_, i) => ({
        verdict_id: `v${i}`,
        overall: 'fail' as const,
        correctness: 0.2,
        user_outcome: 0.1,
        failure_modes: 1,
      })),
      failure_modes: [],
    }));

    const mined = await miner.minePatterns();
    const stored = miner.getPatterns();
    expect(stored).toEqual(mined);
  });

  it('getPatternsByType filters correctly', async () => {
    miner.ingestData('GOrchestrator', makeOrchestratorData({
      configuration_performance: {
        'expensive-cfg': { success_rate: 0.5, avg_cost: 2.0, avg_duration: 3000 },
      },
    }));
    await miner.minePatterns();

    const configOpts = miner.getPatternsByType('configuration_optimization');
    expect(configOpts.every(p => p.pattern_type === 'configuration_optimization')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 8. clearPatterns
  // --------------------------------------------------------------------------
  it('clearPatterns empties the stored patterns', async () => {
    miner.ingestData('GMirror', makeMirrorData({
      verdicts: Array.from({ length: 5 }, (_, i) => ({
        verdict_id: `v${i}`,
        overall: 'fail' as const,
        correctness: 0.2,
        user_outcome: 0.1,
        failure_modes: 1,
      })),
      failure_modes: [],
    }));
    await miner.minePatterns();
    miner.clearPatterns();
    expect(miner.getPatterns()).toHaveLength(0);
  });

  it('uses injected embedding and description LLM calls for cross-tool patterns', async () => {
    const llmClient = {
      getEmbedding: async () => ({
        embedding: [0.2, 0.8, 0.1],
        input_tokens: 4,
        model_id: 'text-embedding-3-small',
        cost_usd: 0,
        latency_ms: 1,
      }),
      getModelByTier: () => 'test-model',
      call: async () => ({
        content: 'LLM identified shared cost and quality movement across tools.',
        input_tokens: 10,
        output_tokens: 10,
        model_id: 'test-model',
        cost_usd: 0,
        latency_ms: 1,
      }),
    };
    const llmMiner = new PatternMiner(llmClient as any);

    llmMiner.ingestData('GOrchestrator', makeOrchestratorData());
    llmMiner.ingestData('GMirror', makeMirrorData());

    const patterns = await llmMiner.minePatterns();
    const correlation = patterns.find(p => p.pattern_type === 'cross_tool_correlation');

    expect(correlation).toBeDefined();
    expect(correlation!.description).toContain('LLM identified');
  });

  it('validates all DYAD relational pattern types', () => {
    for (const patternType of ['bid_cycle', 'repair_window', 'labor_drift', 'attachment_signal']) {
      expect(() => PatternSchema.parse({
        pattern_id: uuidv4(),
        pattern_type: patternType,
        description: `${patternType} pattern`,
        confidence: 0.8,
        evidence: ['observed'],
        source_tools: ['DYAD'],
        first_observed: new Date().toISOString(),
        observation_count: 5,
      })).not.toThrow();
    }
  });

  it('detects bid_cycle from five bids with no toward responses', async () => {
    const timestamp = Date.parse('2026-05-16T10:00:00.000Z');
    miner.ingestData('DYAD', Array.from({ length: 5 }, (_, index) => ({
      request_id: `dyad-1:bid:${index}`,
      source_tool: 'DYAD',
      data_type: 'relational_event',
      dyad_id: 'dyad-1',
      timestamp: new Date(timestamp + index * 60_000).toISOString(),
      payload: {
        type: 'bid',
        participant: 'a',
        bid_type: 'attention',
        bid_id: `bid-${index}`,
        timestamp: new Date(timestamp + index * 60_000).toISOString(),
      },
    })));

    const patterns = await miner.minePatterns();
    const bidCycle = patterns.find(pattern => pattern.pattern_type === 'bid_cycle');

    expect(bidCycle).toBeDefined();
    expect(bidCycle?.metadata?.dyad_id).toBe('dyad-1');
    expect(bidCycle?.observation_count).toBe(5);
  });

  it('detects labor_drift when participant a makes 80 percent of bids', async () => {
    const timestamp = Date.parse('2026-05-16T10:00:00.000Z');
    const participants = ['a', 'a', 'a', 'a', 'b'] as const;
    miner.ingestData('DYAD', participants.map((participant, index) => ({
      request_id: `dyad-2:bid:${index}`,
      source_tool: 'DYAD',
      data_type: 'relational_event',
      dyad_id: 'dyad-2',
      timestamp: new Date(timestamp + index * 60_000).toISOString(),
      payload: {
        type: 'bid',
        participant,
        bid_type: 'support',
        bid_id: `bid-${index}`,
        timestamp: new Date(timestamp + index * 60_000).toISOString(),
      },
    })));

    const patterns = await miner.minePatterns();
    const laborDrift = patterns.find(pattern => pattern.pattern_type === 'labor_drift');

    expect(laborDrift).toBeDefined();
    expect(laborDrift?.metadata?.dominant_participant).toBe('a');
    expect(laborDrift?.metadata?.participant_a_bid_ratio).toBe(0.8);
  });
});
