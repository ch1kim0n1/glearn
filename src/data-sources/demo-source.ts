import * as crypto from 'crypto';
import { Pattern } from '../types/index.js';

export class DemoDataSource {
  async load(): Promise<Pattern[]> {
    return [
      {
        pattern_id: crypto.randomUUID(),
        pattern_type: 'configuration_optimization',
        description: 'High latency when parallel execution exceeds 5 concurrent tasks',
        confidence: 0.85,
        first_observed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        observation_count: 42,
        evidence: [
          'gorchestrator-2024-01-15: latency increased by 300% at n=6',
          'gorchestrator-2024-01-16: latency increased by 280% at n=7',
          'gorchestrator-2024-01-17: latency increased by 320% at n=8',
        ],
        source_tools: ['gorchestrator'],
        metadata: {
          source: 'demo',
          recommendation: 'Cap parallelism at 5 or scale horizontally',
        },
      },
      {
        pattern_id: crypto.randomUUID(),
        pattern_type: 'cost_anomaly',
        description: 'LLM cost spikes when temperature > 0.9 in code generation tasks',
        confidence: 0.72,
        first_observed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        observation_count: 28,
        evidence: [
          'gagent-2024-01-18: cost 2.3x baseline at temp=0.95',
          'gagent-2024-01-19: cost 2.1x baseline at temp=0.92',
        ],
        source_tools: ['gagent'],
        metadata: {
          source: 'demo',
          recommendation: 'Use temperature <= 0.8 for code generation',
        },
      },
      {
        pattern_id: crypto.randomUUID(),
        pattern_type: 'coverage_gap',
        description: 'Error handling patterns missing in 40% of generated code',
        confidence: 0.65,
        first_observed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        observation_count: 156,
        evidence: [
          'gmirror-2024-01-14: 38% of outputs lack try-catch',
          'gmirror-2024-01-15: 42% of outputs lack error handling',
          'gmirror-2024-01-16: 41% of outputs lack error handling',
        ],
        source_tools: ['gmirror'],
        metadata: {
          source: 'demo',
          recommendation: 'Add error handling requirement to quality rubric',
        },
      },
    ];
  }
}
