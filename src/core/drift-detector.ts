/**
 * Drift Detector for GLearn
 * Detects concept drift in patterns and proposals
 */

import { logger } from './logger.js';

export interface DriftMetrics {
  timestamp: Date;
  patternDrift: number;
  proposalDrift: number;
  overallDrift: number;
}

export class DriftDetector {
  private baselineMetrics: Map<string, number> = new Map();
  private currentMetrics: Map<string, number> = new Map();

  constructor() {
    logger.info('DriftDetector initialized');
  }

  setBaseline(metrics: Record<string, number>): void {
    for (const [key, value] of Object.entries(metrics)) {
      this.baselineMetrics.set(key, value);
    }
    logger.info('Baseline metrics set', { metrics });
  }

  updateMetrics(metrics: Record<string, number>): void {
    for (const [key, value] of Object.entries(metrics)) {
      this.currentMetrics.set(key, value);
    }
  }

  calculateDrift(): DriftMetrics {
    let totalDrift = 0;
    let count = 0;

    for (const [key, baseline] of this.baselineMetrics.entries()) {
      const current = this.currentMetrics.get(key) || baseline;
      const drift = Math.abs(current - baseline) / baseline;
      totalDrift += drift;
      count++;
    }

    const overallDrift = count > 0 ? totalDrift / count : 0;

    return {
      timestamp: new Date(),
      patternDrift: overallDrift,
      proposalDrift: overallDrift,
      overallDrift,
    };
  }

  detectDrift(threshold: number = 0.1): boolean {
    const metrics = this.calculateDrift();
    const isDrift = metrics.overallDrift > threshold;
    
    if (isDrift) {
      logger.warn('Drift detected', { metrics });
    }
    
    return isDrift;
  }

  reset(): void {
    this.currentMetrics.clear();
    this.baselineMetrics.clear();
    logger.info('DriftDetector reset');
  }
}
