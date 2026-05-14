import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * SQLite Persistence Manager for GLearn
 *
 * Stores pattern records for trend analysis and quality tracking.
 * Persistence is REQUIRED - fails if better-sqlite3 cannot be loaded.
 */
export class GLearnPersistenceManager {
  private db: any;
  private dbPath: string;
  private readonly SCHEMA_VERSION = 1;

  constructor(dbPath?: string) {
    const dataDir = dbPath || path.join(os.homedir(), '.glearn');
    this.dbPath = path.join(dataDir, 'glearn.db');
    try {
      const Database = require('better-sqlite3');
      fs.mkdirSync(dataDir, { recursive: true });
      this.db = new Database(this.dbPath);
      this.initializeSchema();
    } catch (error) {
      throw new Error('Persistence is REQUIRED for GLearn.');
    }
  }

  private initializeSchema(): void {
    // Schema versioning table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    // Check current schema version
    const row = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const currentVersion = row?.version || 0;

    if (currentVersion < this.SCHEMA_VERSION) {
      this.runMigrations(currentVersion);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patterns (
        pattern_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        frequency INTEGER NOT NULL,
        stability REAL NOT NULL,
        score REAL NOT NULL,
        timestamp TEXT NOT NULL,
        domains TEXT NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_patterns_timestamp ON patterns(timestamp)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_patterns_name ON patterns(name)`);

    // Update schema version
    this.db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      this.SCHEMA_VERSION,
      new Date().toISOString()
    );
  }

  private runMigrations(fromVersion: number): void {
    // Migration framework - add future migrations here
    for (let v = fromVersion + 1; v <= this.SCHEMA_VERSION; v++) {
      console.log(`[GLearnPersistenceManager] Running migration to version ${v}`);
      // Add migration logic here when needed
    }
  }

  addPattern(pattern: {
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp?: string;
    domains: string[];
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO patterns
      (pattern_id, name, frequency, stability, score, timestamp, domains)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pattern.pattern_id,
      pattern.name,
      pattern.frequency,
      pattern.stability,
      pattern.score,
      pattern.timestamp || new Date().toISOString(),
      JSON.stringify(pattern.domains)
    );
  }

  getPattern(patternId: string): {
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp: string;
    domains: string[];
  } | null {
    const row = this.db.prepare(`
      SELECT pattern_id, name, frequency, stability, score, timestamp, domains
      FROM patterns WHERE pattern_id = ?
    `).get(patternId) as {
      pattern_id: string;
      name: string;
      frequency: number;
      stability: number;
      score: number;
      timestamp: string;
      domains: string;
    } | undefined;

    if (!row) return null;
    return { ...row, domains: JSON.parse(row.domains) };
  }

  getRecentPatterns(windowDays: number = 7, limit: number = 1000): Array<{
    pattern_id: string;
    name: string;
    frequency: number;
    stability: number;
    score: number;
    timestamp: string;
    domains: string[];
  }> {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT pattern_id, name, frequency, stability, score, timestamp, domains
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
    }>;

    return rows.map((r) => ({ ...r, domains: JSON.parse(r.domains) }));
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
}
