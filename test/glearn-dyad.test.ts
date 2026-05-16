import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GLearn } from '../src/core/glearn';
import { DyadDataSource } from '../src/types/index';

jest.setTimeout(30000);

const dyadSource = (
  dyad_id: string,
  events: DyadDataSource['events'],
): DyadDataSource => ({
  source: 'dyad',
  dyad_id,
  time_range: {
    start: '2026-05-16T10:00:00.000Z',
    end: '2026-05-16T11:00:00.000Z',
  },
  events,
});

const bids = (participants: Array<'a' | 'b'>, startMs = Date.parse('2026-05-16T10:00:00.000Z')) =>
  participants.map((participant, index) => ({
    type: 'bid' as const,
    participant,
    bid_type: 'attention',
    bid_id: `bid-${index}`,
    timestamp: new Date(startMs + index * 60_000).toISOString(),
  }));

const towardResponses = (count: number, startMs = Date.parse('2026-05-16T10:30:00.000Z')) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'response' as const,
    to_bid_id: `bid-${index}`,
    response_type: 'toward' as const,
    participant: index % 2 === 0 ? 'a' as const : 'b' as const,
    timestamp: new Date(startMs + index * 60_000).toISOString(),
  }));

describe('GLearn DYAD integration', () => {
  let oldDbPath: string | undefined;
  let oldDyadMode: string | undefined;
  let oldDyadData: string | undefined;

  beforeEach(() => {
    oldDbPath = process.env.GLEARN_DB_PATH;
    oldDyadMode = process.env.GLEARN_DYAD_MODE;
    oldDyadData = process.env.GLEARN_DYAD_DATA;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glearn-dyad-'));
    process.env.GLEARN_DB_PATH = path.join(dir, 'glearn.db');
  });

  afterEach(() => {
    if (oldDbPath === undefined) delete process.env.GLEARN_DB_PATH;
    else process.env.GLEARN_DB_PATH = oldDbPath;
    if (oldDyadMode === undefined) delete process.env.GLEARN_DYAD_MODE;
    else process.env.GLEARN_DYAD_MODE = oldDyadMode;
    if (oldDyadData === undefined) delete process.env.GLEARN_DYAD_DATA;
    else process.env.GLEARN_DYAD_DATA = oldDyadData;
  });

  it('ingestDyadData records balanced windows without alerts', async () => {
    const glearn = new GLearn();
    await glearn.ingestDyadData(dyadSource('dyad-balanced', [
      ...bids(['a', 'b', 'a', 'b', 'b']),
      ...towardResponses(4),
    ]));

    expect(glearn.getDyadHealthMetrics('dyad-balanced')).toHaveLength(1);
    expect(glearn.getDyadHealthAlerts('dyad-balanced')).toHaveLength(0);
  });

  it('alerts when bid responsiveness deteriorates and labor ratio is imbalanced', async () => {
    const glearn = new GLearn();
    await glearn.ingestDyadData(dyadSource('dyad-alert', [
      ...bids(['a', 'b', 'a', 'b', 'b']),
      ...towardResponses(4),
    ]));
    await glearn.ingestDyadData(dyadSource('dyad-alert', [
      ...bids(['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b', 'b'], Date.parse('2026-05-16T12:00:00.000Z')),
      ...towardResponses(5, Date.parse('2026-05-16T12:30:00.000Z')),
    ]));

    const alerts = glearn.getDyadHealthAlerts('dyad-alert');
    expect(alerts.some(alert => alert.metric === 'bid_acceptance_rate')).toBe(true);
    expect(alerts.some(alert => alert.metric === 'labor_ratio')).toBe(true);
  });

  it('does not alert on a single-event window', async () => {
    const glearn = new GLearn();
    await glearn.ingestDyadData(dyadSource('dyad-single', bids(['a'])));

    expect(glearn.getDyadHealthAlerts('dyad-single')).toHaveLength(0);
  });

  (process.env.ANTHROPIC_API_KEY ? it : it.skip)('includes DYAD data in runLearningCycle when GLEARN_DYAD_MODE is true', async () => {
    process.env.GLEARN_DYAD_MODE = 'true';
    process.env.GLEARN_DYAD_DATA = JSON.stringify(dyadSource('dyad-cycle', bids(['a', 'a', 'a', 'a', 'a'])));

    const glearn = new GLearn({
      multiModelConfig: {
        default_tier: 'tier1',
        escalation_enabled: false,
        escalation_triggers: {
          min_confidence: 0.7,
          min_quality_score: 0.5,
          max_ambiguity: 0.5,
        },
        consensus_threshold: 0.8,
        cost_budget_usd_per_hour: 20,
        allow_tier3: false,
      },
    });
    const run = await glearn.runLearningCycle();

    expect(run.status).toBe('completed');
    expect(glearn.getPatterns().some(pattern => pattern.pattern_type === 'bid_cycle')).toBe(true);
  });

  it('enforces the active run cost hard gate after an LLM spend record', async () => {
    const glearn = new GLearn();
    (glearn as any).costLedgerReady = Promise.resolve();
    (glearn as any).costLedger = {
      reserve: jest.fn(() => ({ id: 'reservation-1' })),
      commit: jest.fn(),
    };
    (glearn as any).persistenceDb = {
      transaction: (fn: () => void) => fn(),
      addLlmCall: jest.fn(),
      addCostEntry: jest.fn(),
    };
    (glearn as any).auditLogger = {
      logDecision: jest.fn(),
    };
    (glearn as any).llmClient = {
      getTotalCostUsd: () => 0.02,
    };
    (glearn as any).activeRunCostGate = {
      runId: 'run-1',
      startCostUsd: 0,
      perRunBudgetUsd: 0.01,
      currentTier: 'tier1',
    };

    await expect((glearn as any).recordLLMSpend('test-model', 100, 100, 0.02))
      .rejects.toThrow('Cost hard gate');
  });
});
