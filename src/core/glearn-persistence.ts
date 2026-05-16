import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  EmotionalSnapshotRecord,
  Pattern,
  Proposal,
  RelationalPatternRecord,
} from '../types/index.js';
import { coreLogger } from './observability.js';

export interface StoredLlmCall {
  id?: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  operation?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}

export interface StoredCostEntry {
  id?: string;
  operation: string;
  model_id?: string;
  cost_usd: number;
  timestamp?: string;
  metadata?: Record<string, any>;
}

/**
 * SQLite Persistence Manager for GLearn
 *
 * Stores pattern records for trend analysis and quality tracking.
 * Persistence is REQUIRED - fails if better-sqlite3 cannot be loaded.
 */
export class GLearnPersistenceManager {
  private db: any;
  private dbPath: string;
  private readonly SCHEMA_VERSION = 3;
  private backupDir: string;
  private backupRetentionCount: number;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || process.env.GLEARN_DB_PATH || path.join(os.homedir(), '.glearn', 'glearn.db');
    this.dbPath = resolvedPath;
    const dataDir = path.dirname(resolvedPath);
    this.backupDir = process.env.GLEARN_BACKUP_DIR || path.join(dataDir, 'backups');
    this.backupRetentionCount = Math.max(1, Number(process.env.GLEARN_BACKUP_RETENTION || '10'));
    try {
      const Database = require('better-sqlite3');
      fs.mkdirSync(dataDir, { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.initializeSchema();
    } catch (error) {
      throw new Error(`Persistence is REQUIRED for GLearn: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number } | undefined;
    const currentVersion = row?.version || 0;

    if (currentVersion < this.SCHEMA_VERSION) {
      this.runMigrations(currentVersion);
    }

    this.db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      this.SCHEMA_VERSION,
      new Date().toISOString()
    );
  }

  private runMigrations(fromVersion: number): void {
    const migrations = this.loadMigrations();
    for (const migration of migrations) {
      if (migration.version <= fromVersion || migration.version > this.SCHEMA_VERSION) {
        continue;
      }

      coreLogger.info('Running GLearn persistence migration', {
        version: migration.version,
        name: migration.name,
      });
      this.db.transaction(() => {
        this.executeStatements(migration.sql);
        this.db.prepare('INSERT OR REPLACE INTO migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.name,
          new Date().toISOString()
        );
      })();
    }
  }

  addPattern(pattern: Pattern | {
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp?: string;
    domains: string[];
  }): void {
    const normalized = this.normalizePattern(pattern);
    this.db.prepare(`
      INSERT OR REPLACE INTO patterns
      (pattern_id, name, frequency, stability, score, timestamp, domains, pattern_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.pattern_id,
      normalized.name,
      normalized.frequency,
      normalized.stability,
      normalized.score,
      normalized.timestamp,
      JSON.stringify(normalized.domains),
      normalized.pattern_json
    );
  }

  replacePatterns(patterns: Pattern[]): void {
    this.db.prepare('DELETE FROM patterns').run();
    for (const pattern of patterns) {
      this.addPattern(pattern);
    }
  }

  getPattern(patternId: string): Pattern | null {
    const row = this.db.prepare(`
      SELECT pattern_id, name, frequency, stability, score, timestamp, domains, pattern_json
      FROM patterns WHERE pattern_id = ?
    `).get(patternId) as {
      pattern_id: string;
      name: string;
      frequency: number;
      stability: number;
      score: number;
      timestamp: string;
      domains: string;
      pattern_json?: string;
    } | undefined;

    if (!row) return null;
    return this.rowToPattern(row);
  }

  getRecentPatterns(windowDays: number = 7, limit: number = 1000): Pattern[] {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT pattern_id, name, frequency, stability, score, timestamp, domains, pattern_json
      FROM patterns
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(cutoff, limit) as Array<{
      pattern_id: string;
      name: string;
      frequency: number;
      stability: number;
      score: number;
      timestamp: string;
      domains: string;
      pattern_json?: string;
    }>;

    return rows.map((r) => this.rowToPattern(r));
  }

  getAllPatterns(): Pattern[] {
    const rows = this.db.prepare(`
      SELECT pattern_id, name, frequency, stability, score, timestamp, domains, pattern_json
      FROM patterns
      ORDER BY timestamp DESC
    `).all() as Array<any>;
    return rows.map((row) => this.rowToPattern(row));
  }

  replaceProposals(proposals: Proposal[]): void {
    this.db.prepare('DELETE FROM proposals').run();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO proposals
      (proposal_id, proposal_json, status, target_tool, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const proposal of proposals) {
      stmt.run(
        proposal.proposal_id,
        JSON.stringify(proposal),
        proposal.status,
        proposal.target_tool,
        proposal.created_at
      );
    }
  }

  getAllProposals(): Proposal[] {
    return (this.db.prepare('SELECT proposal_json FROM proposals ORDER BY created_at DESC').all() as Array<{ proposal_json: string }>)
      .map(row => JSON.parse(row.proposal_json) as Proposal);
  }

  replaceDataStore(entries: Array<[string, any]>): void {
    this.db.prepare('DELETE FROM data_store').run();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO data_store (tool, data_json, updated_at)
      VALUES (?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [tool, data] of entries) {
      stmt.run(tool, JSON.stringify(data), now);
    }
  }

  getDataStoreEntries(): Array<[string, any]> {
    return (this.db.prepare('SELECT tool, data_json FROM data_store ORDER BY tool ASC').all() as Array<{ tool: string; data_json: string }>)
      .map(row => [row.tool, JSON.parse(row.data_json)]);
  }

  saveEscalationMetrics(metrics: Record<string, any>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO escalation_metrics (key, value_json, updated_at)
      VALUES ('current', ?, ?)
    `).run(JSON.stringify(metrics), new Date().toISOString());
  }

  loadEscalationMetrics<T extends Record<string, any>>(): T | null {
    const row = this.db.prepare("SELECT value_json FROM escalation_metrics WHERE key = 'current'").get() as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) as T : null;
  }

  saveRelationalPattern(pattern: RelationalPatternRecord): void {
    this.db.prepare(`
      INSERT INTO relational_patterns
      (pattern_id, dyad_id, pattern_type, signature, first_seen, last_seen, occurrence_count, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        dyad_id = excluded.dyad_id,
        pattern_type = excluded.pattern_type,
        signature = excluded.signature,
        last_seen = excluded.last_seen,
        occurrence_count = relational_patterns.occurrence_count + excluded.occurrence_count,
        confidence = excluded.confidence
    `).run(
      pattern.pattern_id,
      pattern.dyad_id,
      pattern.pattern_type,
      pattern.signature,
      pattern.first_seen,
      pattern.last_seen,
      pattern.occurrence_count,
      pattern.confidence
    );
  }

  getRelationalPatterns(dyadId: string): RelationalPatternRecord[] {
    return this.db.prepare(`
      SELECT pattern_id, dyad_id, pattern_type, signature, first_seen, last_seen, occurrence_count, confidence
      FROM relational_patterns
      WHERE dyad_id = ?
      ORDER BY last_seen DESC
    `).all(dyadId) as RelationalPatternRecord[];
  }

  saveEmotionalSnapshot(snapshot: EmotionalSnapshotRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO emotional_snapshots
      (snapshot_id, dyad_id, participant, timestamp, bid_rate, response_rate, labor_ratio, repair_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.snapshot_id,
      snapshot.dyad_id,
      snapshot.participant,
      snapshot.timestamp,
      snapshot.bid_rate ?? null,
      snapshot.response_rate ?? null,
      snapshot.labor_ratio ?? null,
      snapshot.repair_attempts ?? null
    );
  }

  getEmotionalSnapshots(dyadId: string, limit: number = 100): EmotionalSnapshotRecord[] {
    return this.db.prepare(`
      SELECT snapshot_id, dyad_id, participant, timestamp, bid_rate, response_rate, labor_ratio, repair_attempts
      FROM emotional_snapshots
      WHERE dyad_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(dyadId, limit) as EmotionalSnapshotRecord[];
  }

  addLlmCall(call: StoredLlmCall): string {
    const id = call.id || crypto.randomUUID();
    this.db.prepare(`
      INSERT OR REPLACE INTO llm_call_history
      (id, model_id, input_tokens, output_tokens, cost_usd, operation, timestamp, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      call.model_id,
      call.input_tokens,
      call.output_tokens,
      call.cost_usd,
      call.operation || null,
      call.timestamp || new Date().toISOString(),
      call.metadata ? JSON.stringify(call.metadata) : null
    );
    return id;
  }

  addCostEntry(entry: StoredCostEntry): string {
    const id = entry.id || crypto.randomUUID();
    this.db.prepare(`
      INSERT OR REPLACE INTO cost_ledger
      (id, operation, model_id, cost_usd, timestamp, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.operation,
      entry.model_id || null,
      entry.cost_usd,
      entry.timestamp || new Date().toISOString(),
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );
    return id;
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  backup(destinationPath?: string): string {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const backupPath = destinationPath || path.join(
      this.backupDir,
      `glearn-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(this.dbPath, backupPath);
    this.rotateBackups();
    return backupPath;
  }

  restore(sourcePath: string): void {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Backup does not exist: ${sourcePath}`);
    }
    this.db.close();
    fs.copyFileSync(sourcePath, this.dbPath);
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  exportJson(): Record<string, any> {
    return {
      schema_version: this.SCHEMA_VERSION,
      db_path: this.dbPath,
      exported_at: new Date().toISOString(),
      patterns: this.getAllPatterns(),
      proposals: this.getAllProposals(),
      data_store: Object.fromEntries(this.getDataStoreEntries()),
      escalation_metrics: this.loadEscalationMetrics(),
      relational_patterns: this.db.prepare('SELECT * FROM relational_patterns ORDER BY last_seen DESC').all(),
      emotional_snapshots: this.db.prepare('SELECT * FROM emotional_snapshots ORDER BY timestamp DESC').all(),
      llm_call_history: this.db.prepare('SELECT * FROM llm_call_history ORDER BY timestamp DESC').all(),
      cost_ledger: this.db.prepare('SELECT * FROM cost_ledger ORDER BY timestamp DESC').all(),
      migrations: this.db.prepare('SELECT * FROM migrations ORDER BY version ASC').all(),
    };
  }

  cleanupOldData(keepDays: number = 90): void {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare(`DELETE FROM patterns WHERE timestamp < ?`).run(cutoff);
  }

  close(): void {
    this.db.close();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private normalizePattern(pattern: Pattern | {
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp?: string;
    domains: string[];
  }) {
    if ('pattern_type' in pattern) {
      return {
        pattern_id: pattern.pattern_id,
        name: pattern.description,
        frequency: pattern.observation_count,
        stability: pattern.confidence,
        score: pattern.confidence,
        timestamp: pattern.first_observed,
        domains: pattern.source_tools,
        pattern_json: JSON.stringify(pattern),
      };
    }
    return {
      ...pattern,
      timestamp: pattern.timestamp || new Date().toISOString(),
      pattern_json: null,
    };
  }

  private rowToPattern(row: {
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp: string;
    domains: string;
    pattern_json?: string | null;
  }): Pattern {
    if (row.pattern_json) {
      return JSON.parse(row.pattern_json) as Pattern;
    }
    return {
      pattern_id: row.pattern_id,
      pattern_type: 'cross_tool_correlation',
      description: row.name,
      confidence: row.score,
      evidence: [],
      source_tools: JSON.parse(row.domains),
      first_observed: row.timestamp,
      observation_count: row.frequency,
    };
  }

  private rotateBackups(): void {
    const backups = fs.readdirSync(this.backupDir)
      .filter(name => /^glearn-.+\.db$/.test(name))
      .map(name => path.join(this.backupDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const stale of backups.slice(this.backupRetentionCount)) {
      fs.rmSync(stale, { force: true });
    }
  }

  private loadMigrations(): Array<{ version: number; name: string; sql: string }> {
    const migrationDirCandidates = [
      path.join(__dirname, 'migrations'),
      path.join(process.cwd(), 'src', 'core', 'migrations'),
    ];
    const migrationDir = migrationDirCandidates.find(candidate => fs.existsSync(candidate));
    if (!migrationDir) {
      return this.embeddedMigrations();
    }

    return fs.readdirSync(migrationDir)
      .filter(file => /^\d+_.+\.sql$/.test(file))
      .sort()
      .map(file => ({
        version: Number(file.split('_')[0]),
        name: file.replace(/^\d+_/, '').replace(/\.sql$/, ''),
        sql: fs.readFileSync(path.join(migrationDir, file), 'utf8'),
      }));
  }

  private executeStatements(sql: string): void {
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/)) {
      const trimmed = statement.trim();
      if (trimmed) {
        try {
          this.db.exec(trimmed);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/duplicate column name/i.test(message)) {
            continue;
          }
          throw error;
        }
      }
    }
  }

  private embeddedMigrations(): Array<{ version: number; name: string; sql: string }> {
    return [
      {
        version: 1,
        name: 'initial_schema',
        sql: `
          CREATE TABLE IF NOT EXISTS patterns (
            pattern_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            frequency INTEGER NOT NULL,
            stability REAL NOT NULL,
            score REAL NOT NULL,
            timestamp TEXT NOT NULL,
            domains TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_patterns_timestamp ON patterns(timestamp);
          CREATE INDEX IF NOT EXISTS idx_patterns_name ON patterns(name);
        `,
      },
      {
        version: 2,
        name: 'durable_learning_state',
        sql: `
          ALTER TABLE patterns ADD COLUMN pattern_json TEXT;
          CREATE TABLE IF NOT EXISTS proposals (
            proposal_id TEXT PRIMARY KEY,
            proposal_json TEXT NOT NULL,
            status TEXT NOT NULL,
            target_tool TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at);
          CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
          CREATE TABLE IF NOT EXISTS data_store (
            tool TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS escalation_metrics (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS llm_call_history (
            id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            operation TEXT,
            timestamp TEXT NOT NULL,
            metadata_json TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_llm_call_history_timestamp ON llm_call_history(timestamp);
          CREATE TABLE IF NOT EXISTS cost_ledger (
            id TEXT PRIMARY KEY,
            operation TEXT NOT NULL,
            model_id TEXT,
            cost_usd REAL NOT NULL DEFAULT 0,
            timestamp TEXT NOT NULL,
            metadata_json TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cost_ledger_timestamp ON cost_ledger(timestamp);
        `,
      },
      {
        version: 3,
        name: 'dyad_relational_tables',
        sql: `
          CREATE TABLE IF NOT EXISTS relational_patterns (
            pattern_id TEXT PRIMARY KEY,
            dyad_id TEXT NOT NULL,
            pattern_type TEXT NOT NULL,
            signature TEXT NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            confidence REAL NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_relational_patterns_dyad ON relational_patterns(dyad_id);
          CREATE INDEX IF NOT EXISTS idx_relational_patterns_last_seen ON relational_patterns(last_seen);
          CREATE TABLE IF NOT EXISTS emotional_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            dyad_id TEXT NOT NULL,
            participant TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            bid_rate REAL,
            response_rate REAL,
            labor_ratio REAL,
            repair_attempts INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_emotional_snapshots_dyad_timestamp ON emotional_snapshots(dyad_id, timestamp DESC);
        `,
      },
    ];
  }
}
