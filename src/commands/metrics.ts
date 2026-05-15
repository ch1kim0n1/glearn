/**
 * Metrics command for GLearn
 * View and export metrics
 */

import { Command } from './command-registry.js';
import { GLearn } from '../core/glearn.js';

export const metricsCommand: Command = {
  name: 'metrics',
  description: 'View and export metrics',
  handler: async (args: string[]) => {
    const format = valueAfter(args, '--format') || (args.includes('--prometheus') ? 'prometheus' : args.includes('--otel') ? 'otel' : 'json');
    const glearn = new GLearn();
    if (format === 'prometheus') {
      console.log(glearn.exportPrometheusMetrics());
      return;
    }
    if (format === 'otel') {
      console.log(JSON.stringify(glearn.exportOpenTelemetryMetrics(), null, 2));
      return;
    }
    console.log(JSON.stringify(glearn.getObservabilitySnapshot(), null, 2));
  },
  subcommands: [
    {
      name: 'export',
      description: 'Export metrics',
      handler: async (args: string[]) => {
        const format = args[0] || 'json';
        const glearn = new GLearn();
        if (format === 'prometheus') {
          console.log(glearn.exportPrometheusMetrics());
          return;
        }
        if (format === 'otel') {
          console.log(JSON.stringify(glearn.exportOpenTelemetryMetrics(), null, 2));
          return;
        }
        console.log(JSON.stringify(glearn.getObservabilitySnapshot(), null, 2));
      },
    },
    {
      name: 'reset',
      description: 'Reset metrics',
      handler: async () => {
        console.log('Resetting metrics...');
      },
    },
  ],
};

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
