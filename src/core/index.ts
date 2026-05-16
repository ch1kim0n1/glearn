/**
 * Core module exports for GLearn
 */

export { GLearn } from './glearn.js';
export { GLearnPersistenceManager } from './glearn-persistence.js';
export { PatternMiner } from './pattern-miner.js';
export { ProposalGenerator } from './proposal-generator.js';
export { CounterfactualEvaluator } from './counterfactual.js';
export { ReceiptRegistry } from './receipt-registry.js';
export { LLMClient } from './llm-client.js';
export { GStackGBrainSync } from './gstack-gbrain-sync.js';
export type { SyncMode, SyncOptions, SyncResult, SyncStageResult, GBrainSourceAttachment } from './gstack-gbrain-sync.js';
export { DriftDetector } from './drift-detector.js';
export type { DriftMetrics } from './drift-detector.js';
export { CostLedger } from './cost-ledger.js';
export type { CostEntry } from './cost-ledger.js';
export { MultiModelManager } from './multi-model-manager.js';
export type { MultiModelConfig } from './multi-model-manager.js';
export { LatencyTracker } from './latency-tracker.js';
export type { LatencyEntry } from './latency-tracker.js';
export { AuditLogger } from './audit-logger.js';
export type { AuditEntry } from './audit-logger.js';

export type { BrainEngine, EngineConfig, QueryOptions, QueryResult, DatabaseStats, Migration } from './engine.js';
export { SQLiteEngine } from './sqlite-engine.js';
export { createEngine, createDefaultEngine } from './engine-factory.js';
export { Migrator, createMigrator } from './migrate.js';

export { defaultConfig, loadConfig, mergeConfig } from './config.js';
export type { GLearnConfig, TierConfig } from './config.js';
export { generateId, hashString, sleep, retry, debounce, throttle } from './utils.js';
export { Logger, LogLevel, logger } from './logger.js';
export type { LogEntry } from './logger.js';
export {
  GLearnError,
  DatabaseError,
  ValidationError,
  ConfigurationError,
  LLMError,
  PatternError,
  ProposalError,
  CounterfactualError,
} from './errors.js';
export { GLearnServer } from './server.js';
export type { ServerConfig } from './server.js';
