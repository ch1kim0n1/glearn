// glearn/test/e2e.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { PatternMiner } from '../src/core/pattern-miner';
import { GLearn } from '../src/core/glearn';

describe('GLearn E2E (mocked)', () => {
  let patternMiner: PatternMiner;
  let glearn: GLearn;

  beforeEach(() => {
    patternMiner = new PatternMiner();
    glearn = new GLearn();
  });

  it('initializes GLearn with pattern miner', () => {
    expect(glearn).toBeDefined();
    expect(patternMiner).toBeDefined();
  });

  it('ingests data and mines patterns', async () => {
    patternMiner.ingestData('GOrchestrator', {
      run_records: [
        { task_id: 'test-1', attempts: 1, winner: 'config-a', total_cost_usd: 0.1, total_wall_time_ms: 100 }
      ],
      configuration_performance: {}
    });

    const patterns = await patternMiner.minePatterns();
    expect(patterns).toBeDefined();
  });

  it('detects configuration optimization pattern', async () => {
    patternMiner.ingestData('GOrchestrator', {
      run_records: [
        { task_id: 'test-1', attempts: 1, winner: 'config-expensive', total_cost_usd: 1.2, total_wall_time_ms: 2000 }
      ],
      configuration_performance: {
        'config-expensive': { success_rate: 0.5, avg_cost: 1.2, avg_duration: 2000 }
      }
    });

    const patterns = await patternMiner.minePatterns();
    const configOpt = patterns.find((p: any) => p.pattern_type === 'configuration_optimization');
    expect(configOpt).toBeDefined();
  });

  it('full flow: ingest, mine, get patterns', async () => {
    patternMiner.ingestData('GOrchestrator', {
      run_records: [
        { task_id: 'test-1', attempts: 1, winner: 'config-expensive', total_cost_usd: 0.75, total_wall_time_ms: 1200 }
      ],
      configuration_performance: {
        'config-expensive': { success_rate: 0.6, avg_cost: 0.75, avg_duration: 1200 }
      }
    });

    const patterns = await patternMiner.minePatterns();
    expect(patterns.length).toBeGreaterThan(0);

    const allPatterns = patternMiner.getPatterns();
    expect(allPatterns).toBeDefined();

    patternMiner.clearPatterns();
    expect(patternMiner.getPatterns().length).toBe(0);
  });
});
