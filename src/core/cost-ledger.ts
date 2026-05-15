/**
 * Cost Ledger for GLearn
 * Tracks LLM API costs across operations
 */

import { logger } from './logger.js';

export interface CostEntry {
  timestamp: Date;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export class CostLedger {
  private entries: CostEntry[] = [];
  private totalCost = 0;

  record(entry: Omit<CostEntry, 'timestamp'>): void {
    const costEntry: CostEntry = {
      ...entry,
      timestamp: new Date(),
    };
    
    this.entries.push(costEntry);
    this.totalCost += entry.cost;
    
    logger.debug('Cost recorded', { cost: entry.cost, operation: entry.operation });
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getCostByOperation(operation: string): number {
    return this.entries
      .filter(e => e.operation === operation)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getCostByModel(model: string): number {
    return this.entries
      .filter(e => e.model === model)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getEntries(limit?: number): CostEntry[] {
    return limit ? this.entries.slice(-limit) : [...this.entries];
  }

  reset(): void {
    this.entries = [];
    this.totalCost = 0;
    logger.info('CostLedger reset');
  }

  getSummary(): {
    totalCost: number;
    totalEntries: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } {
    return {
      totalCost: this.totalCost,
      totalEntries: this.entries.length,
      totalInputTokens: this.entries.reduce((sum, e) => sum + e.inputTokens, 0),
      totalOutputTokens: this.entries.reduce((sum, e) => sum + e.outputTokens, 0),
    };
  }
}
