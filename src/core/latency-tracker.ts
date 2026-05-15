/**
 * Latency Tracker for GLearn
 * Tracks operation latency and performance metrics
 */

import { logger } from './logger.js';

export interface LatencyEntry {
  timestamp: Date;
  operation: string;
  duration: number;
  metadata?: Record<string, unknown>;
}

export class LatencyTracker {
  private entries: LatencyEntry[] = [];

  record(operation: string, duration: number, metadata?: Record<string, unknown>): void {
    const entry: LatencyEntry = {
      timestamp: new Date(),
      operation,
      duration,
      metadata,
    };
    
    this.entries.push(entry);
    logger.debug('Latency recorded', { operation, duration });
  }

  getAverageLatency(operation?: string): number {
    const filtered = operation 
      ? this.entries.filter(e => e.operation === operation)
      : this.entries;
    
    if (filtered.length === 0) return 0;
    
    const sum = filtered.reduce((acc, e) => acc + e.duration, 0);
    return sum / filtered.length;
  }

  getP95Latency(operation?: string): number {
    const filtered = operation 
      ? this.entries.filter(e => e.operation === operation)
      : this.entries;
    
    if (filtered.length === 0) return 0;
    
    const sorted = filtered.map(e => e.duration).sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    return sorted[p95Index];
  }

  getMaxLatency(operation?: string): number {
    const filtered = operation 
      ? this.entries.filter(e => e.operation === operation)
      : this.entries;
    
    if (filtered.length === 0) return 0;
    
    return Math.max(...filtered.map(e => e.duration));
  }

  getEntries(limit?: number): LatencyEntry[] {
    return limit ? this.entries.slice(-limit) : [...this.entries];
  }

  clear(): void {
    this.entries = [];
    logger.info('LatencyTracker cleared');
  }
}
