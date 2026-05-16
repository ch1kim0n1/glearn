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
