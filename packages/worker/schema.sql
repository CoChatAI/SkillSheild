CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  latest_version TEXT,
  latest_scanned_version TEXT,
  verdict TEXT DEFAULT 'pending',
  scan_severity TEXT,
  findings_count INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_scanned_at TEXT,
  last_updated_at TEXT NOT NULL,
  r2_key TEXT,
  report_r2_key TEXT,
  metadata TEXT,
  UNIQUE(source, slug)
);

CREATE INDEX idx_skills_source ON skills(source);
CREATE INDEX idx_skills_verdict ON skills(verdict);
CREATE INDEX idx_skills_source_verdict ON skills(source, verdict);
CREATE INDEX idx_skills_last_updated ON skills(last_updated_at);

CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT DEFAULT 'running',
  verdict TEXT,
  severity TEXT,
  findings_count INTEGER DEFAULT 0,
  findings TEXT,
  scanner_version TEXT,
  analyzers_used TEXT,
  error TEXT,
  UNIQUE(skill_id, version)
);

CREATE INDEX idx_scan_runs_skill ON scan_runs(skill_id);
CREATE INDEX idx_scan_runs_status ON scan_runs(status);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);
