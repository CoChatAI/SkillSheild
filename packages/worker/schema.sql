CREATE TABLE IF NOT EXISTS skills (
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
  installs_updated_at TEXT,
  category TEXT,
  first_seen_at TEXT NOT NULL,
  last_scanned_at TEXT,
  last_updated_at TEXT NOT NULL,
  r2_key TEXT,
  report_r2_key TEXT,
  metadata TEXT,
  compliance_verdict TEXT DEFAULT 'pending',
  compliance_severity TEXT,
  UNIQUE(source, slug)
);

CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
CREATE INDEX IF NOT EXISTS idx_skills_verdict ON skills(verdict);
CREATE INDEX IF NOT EXISTS idx_skills_source_verdict ON skills(source, verdict);
CREATE INDEX IF NOT EXISTS idx_skills_last_updated ON skills(last_updated_at);
CREATE INDEX IF NOT EXISTS idx_skills_installs ON skills(installs DESC);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

CREATE TABLE IF NOT EXISTS scan_runs (
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

CREATE INDEX IF NOT EXISTS idx_scan_runs_skill ON scan_runs(skill_id);
CREATE INDEX IF NOT EXISTS idx_scan_runs_status ON scan_runs(status);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total_jobs INTEGER NOT NULL DEFAULT 0,
  queued_jobs INTEGER NOT NULL DEFAULT 0,
  running_jobs INTEGER NOT NULL DEFAULT 0,
  completed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_source ON scrape_runs(source);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status ON scrape_runs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_created_at ON scrape_runs(created_at);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scrape_runs(id),
  source TEXT NOT NULL,
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  error TEXT,
  UNIQUE(run_id, source, slug, version)
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_run ON scrape_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_skill ON scrape_jobs(source, slug);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);
