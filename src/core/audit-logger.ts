/**
 * Audit Logger for GLearn
 * Logs all important operations for audit trail
 */

import { logger } from './logger.js';

export interface AuditEntry {
  timestamp: Date;
  operation: string;
  userId?: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure';
}

export class AuditLogger {
  private entries: AuditEntry[] = [];

  log(operation: string, details: Record<string, unknown>, result: 'success' | 'failure', userId?: string): void {
    const entry: AuditEntry = {
      timestamp: new Date(),
      operation,
      userId,
      details,
      result,
    };
    
    this.entries.push(entry);
    logger.info('Audit entry logged', { operation, result });
  }

  getEntries(limit?: number): AuditEntry[] {
    return limit ? this.entries.slice(-limit) : [...this.entries];
  }

  getByOperation(operation: string): AuditEntry[] {
    return this.entries.filter(e => e.operation === operation);
  }

  getByUser(userId: string): AuditEntry[] {
    return this.entries.filter(e => e.userId === userId);
  }

  clear(): void {
    this.entries = [];
    logger.info('AuditLogger cleared');
  }
}
