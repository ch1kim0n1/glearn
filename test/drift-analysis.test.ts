import {
  analyzeCohortDrift,
  deriveReceiptVerdictFromDrift,
  deterministicSample,
  executionReceiptToCohortSnapshot,
  parseWindowDuration,
} from '../src/core/drift-analysis.js';
import { ExecutionReceipt } from '../src/types/quality-rubric.js';

const now = new Date('2026-05-15T12:00:00.000Z');

function snapshot(cohort: string, daysAgo: number, metrics: Record<string, number>, frustrated = false) {
  return {
    cohort,
    timestamp: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    count: metrics.count ?? 1,
    total: 1,
    frustrated,
    metrics,
  };
}

function receipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    receipt_id: '22222222-2222-4222-8222-222222222222',
    schema_version: 1,
    timestamp: now.toISOString(),
    project: 'glearn',
    rubric_name: 'glearn_v1',
    rubric_sha8: 'abcdef12',
    input_hash: 'inputhash',
    models_used: ['claude-sonnet-4-6'],
    config_hash: 'confighash',
    verdict: 'risky',
    scores: {
      pattern_quality: { score: 0.7, confidence: 0.8, weight: 0.5 },
    },
    overall_score: 0.7,
    hard_gates_passed: false,
    cost_usd: 0.03,
    metadata: {
      run_type: 'continuous',
      patterns_found: 4,
      proposals_generated: 2,
      evaluations_completed: 1,
    },
    ...overrides,
  };
}

describe('glearn drift analysis', () => {
  it('parses duration windows and samples deterministically with lexical tie-breaking', () => {
    expect(parseWindowDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseWindowDuration('24h')).toBe(24 * 60 * 60 * 1000);
    expect(() => parseWindowDuration('bad')).toThrow();
    expect(deterministicSample(['b', 'a', 'c'], 10, item => item)).toEqual(['a', 'b', 'c']);
  });

  it('detects per-cohort count anomalies and brand-new cohorts', () => {
    const results = analyzeCohortDrift([
      snapshot('continuous', 14, { count: 2, patterns_found: 5 }),
      snapshot('continuous', 13, { count: 2, patterns_found: 5 }),
      snapshot('continuous', 2, { count: 4, patterns_found: 8 }),
      snapshot('continuous', 1, { count: 4, patterns_found: 8 }),
      snapshot('new-run-type', 2, { count: 3 }),
      snapshot('new-run-type', 1, { count: 3 }),
    ], {
      windowMs: parseWindowDuration('7d'),
      minSamples: 2,
      now,
    });

    const continuous = results.find(result => result.cohort === 'continuous');
    const brandNew = results.find(result => result.cohort === 'new-run-type');

    expect(continuous?.anomalies.map(anomaly => anomaly.reason)).toContain('zero_stddev_fallback');
    expect(brandNew?.brand_new).toBe(true);
    expect(brandNew?.anomalies.map(anomaly => anomaly.reason)).toContain('new_cohort_count');
  });

  it('maps receipts into verdict-aware snapshots', () => {
    const mapped = executionReceiptToCohortSnapshot(receipt());
    expect(mapped.cohort).toBe('continuous');
    expect(mapped.frustrated).toBe(true);
    expect(mapped.metrics?.patterns_found).toBe(4);
  });

  it('turns passing receipts risky when detectDrift reports degrading drift', () => {
    expect(deriveReceiptVerdictFromDrift(true, [{
      metric_name: 'patterns_found',
      drift_detected: true,
      baseline_mean: 10,
      current_mean: 4,
      trend: 'degrading',
    }])).toBe('risky');

    expect(deriveReceiptVerdictFromDrift(true, [{
      metric_name: 'cost_usd',
      drift_detected: true,
      baseline_mean: 1,
      current_mean: 3,
      trend: 'improving',
    }])).toBe('risky');

    expect(deriveReceiptVerdictFromDrift(false, [])).toBe('fail');
  });
});
