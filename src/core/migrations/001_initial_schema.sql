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
