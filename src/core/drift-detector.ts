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
  // Relational metrics for DYAD integration
  bidResponseRate?: number;
  repairSuccessRate?: number;
  emotionalLaborBalance?: number;
  attachmentSignalFrequency?: number;
  conflictRiskScore?: number;
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

  recordRelationalMetrics(metrics: {
    bid_response_rate?: number;
    repair_success_rate?: number;
    emotional_labor_balance?: number;
    attachment_signal_frequency?: number;
    conflict_risk_score?: number;
  }): void {
    if (metrics.bid_response_rate !== undefined) {
      this.currentMetrics.set('bid_response_rate', metrics.bid_response_rate);
    }
    if (metrics.repair_success_rate !== undefined) {
      this.currentMetrics.set('repair_success_rate', metrics.repair_success_rate);
    }
    if (metrics.emotional_labor_balance !== undefined) {
      this.currentMetrics.set('emotional_labor_balance', metrics.emotional_labor_balance);
    }
    if (metrics.attachment_signal_frequency !== undefined) {
      this.currentMetrics.set('attachment_signal_frequency', metrics.attachment_signal_frequency);
    }
    if (metrics.conflict_risk_score !== undefined) {
      this.currentMetrics.set('conflict_risk_score', metrics.conflict_risk_score);
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
      // Extract relational metrics if available
      bidResponseRate: this.currentMetrics.get('bid_response_rate'),
      repairSuccessRate: this.currentMetrics.get('repair_success_rate'),
      emotionalLaborBalance: this.currentMetrics.get('emotional_labor_balance'),
      attachmentSignalFrequency: this.currentMetrics.get('attachment_signal_frequency'),
      conflictRiskScore: this.currentMetrics.get('conflict_risk_score'),
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
