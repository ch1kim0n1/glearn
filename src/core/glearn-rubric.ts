import * as crypto from 'crypto';
import { RubricFramework } from '../types/quality-rubric.js';

export const GLEARN_RUBRIC_V1: RubricFramework = {
  name: 'glearn_v1',
  version: '1.0',
  dimensions: [
    {
      name: 'pattern_quality',
      description: 'Discovered patterns are meaningful and actionable',
      min: 0,
      max: 1,
      weight: 0.3,
      pass_floor: 0.4,
    },
    {
      name: 'proposal_relevance',
      description: 'Proposed changes address real problems',
      min: 0,
      max: 1,
      weight: 0.25,
      pass_floor: 0.4,
    },
    {
      name: 'statistical_significance',
      description: 'Findings have statistical backing',
      min: 0,
      max: 1,
      weight: 0.2,
      pass_floor: 0.3,
    },
    {
      name: 'data_coverage',
      description: 'Sufficient data to support conclusions',
      min: 0,
      max: 1,
      weight: 0.15,
      pass_floor: 0.3,
    },
    {
      name: 'cross_tool_correlation',
      description: 'Patterns correlate across multiple tools',
      min: 0,
      max: 1,
      weight: 0.1,
      pass_floor: 0.2,
    },
  ],
  overall_pass_criteria: {
    all_above_floor: true,
    weighted_mean_floor: 0.45,
  },
};

export function getRubricHash(rubric: RubricFramework): string {
  const str = JSON.stringify(rubric);
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  return hash.substring(0, 8);
}
