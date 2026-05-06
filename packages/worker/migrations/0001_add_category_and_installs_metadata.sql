-- Adds category + installs_updated_at columns and indexes that back the
-- popularity sort and category filter on /api/v1/search.
--
-- Apply with `wrangler d1 execute --file=packages/worker/migrations/0001_add_category_and_installs_metadata.sql`.
-- The base schema in schema.sql already contains these columns/indexes for
-- fresh databases.

ALTER TABLE skills ADD COLUMN installs_updated_at TEXT;
ALTER TABLE skills ADD COLUMN category TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_installs ON skills(installs DESC);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
