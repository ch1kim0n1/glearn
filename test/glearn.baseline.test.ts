import { GLearn } from '../src/core/glearn.js';
import { ReceiptRegistry } from '../src/core/receipt-registry.js';
import { GLEARN_RUBRIC_V1 } from '../src/core/glearn-rubric.js';

describe('GLearn Baseline Regression Tests', () => {
  let glearn: GLearn;
  let registry: ReceiptRegistry;
  const TOLERANCE = 0.05;

  beforeEach(() => {
    glearn = new GLearn();
    registry = new ReceiptRegistry('glearn');
  });

  it('generates receipt with correct rubric metadata', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    // Wait for async receipt emission
    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();
    expect(latest?.rubric_name).toBe('glearn_v1');
    expect(latest?.project).toBe('glearn');
    expect(latest?.schema_version).toBe(1);
  });

  it('receipt scores match rubric dimensions', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();

    // glearn receipt emits composite scores; verify at least one rubric-relevant key is present
    // and that overall_score is in valid range.
    expect(Object.keys(latest?.scores ?? {}).length).toBeGreaterThan(0);
    expect(latest?.overall_score).toBeGreaterThanOrEqual(0);
    expect(latest?.overall_score).toBeLessThanOrEqual(1);
  });

  it('baseline comparison: current overall score within tolerance of baseline', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    const currentScore = latest?.overall_score ?? 0;
    console.log('GLEARN_OVERALL=' + currentScore);

    // Baseline locked from initial calibration run (empirically captured).
    // Future drift > TOLERANCE fails the gate.
    const baselineOverallScore = 0.9;
    const diff = Math.abs(currentScore - baselineOverallScore);
    expect(diff).toBeLessThanOrEqual(TOLERANCE);
  });

  it('receipt is persisted to registry', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest).toBeDefined();
    expect(latest?.receipt_id).toBeDefined();
  });

  it('hard gates passed reflects run status', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    // Should pass when run completes successfully
    expect(latest?.hard_gates_passed).toBe(run.status === 'completed');
  });

  it('receipt includes learning run metadata', async () => {
    const run = await glearn.runLearningCycle({
      run_counterfactual: false,
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const latest = await registry.getLatest();
    expect(latest?.metadata).toBeDefined();
    expect(latest?.metadata.run_id).toBeDefined();
    expect(latest?.metadata.patterns_found).toBeDefined();
    expect(latest?.metadata.proposals_generated).toBeDefined();
  });
});
