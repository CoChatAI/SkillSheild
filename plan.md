
# SkillShield — Full Implementation Plan

> **Purpose:** A security-scanned, edge-hosted CDN mirror of ClawHub and skills.sh. Users point `CLAWHUB_REGISTRY` at SkillShield and get only skills that have passed Cisco's skill-scanner. For skills.sh, we provide a Git-compatible proxy and a forked CLI.
>
> **Stack:** Cloudflare Workers + R2 + D1 (SQLite) + Queues. One small server for webhook ingestion + scan orchestration.
>
> **Domain:** `skillshield.cochat.ai`

---

## 1. Repository Structure

```
skillshield/
├── README.md
├── package.json                    # Monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json
│
├── packages/
│   ├── worker/                     # Cloudflare Worker (edge CDN + API)
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts            # Router entry point
│   │   │   ├── routes/
│   │   │   │   ├── clawhub.ts      # /clawhub/api/v1/* proxy
│   │   │   │   ├── skills.ts       # /skills/* Git-compatible proxy
│   │   │   │   ├── reports.ts      # /reports/* scan reports
│   │   │   │   ├── api.ts          # /api/v1/* unified SkillShield API
│   │   │   │   └── badges.ts       # /badge/* SVG badge generator
│   │   │   ├── lib/
│   │   │   │   ├── r2.ts           # R2 bucket helpers
│   │   │   │   ├── d1.ts           # D1 database queries
│   │   │   │   ├── cache.ts        # Cache-Control logic
│   │   │   │   └── auth.ts         # Optional API key auth
│   │   │   └── types.ts
│   │   └── test/
│   │
│   ├── scanner/                    # Scan orchestrator service
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── index.ts            # Webhook listener + job runner
│   │   │   ├── adapters/
│   │   │   │   ├── clawhub.ts      # ClawHub scraper/fetcher
│   │   │   │   └── skills-sh.ts    # skills.sh scraper/fetcher
│   │   │   ├── scanner.ts          # Cisco skill-scanner wrapper
│   │   │   ├── publisher.ts        # Push results to R2
│   │   │   ├── webhooks.ts         # Webhook ingestion handlers
│   │   │   └── db.ts               # Postgres/SQLite for scan state
│   │   ├── scripts/
│   │   │   ├── full-scrape-clawhub.ts
│   │   │   └── full-scrape-skills.ts
│   │   └── test/
│   │
│   ├── shared/                     # Shared types + utils
│   │   ├── src/
│   │   │   ├── types.ts            # Skill, ScanReport, Verdict types
│   │   │   ├── constants.ts        # Registry URLs, scan policies
│   │   │   └── schemas.ts          # Zod schemas for API responses
│   │   └── package.json
│   │
│   └── dashboard/                  # Optional: public stats dashboard
│       ├── src/                    # Simple static site (Astro or plain HTML)
│       └── package.json
│
├── infrastructure/
│   ├── terraform/                  # Optional IaC for Cloudflare resources
│   │   ├── main.tf
│   │   ├── r2.tf
│   │   ├── d1.tf
│   │   └── dns.tf
│   └── docker-compose.yml          # Local dev: scanner + postgres
│
└── .github/
    └── workflows/
        ├── deploy-worker.yml       # Deploy Cloudflare Worker
        ├── deploy-scanner.yml      # Deploy scanner service
        └── full-scrape.yml         # Manual trigger: full re-scrape
```

---

## 2. Cloudflare Resources

Create these before writing code:

```bash
# R2 Buckets
wrangler r2 bucket create skillshield-skills    # Skill assets (ZIPs, SKILL.md files)
wrangler r2 bucket create skillshield-reports   # Scan reports (JSON)
wrangler r2 bucket create skillshield-meta      # Registry indexes, badges

# D1 Database
wrangler d1 create skillshield-db

# Queue (for async scan jobs)
# Defined in wrangler.toml - created on deploy

# DNS
# CNAME: skillshield.cochat.ai → skillshield-worker.{account}.workers.dev
```

---

## 3. D1 Database Schema

```sql
-- packages/worker/schema.sql

CREATE TABLE skills (
  id TEXT PRIMARY KEY,                    -- "{source}:{slug}" e.g. "clawhub:trello"
  source TEXT NOT NULL,                   -- "clawhub" | "skills-sh"
  slug TEXT NOT NULL,                     -- ClawHub slug or "owner/repo/skill"
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  latest_version TEXT,
  latest_scanned_version TEXT,
  verdict TEXT DEFAULT 'pending',         -- "verified" | "caution" | "blocked" | "pending"
  scan_severity TEXT,                     -- "none" | "low" | "medium" | "high" | "critical"
  findings_count INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  first_seen_at TEXT NOT NULL,            -- ISO 8601
  last_scanned_at TEXT,                   -- ISO 8601
  last_updated_at TEXT NOT NULL,          -- ISO 8601
  r2_key TEXT,                            -- R2 object key for the ZIP/assets
  report_r2_key TEXT,                     -- R2 object key for scan report JSON
  metadata TEXT,                          -- JSON blob for extra fields
  UNIQUE(source, slug)
);

CREATE INDEX idx_skills_source ON skills(source);
CREATE INDEX idx_skills_verdict ON skills(verdict);
CREATE INDEX idx_skills_source_verdict ON skills(source, verdict);
CREATE INDEX idx_skills_last_updated ON skills(last_updated_at);

CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,                    -- UUID
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT DEFAULT 'running',          -- "running" | "completed" | "failed"
  verdict TEXT,
  severity TEXT,
  findings_count INTEGER DEFAULT 0,
  findings TEXT,                          -- JSON array of findings
  scanner_version TEXT,
  analyzers_used TEXT,                    -- JSON array: ["static","behavioral","llm","meta"]
  error TEXT,
  UNIQUE(skill_id, version)
);

CREATE INDEX idx_scan_runs_skill ON scan_runs(skill_id);
CREATE INDEX idx_scan_runs_status ON scan_runs(status);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,                  -- Raw JSON
  processed_at TEXT,
  created_at TEXT NOT NULL
);
```

---

## 4. Cloudflare Worker (Edge CDN + API)

### `wrangler.toml`

```toml
name = "skillshield-worker"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
ENVIRONMENT = "production"

[[r2_buckets]]
binding = "SKILLS_BUCKET"
bucket_name = "skillshield-skills"

[[r2_buckets]]
binding = "REPORTS_BUCKET"
bucket_name = "skillshield-reports"

[[r2_buckets]]
binding = "META_BUCKET"
bucket_name = "skillshield-meta"

[[d1_databases]]
binding = "DB"
database_name = "skillshield-db"
database_id = "<your-d1-id>"

[[queues.producers]]
queue = "scan-jobs"
binding = "SCAN_QUEUE"

[triggers]
routes = ["skillshield.cochat.ai/*"]
```

### Route Map

The Worker handles ALL inbound requests. It serves static assets from R2 and handles API queries from D1.

```
skillshield.cochat.ai/
│
├── /clawhub/api/v1/                        # ClawHub-compatible registry API
│   ├── GET  /skills                        # List/search skills (paginated)
│   ├── GET  /skills/{slug}                 # Skill metadata
│   ├── GET  /skills/{slug}/{version}       # Version-specific metadata
│   └── GET  /download?slug={slug}&version= # Download ZIP (from R2)
│
├── /skills/                                # skills.sh mirror
│   ├── GET  /{owner}/{repo}/{skill}        # Skill metadata (JSON)
│   └── GET  /{owner}/{repo}/{skill}/dl     # Download tarball (from R2)
│
├── /api/v1/                                # SkillShield unified API
│   ├── GET  /search?q={query}&source=      # Search across all registries
│   ├── GET  /verify/{source}/{slug}        # Check verification status
│   ├── GET  /stats                         # Aggregate stats
│   └── GET  /recent                        # Recently scanned skills
│
├── /reports/                               # Scan reports (public)
│   ├── GET  /clawhub/{slug}.json
│   └── GET  /skills/{owner}/{repo}/{skill}.json
│
├── /badge/                                 # Dynamic SVG badges
│   ├── GET  /clawhub/{slug}.svg
│   └── GET  /skills/{owner}/{repo}/{skill}.svg
│
└── /webhooks/                              # Webhook ingestion
    ├── POST /clawhub                       # ClawHub skill.publish events
    └── POST /github                        # GitHub push events (skills.sh repos)
```

### `src/index.ts` — Router

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { clawhubRoutes } from './routes/clawhub';
import { skillsRoutes } from './routes/skills';
import { reportsRoutes } from './routes/reports';
import { apiRoutes } from './routes/api';
import { badgeRoutes } from './routes/badges';
import { webhookRoutes } from './routes/webhooks';

type Env = {
  SKILLS_BUCKET: R2Bucket;
  REPORTS_BUCKET: R2Bucket;
  META_BUCKET: R2Bucket;
  DB: D1Database;
  SCAN_QUEUE: Queue;
  WEBHOOK_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'skillshield' }));

// ClawHub-compatible registry mirror
app.route('/clawhub/api/v1', clawhubRoutes);

// skills.sh mirror
app.route('/skills', skillsRoutes);

// SkillShield API
app.route('/api/v1', apiRoutes);

// Public scan reports
app.route('/reports', reportsRoutes);

// Dynamic SVG badges
app.route('/badge', badgeRoutes);

// Webhook ingestion
app.route('/webhooks', webhookRoutes);

// 404
app.notFound((c) => c.json({
  error: 'not_found',
  message: 'This skill has not been scanned by SkillShield.',
  docs: 'https://skillshield.cochat.ai/api/v1',
}, 404));

export default app;
```

### `src/routes/clawhub.ts` — ClawHub Registry Mirror

This is the critical path. When a user sets `CLAWHUB_REGISTRY=https://skillshield.cochat.ai/clawhub`, the `clawhub` CLI will hit these endpoints.

```typescript
import { Hono } from 'hono';

type Env = {
  SKILLS_BUCKET: R2Bucket;
  DB: D1Database;
};

export const clawhubRoutes = new Hono<{ Bindings: Env }>();

// List/search skills — return only verified + caution skills
clawhubRoutes.get('/skills', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100);
  const cursor = c.req.query('cursor') || '0';
  const query = c.req.query('q');
  const offset = parseInt(cursor);

  let sql = `
    SELECT slug, name, description, author, latest_scanned_version as latest_version,
           verdict, installs, metadata, last_updated_at
    FROM skills
    WHERE source = 'clawhub' AND verdict IN ('verified', 'caution')
  `;
  const params: any[] = [];

  if (query) {
    sql += ` AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)`;
    const q = `%${query}%`;
    params.push(q, q, q);
  }

  sql += ` ORDER BY installs DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  // Transform to match ClawHub's response shape
  const skills = results.map((row: any) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    author: row.author,
    versions: { latest: row.latest_version },
    installs: row.installs,
    ...(row.metadata ? JSON.parse(row.metadata) : {}),
  }));

  return c.json({
    skills,
    nextCursor: results.length === limit ? String(offset + limit) : undefined,
  });
});

// Skill metadata
clawhubRoutes.get('/skills/:slug', async (c) => {
  const { slug } = c.req.param();

  const skill = await c.env.DB.prepare(`
    SELECT * FROM skills WHERE source = 'clawhub' AND slug = ? AND verdict IN ('verified', 'caution')
  `).bind(slug).first();

  if (!skill) {
    // Check if it exists but is blocked
    const blocked = await c.env.DB.prepare(`
      SELECT verdict, scan_severity FROM skills WHERE source = 'clawhub' AND slug = ?
    `).bind(slug).first();

    if (blocked) {
      return c.json({
        error: 'skill_blocked',
        message: `Skill "${slug}" was blocked by SkillShield due to ${blocked.scan_severity} severity security findings.`,
        report: `https://skillshield.cochat.ai/reports/clawhub/${slug}.json`,
      }, 403);
    }
    return c.json({ error: 'not_found' }, 404);
  }

  // Return ClawHub-compatible metadata shape
  const metadata = skill.metadata ? JSON.parse(skill.metadata as string) : {};
  return c.json({
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    author: skill.author,
    versions: { latest: skill.latest_scanned_version },
    installs: skill.installs,
    ...metadata,
  });
});

// Download ZIP — the actual install endpoint
clawhubRoutes.get('/download', async (c) => {
  const slug = c.req.query('slug');
  const version = c.req.query('version');

  if (!slug) return c.json({ error: 'slug required' }, 400);

  const skill = await c.env.DB.prepare(`
    SELECT r2_key, verdict FROM skills WHERE source = 'clawhub' AND slug = ?
  `).bind(slug).first();

  if (!skill || skill.verdict === 'blocked' || skill.verdict === 'pending') {
    return c.json({
      error: skill?.verdict === 'blocked' ? 'skill_blocked' : 'not_found',
      message: skill?.verdict === 'blocked'
        ? `Blocked due to security findings. See report.`
        : 'Skill not found or not yet scanned.',
      report: `https://skillshield.cochat.ai/reports/clawhub/${slug}.json`,
    }, skill?.verdict === 'blocked' ? 403 : 404);
  }

  // Serve ZIP from R2
  const r2Key = version
    ? `clawhub/${slug}/${version}.zip`
    : (skill.r2_key as string);

  const object = await c.env.SKILLS_BUCKET.get(r2Key);
  if (!object) return c.json({ error: 'asset_not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Cache-Control': 'public, max-age=3600',
      'X-SkillShield-Verdict': skill.verdict as string,
    },
  });
});
```

### `src/routes/webhooks.ts` — Webhook Ingestion

```typescript
import { Hono } from 'hono';
import { createHash } from 'node:crypto';

type Env = {
  DB: D1Database;
  SCAN_QUEUE: Queue;
  WEBHOOK_SECRET: string;
};

export const clawhubWebhookRoutes = new Hono<{ Bindings: Env }>();

// ClawHub webhook (Discord-format embed)
clawhubWebhookRoutes.post('/clawhub', async (c) => {
  const body = await c.req.json();

  // ClawHub sends Discord-style embed payloads
  // { embeds: [{ title, description, url, fields: [{name, value}] }] }
  const embed = body?.embeds?.[0];
  if (!embed) return c.json({ error: 'invalid_payload' }, 400);

  // Extract skill info from embed fields
  const version = embed.fields?.find((f: any) => f.name === 'Version')?.value;
  const owner = embed.fields?.find((f: any) => f.name === 'Owner')?.value;
  const slug = embed.url?.split('/').pop(); // https://clawhub.ai/owner/slug

  if (!slug) return c.json({ error: 'cannot_parse_slug' }, 400);

  // Log the event
  const eventId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO webhook_events (id, source, event_type, payload, created_at)
    VALUES (?, 'clawhub', 'skill.publish', ?, ?)
  `).bind(eventId, JSON.stringify(body), new Date().toISOString()).run();

  // Queue a scan job
  await c.env.SCAN_QUEUE.send({
    type: 'scan',
    source: 'clawhub',
    slug,
    version: version?.replace('v', ''),
    owner,
    triggered_by: 'webhook',
    event_id: eventId,
  });

  return c.json({ queued: true, event_id: eventId });
});

// GitHub webhook (for skills.sh repos)
clawhubWebhookRoutes.post('/github', async (c) => {
  const event = c.req.header('X-GitHub-Event');
  const body = await c.req.json();

  // Only process push and release events
  if (event !== 'push' && event !== 'release') {
    return c.json({ skipped: true, reason: 'irrelevant_event' });
  }

  const repo = body.repository?.full_name; // "owner/repo"
  if (!repo) return c.json({ error: 'no_repo' }, 400);

  const eventId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO webhook_events (id, source, event_type, payload, created_at)
    VALUES (?, 'skills-sh', ?, ?, ?)
  `).bind(eventId, event, JSON.stringify(body), new Date().toISOString()).run();

  // Queue scan for all skills in this repo
  await c.env.SCAN_QUEUE.send({
    type: 'scan',
    source: 'skills-sh',
    repo,
    ref: body.ref || body.release?.tag_name,
    triggered_by: 'github_webhook',
    event_id: eventId,
  });

  return c.json({ queued: true, event_id: eventId });
});
```

### `src/routes/badges.ts` — Dynamic SVG Badges

```typescript
import { Hono } from 'hono';

type Env = { DB: D1Database };

export const badgeRoutes = new Hono<{ Bindings: Env }>();

const BADGE_COLORS = {
  verified: '#22c55e',   // green
  caution: '#f59e0b',    // amber
  blocked: '#ef4444',    // red
  pending: '#6b7280',    // gray
};

const BADGE_LABELS = {
  verified: 'verified',
  caution: 'caution',
  blocked: 'blocked',
  pending: 'pending',
};

function renderBadge(verdict: string): string {
  const color = BADGE_COLORS[verdict as keyof typeof BADGE_COLORS] || BADGE_COLORS.pending;
  const label = BADGE_LABELS[verdict as keyof typeof BADGE_LABELS] || 'unknown';
  const leftWidth = 80;
  const rightWidth = verdict === 'verified' ? 70 : 65;
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
    <linearGradient id="b" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <clipPath id="a"><rect width="${totalWidth}" height="20" rx="3"/></clipPath>
    <g clip-path="url(#a)">
      <rect width="${leftWidth}" height="20" fill="#555"/>
      <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
      <rect width="${totalWidth}" height="20" fill="url(#b)"/>
    </g>
    <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">
      <text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">SkillShield</text>
      <text x="${leftWidth / 2}" y="14">SkillShield</text>
      <text x="${leftWidth + rightWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
      <text x="${leftWidth + rightWidth / 2}" y="14">${label}</text>
    </g>
  </svg>`;
}

// Badge for ClawHub skills
badgeRoutes.get('/clawhub/:slug', async (c) => {
  const { slug } = c.req.param();
  const skill = await c.env.DB.prepare(
    'SELECT verdict FROM skills WHERE source = ? AND slug = ?'
  ).bind('clawhub', slug).first();

  const svg = renderBadge(skill?.verdict as string || 'pending');
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300',
    },
  });
});

// Badge for skills.sh skills
badgeRoutes.get('/skills/:owner/:repo/:skill', async (c) => {
  const { owner, repo, skill } = c.req.param();
  const slug = `${owner}/${repo}/${skill}`;
  const result = await c.env.DB.prepare(
    'SELECT verdict FROM skills WHERE source = ? AND slug = ?'
  ).bind('skills-sh', slug).first();

  const svg = renderBadge(result?.verdict as string || 'pending');
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=300',
    },
  });
});
```

### `src/routes/reports.ts` — Public Scan Reports

```typescript
import { Hono } from 'hono';

type Env = { REPORTS_BUCKET: R2Bucket };

export const reportsRoutes = new Hono<{ Bindings: Env }>();

// Serve scan reports from R2 as JSON
reportsRoutes.get('/clawhub/:slug', async (c) => {
  const { slug } = c.req.param();
  const object = await c.env.REPORTS_BUCKET.get(`clawhub/${slug}.json`);
  if (!object) return c.json({ error: 'no_report' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
    },
  });
});

reportsRoutes.get('/skills/:owner/:repo/:skill', async (c) => {
  const { owner, repo, skill } = c.req.param();
  const key = `skills-sh/${owner}/${repo}/${skill}.json`;
  const object = await c.env.REPORTS_BUCKET.get(key);
  if (!object) return c.json({ error: 'no_report' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
    },
  });
});
```

### `src/routes/api.ts` — Unified SkillShield API

```typescript
import { Hono } from 'hono';

type Env = { DB: D1Database };

export const apiRoutes = new Hono<{ Bindings: Env }>();

// Search across all registries
apiRoutes.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const source = c.req.query('source');     // optional: "clawhub" | "skills-sh"
  const verdict = c.req.query('verdict');   // optional: "verified" | "caution" | "blocked"
  const limit = Math.min(parseInt(c.req.query('limit') || '25'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  let sql = 'SELECT * FROM skills WHERE 1=1';
  const params: any[] = [];

  if (q) {
    sql += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  if (verdict) { sql += ' AND verdict = ?'; params.push(verdict); }

  sql += ' ORDER BY installs DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ skills: results, count: results.length, offset });
});

// Verify a specific skill
apiRoutes.get('/verify/:source/:slug{.+}', async (c) => {
  const { source, slug } = c.req.param();
  const skill = await c.env.DB.prepare(
    'SELECT slug, verdict, scan_severity, findings_count, last_scanned_at FROM skills WHERE source = ? AND slug = ?'
  ).bind(source, slug).first();

  if (!skill) return c.json({ verified: false, reason: 'not_scanned' }, 404);

  return c.json({
    verified: skill.verdict === 'verified',
    verdict: skill.verdict,
    severity: skill.scan_severity,
    findings: skill.findings_count,
    scanned_at: skill.last_scanned_at,
    report: `https://skillshield.cochat.ai/reports/${source}/${slug}.json`,
  });
});

// Aggregate stats
apiRoutes.get('/stats', async (c) => {
  const stats = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as total FROM skills'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM skills WHERE verdict = "verified"'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM skills WHERE verdict = "caution"'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM skills WHERE verdict = "blocked"'),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM skills WHERE verdict = "pending"'),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM scan_runs'),
    c.env.DB.prepare('SELECT source, COUNT(*) as count FROM skills GROUP BY source'),
  ]);

  return c.json({
    total_skills: (stats[0].results[0] as any).total,
    verified: (stats[1].results[0] as any).count,
    caution: (stats[2].results[0] as any).count,
    blocked: (stats[3].results[0] as any).count,
    pending: (stats[4].results[0] as any).count,
    total_scans: (stats[5].results[0] as any).total,
    by_source: stats[6].results,
    last_updated: new Date().toISOString(),
  });
});
```

---

## 5. Scanner Service (Backend)

This is the only non-edge component. It runs on a small server (a single Docker container on Hetzner, Fly.io, or Railway) and handles:
1. Receiving scan jobs from the Cloudflare Queue
2. Downloading skills from source registries
3. Running `cisco-ai-skill-scanner`
4. Pushing results to R2 + D1

### Architecture Decision

The scanner **cannot** run on Cloudflare Workers (CPU limits, no Python). It runs as a long-lived Node.js service that polls a Cloudflare Queue (via pull consumer) or receives HTTP requests from the Worker.

**Recommended deployment:** Single Docker container on Hetzner (you already have the AX102). Cost: $0 marginal.

### `Dockerfile`

```dockerfile
FROM node:22-slim AS base

# Install Python for cisco skill-scanner
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv git curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Cisco skill-scanner
RUN python3 -m pip install --break-system-packages cisco-ai-skill-scanner

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/scanner/package.json packages/scanner/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/scanner packages/scanner
COPY packages/shared packages/shared

RUN pnpm -F scanner build

CMD ["node", "packages/scanner/dist/index.js"]
```

### `packages/scanner/src/index.ts` — Main Service

```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { ClawHubAdapter } from './adapters/clawhub';
import { SkillsShAdapter } from './adapters/skills-sh';
import { scanSkill } from './scanner';
import { publishResults } from './publisher';
import { db } from './db';

const app = new Hono();

const adapters = {
  clawhub: new ClawHubAdapter(),
  'skills-sh': new SkillsShAdapter(),
};

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Receive scan jobs from Cloudflare Worker (HTTP push)
app.post('/scan', async (c) => {
  const job = await c.req.json();
  const { source, slug, version, repo } = job;

  console.log(`[scan] Starting: ${source}/${slug || repo} v${version || 'latest'}`);

  try {
    // 1. Fetch skill from source registry
    const adapter = adapters[source as keyof typeof adapters];
    if (!adapter) throw new Error(`Unknown source: ${source}`);

    const skillDir = await adapter.fetch(slug || repo, version);

    // 2. Run Cisco skill-scanner
    const scanResult = await scanSkill(skillDir, {
      useBehavioral: true,
      useLlm: true,
      enableMeta: true,
      policy: 'strict',
    });

    // 3. Determine verdict
    const verdict = determineVerdict(scanResult);

    // 4. Publish to R2 + update D1
    await publishResults({
      source,
      slug: slug || repo,
      version: version || 'latest',
      skillDir,
      scanResult,
      verdict,
    });

    console.log(`[scan] Complete: ${source}/${slug || repo} → ${verdict.verdict}`);
    return c.json({ success: true, verdict });
  } catch (err: any) {
    console.error(`[scan] Failed: ${source}/${slug || repo}`, err);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Full scrape endpoint (trigger manually or via cron)
app.post('/scrape/:source', async (c) => {
  const { source } = c.req.param();
  const adapter = adapters[source as keyof typeof adapters];
  if (!adapter) return c.json({ error: 'unknown source' }, 400);

  // Run in background — don't block the response
  (async () => {
    const skills = await adapter.listAll();
    console.log(`[scrape] Found ${skills.length} skills in ${source}`);
    for (const skill of skills) {
      try {
        const skillDir = await adapter.fetch(skill.slug);
        const scanResult = await scanSkill(skillDir, {
          useBehavioral: true,
          useLlm: true,
          enableMeta: true,
          policy: 'strict',
        });
        await publishResults({
          source,
          slug: skill.slug,
          version: skill.latestVersion || 'latest',
          skillDir,
          scanResult,
          verdict: determineVerdict(scanResult),
        });
      } catch (err: any) {
        console.error(`[scrape] Failed: ${skill.slug}`, err);
      }
    }
  })();

  return c.json({ started: true, source });
});

function determineVerdict(scanResult: any) {
  const maxSeverity = scanResult.max_severity?.toLowerCase() || 'none';
  const findingsCount = scanResult.findings?.length || 0;

  if (maxSeverity === 'critical' || maxSeverity === 'high') {
    return { verdict: 'blocked', severity: maxSeverity, findingsCount };
  }
  if (maxSeverity === 'medium') {
    return { verdict: 'caution', severity: maxSeverity, findingsCount };
  }
  return { verdict: 'verified', severity: maxSeverity || 'none', findingsCount };
}

serve({ fetch: app.fetch, port: 3100 });
console.log('Scanner service running on :3100');
```

### `packages/scanner/src/scanner.ts` — Cisco Skill Scanner Wrapper

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

interface ScanOptions {
  useBehavioral?: boolean;
  useLlm?: boolean;
  enableMeta?: boolean;
  policy?: 'strict' | 'balanced' | 'permissive';
}

interface ScanResult {
  findings: Array<{
    severity: string;
    category: string;
    analyzer: string;
    description: string;
    location?: string;
  }>;
  max_severity: string;
  is_safe: boolean;
  scanner_version: string;
  analyzers_used: string[];
}

export async function scanSkill(
  skillDir: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const outputDir = await mkdtemp(join(tmpdir(), 'skillshield-scan-'));
  const outputFile = join(outputDir, 'result.json');

  const args = ['scan', skillDir, '--format', 'json', '--output', outputFile];

  if (options.useBehavioral) args.push('--use-behavioral');
  if (options.useLlm) args.push('--use-llm');
  if (options.enableMeta) args.push('--enable-meta');
  if (options.policy) args.push('--policy', options.policy);

  // Add lenient mode so malformed skills don't crash the pipeline
  args.push('--lenient');

  try {
    const { stdout, stderr } = await execFileAsync('skill-scanner', args, {
      timeout: 120_000,  // 2 min timeout per skill
      env: {
        ...process.env,
        SKILL_SCANNER_LLM_API_KEY: process.env.SKILL_SCANNER_LLM_API_KEY,
        SKILL_SCANNER_LLM_MODEL: process.env.SKILL_SCANNER_LLM_MODEL || 'claude-sonnet-4-20250514',
      },
    });

    const resultJson = await readFile(outputFile, 'utf-8');
    const result = JSON.parse(resultJson);

    return {
      findings: result.findings || [],
      max_severity: result.max_severity || 'none',
      is_safe: result.is_safe ?? true,
      scanner_version: result.scanner_version || 'unknown',
      analyzers_used: extractAnalyzers(args),
    };
  } catch (err: any) {
    // If the scanner crashes, treat as "cannot verify" — don't auto-approve
    console.error(`[scanner] Process error:`, err.message);
    return {
      findings: [{
        severity: 'high',
        category: 'scanner_error',
        analyzer: 'system',
        description: `Scanner failed: ${err.message}`,
      }],
      max_severity: 'high',
      is_safe: false,
      scanner_version: 'error',
      analyzers_used: [],
    };
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}

function extractAnalyzers(args: string[]): string[] {
  const analyzers = ['static'];  // always on
  if (args.includes('--use-behavioral')) analyzers.push('behavioral');
  if (args.includes('--use-llm')) analyzers.push('llm');
  if (args.includes('--enable-meta')) analyzers.push('meta');
  return analyzers;
}
```

### `packages/scanner/src/adapters/clawhub.ts` — ClawHub Fetcher

```typescript
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { execFileAsync } from '../utils';

const CLAWHUB_REGISTRY = 'https://clawhub.ai';

interface SkillListItem {
  slug: string;
  name: string;
  latestVersion?: string;
}

export class ClawHubAdapter {
  private registry: string;

  constructor(registry = CLAWHUB_REGISTRY) {
    this.registry = registry;
  }

  // List all skills from ClawHub (paginated)
  async listAll(): Promise<SkillListItem[]> {
    const skills: SkillListItem[] = [];
    let cursor: string | undefined;

    while (true) {
      const url = new URL(`${this.registry}/api/v1/skills`);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`ClawHub API error: ${res.status}`);

      const data = await res.json() as any;
      for (const s of data.skills || []) {
        skills.push({
          slug: s.slug,
          name: s.name,
          latestVersion: s.versions?.latest,
        });
      }

      cursor = data.nextCursor;
      if (!cursor || !data.skills?.length) break;

      // Rate limit courtesy
      await new Promise((r) => setTimeout(r, 200));
    }

    return skills;
  }

  // Download a specific skill to a temp directory
  async fetch(slug: string, version?: string): Promise<string> {
    const url = new URL(`${this.registry}/api/v1/download`);
    url.searchParams.set('slug', slug);
    if (version) url.searchParams.set('version', version);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Download failed for ${slug}: ${res.status}`);

    // Save ZIP to temp dir
    const tmpDir = await mkdtemp(join(tmpdir(), `clawhub-${slug}-`));
    const zipPath = join(tmpDir, `${slug}.zip`);

    const body = res.body;
    if (!body) throw new Error('Empty response body');

    await pipeline(
      body as any,
      createWriteStream(zipPath)
    );

    // Unzip
    await execFileAsync('unzip', ['-o', zipPath, '-d', tmpDir]);

    return tmpDir;
  }
}
```

### `packages/scanner/src/adapters/skills-sh.ts` — skills.sh Fetcher

```typescript
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileAsync } from '../utils';

interface SkillListItem {
  slug: string;     // "owner/repo/skill-name"
  name: string;
  latestVersion?: string;
}

export class SkillsShAdapter {
  // Scrape the skills.sh leaderboard to get all indexed skills
  async listAll(): Promise<SkillListItem[]> {
    // Fetch the leaderboard page and parse skill links
    // skills.sh URLs are /{owner}/{repo}/{skill}
    const res = await fetch('https://skills.sh');
    if (!res.ok) throw new Error(`skills.sh fetch failed: ${res.status}`);
    const html = await res.text();

    // Parse skill links from the leaderboard HTML
    // Links look like: href="/vercel-labs/agent-skills/vercel-react-best-practices"
    const skillRegex = /href="\/([^"]+\/[^"]+\/[^"]+)"/g;
    const skills: SkillListItem[] = [];
    const seen = new Set<string>();
    let match;

    while ((match = skillRegex.exec(html)) !== null) {
      const slug = match[1];
      // Filter out non-skill paths (e.g., /trending, /hot)
      const parts = slug.split('/');
      if (parts.length === 3 && !seen.has(slug)) {
        seen.add(slug);
        skills.push({
          slug,
          name: parts[2], // skill name is the last segment
        });
      }
    }

    // Also fetch /trending and /hot pages for more coverage
    for (const page of ['/trending', '/hot']) {
      try {
        const pageRes = await fetch(`https://skills.sh${page}`);
        const pageHtml = await pageRes.text();
        let pageMatch;
        while ((pageMatch = skillRegex.exec(pageHtml)) !== null) {
          const slug = pageMatch[1];
          const parts = slug.split('/');
          if (parts.length === 3 && !seen.has(slug)) {
            seen.add(slug);
            skills.push({ slug, name: parts[2] });
          }
        }
      } catch {}
    }

    return skills;
  }

  // Clone a skill's GitHub repo and extract it
  async fetch(slug: string, _version?: string): Promise<string> {
    // slug format: "owner/repo/skill-name"
    const parts = slug.split('/');
    if (parts.length < 3) throw new Error(`Invalid skills.sh slug: ${slug}`);

    const [owner, repo, skillName] = parts;
    const githubUrl = `https://github.com/${owner}/${repo}.git`;

    const tmpDir = await mkdtemp(join(tmpdir(), `skills-sh-${skillName}-`));

    // Shallow clone (just latest commit, minimal data)
    await execFileAsync('git', [
      'clone', '--depth', '1', '--single-branch',
      githubUrl, tmpDir,
    ], { timeout: 60_000 });

    // Find the specific skill directory
    // Skills can be at: root, ./skills/{name}, ./{name}
    const candidatePaths = [
      join(tmpDir, skillName),
      join(tmpDir, 'skills', skillName),
      tmpDir,  // root (single-skill repos)
    ];

    for (const candidate of candidatePaths) {
      try {
        const files = await readdir(candidate);
        if (files.includes('SKILL.md')) {
          return candidate;
        }
      } catch {}
    }

    // Fallback: scan recursively for SKILL.md
    return await findSkillDir(tmpDir, skillName) || tmpDir;
  }
}

async function findSkillDir(dir: string, skillName: string): Promise<string | null> {
  const { execFileAsync: exec } = await import('../utils');
  try {
    const { stdout } = await exec('find', [dir, '-name', 'SKILL.md', '-maxdepth', '4']);
    const paths = stdout.trim().split('\n').filter(Boolean);
    // Prefer paths containing the skill name
    const match = paths.find(p => p.includes(skillName));
    if (match) return join(match, '..');
    if (paths.length > 0) return join(paths[0], '..');
  } catch {}
  return null;
}
```

### `packages/scanner/src/publisher.ts` — Push Results to R2

```typescript
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Cloudflare R2 is S3-compatible
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,          // https://<account>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const SKILLS_BUCKET = process.env.R2_SKILLS_BUCKET || 'skillshield-skills';
const REPORTS_BUCKET = process.env.R2_REPORTS_BUCKET || 'skillshield-reports';

interface PublishInput {
  source: string;
  slug: string;
  version: string;
  skillDir: string;
  scanResult: any;
  verdict: { verdict: string; severity: string; findingsCount: number };
}

export async function publishResults(input: PublishInput) {
  const { source, slug, version, skillDir, scanResult, verdict } = input;

  // 1. Create and upload scan report JSON
  const report = {
    skill: slug,
    source,
    version,
    scanned_at: new Date().toISOString(),
    verdict: verdict.verdict,
    severity: verdict.severity,
    findings_count: verdict.findingsCount,
    findings: scanResult.findings || [],
    scanner_version: scanResult.scanner_version,
    analyzers_used: scanResult.analyzers_used,
    policy: 'strict',
  };

  const reportKey = source === 'clawhub'
    ? `clawhub/${slug}.json`
    : `skills-sh/${slug}.json`;

  await s3.send(new PutObjectCommand({
    Bucket: REPORTS_BUCKET,
    Key: reportKey,
    Body: JSON.stringify(report, null, 2),
    ContentType: 'application/json',
  }));

  // 2. If verified or caution, upload skill assets
  if (verdict.verdict !== 'blocked') {
    // For ClawHub: re-zip the skill directory and upload
    if (source === 'clawhub') {
      const { execFileAsync } = await import('./utils');
      const zipPath = `${skillDir}.zip`;
      await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: skillDir });
      const zipData = await readFile(zipPath);

      const assetKey = `clawhub/${slug}/${version}.zip`;
      await s3.send(new PutObjectCommand({
        Bucket: SKILLS_BUCKET,
        Key: assetKey,
        Body: zipData,
        ContentType: 'application/zip',
      }));

      // Also upload as "latest"
      await s3.send(new PutObjectCommand({
        Bucket: SKILLS_BUCKET,
        Key: `clawhub/${slug}/latest.zip`,
        Body: zipData,
        ContentType: 'application/zip',
      }));
    }

    // For skills.sh: tar the skill directory
    if (source === 'skills-sh') {
      const { execFileAsync } = await import('./utils');
      const tarPath = `${skillDir}.tar.gz`;
      await execFileAsync('tar', ['-czf', tarPath, '-C', skillDir, '.']);
      const tarData = await readFile(tarPath);

      await s3.send(new PutObjectCommand({
        Bucket: SKILLS_BUCKET,
        Key: `skills-sh/${slug}/latest.tar.gz`,
        Body: tarData,
        ContentType: 'application/gzip',
      }));
    }
  }

  // 3. Update D1 database (via Cloudflare API since we're not in a Worker)
  await updateD1({
    source,
    slug,
    version,
    verdict: verdict.verdict,
    severity: verdict.severity,
    findingsCount: verdict.findingsCount,
    r2Key: verdict.verdict !== 'blocked' ? `${source}/${slug}/latest.zip` : null,
    reportKey,
  });
}

async function updateD1(data: {
  source: string;
  slug: string;
  version: string;
  verdict: string;
  severity: string;
  findingsCount: number;
  r2Key: string | null;
  reportKey: string;
}) {
  // Use Cloudflare D1 HTTP API
  const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
  const CF_API_TOKEN = process.env.CF_API_TOKEN!;
  const D1_DATABASE_ID = process.env.D1_DATABASE_ID!;

  const now = new Date().toISOString();
  const id = `${data.source}:${data.slug}`;

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql: `INSERT INTO skills (id, source, slug, name, latest_version, latest_scanned_version, verdict, scan_severity, findings_count, first_seen_at, last_scanned_at, last_updated_at, r2_key, report_r2_key)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                latest_scanned_version = excluded.latest_scanned_version,
                verdict = excluded.verdict,
                scan_severity = excluded.scan_severity,
                findings_count = excluded.findings_count,
                last_scanned_at = excluded.last_scanned_at,
                last_updated_at = excluded.last_updated_at,
                r2_key = excluded.r2_key,
                report_r2_key = excluded.report_r2_key`,
        params: [
          id, data.source, data.slug, data.slug,
          data.version, data.version,
          data.verdict, data.severity, data.findingsCount,
          now, now, now,
          data.r2Key, data.reportKey,
        ],
      }),
    }
  );
}
```

---

## 6. Environment Variables

### Cloudflare Worker (`wrangler.toml` secrets)

```bash
wrangler secret put WEBHOOK_SECRET        # Shared secret for webhook auth
```

### Scanner Service (`.env`)

```bash
# Cloudflare R2 (S3-compatible)
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_SKILLS_BUCKET=skillshield-skills
R2_REPORTS_BUCKET=skillshield-reports

# Cloudflare D1 (HTTP API for external access)
CF_ACCOUNT_ID=<cloudflare-account-id>
CF_API_TOKEN=<cloudflare-api-token-with-d1-permissions>
D1_DATABASE_ID=<d1-database-id>

# Cisco Skill Scanner
SKILL_SCANNER_LLM_API_KEY=<anthropic-or-openai-key>
SKILL_SCANNER_LLM_MODEL=claude-sonnet-4-20250514

# Optional: VirusTotal for binary scanning
VIRUSTOTAL_API_KEY=<virustotal-key>
```

---

## 7. Build & Deploy

### Step 1: Set Up Cloudflare Resources

```bash
cd packages/worker

# Create R2 buckets
wrangler r2 bucket create skillshield-skills
wrangler r2 bucket create skillshield-reports
wrangler r2 bucket create skillshield-meta

# Create D1 database
wrangler d1 create skillshield-db

# Apply schema
wrangler d1 execute skillshield-db --file=./schema.sql

# Set secrets
wrangler secret put WEBHOOK_SECRET

# Deploy worker
wrangler deploy
```

### Step 2: DNS

Add CNAME in Cloudflare dashboard:
```
skillshield.cochat.ai → CNAME → skillshield-worker.{account}.workers.dev
```

Or configure in `wrangler.toml`:
```toml
[triggers]
routes = ["skillshield.cochat.ai/*"]
```

### Step 3: Deploy Scanner Service

```bash
cd packages/scanner

# Build Docker image
docker build -t skillshield-scanner .

# Run locally for testing
docker run --env-file .env -p 3100:3100 skillshield-scanner

# Deploy to Hetzner (or any Docker host)
# Use docker-compose, systemd, or your preferred method
```

### Step 4: Run Initial Full Scrape

```bash
# Scrape all of ClawHub
curl -X POST http://localhost:3100/scrape/clawhub

# Scrape all of skills.sh
curl -X POST http://localhost:3100/scrape/skills-sh
```

### Step 5: Register Webhooks

**ClawHub:** Contact the ClawHub team or configure via their Convex environment to add your webhook URL:
```
https://skillshield.cochat.ai/webhooks/clawhub
```

**GitHub (for skills.sh repos):** Create a GitHub App or use repo webhooks on the major skill repos. Configure:
- URL: `https://skillshield.cochat.ai/webhooks/github`
- Events: `push`, `release`
- Secret: match your `WEBHOOK_SECRET`

---

## 8. Implementation Order

Do these in sequence. Each step is independently deployable and testable.

| Phase | Task | Deliverable | Test |
|-------|------|-------------|------|
| **1** | Set up monorepo, shared types, Cloudflare resources | Working `wrangler deploy` with health check | `curl https://skillshield.cochat.ai/health` → `{"status":"ok"}` |
| **2** | Build ClawHub adapter (list + fetch) | Can download any ClawHub skill | Unit test: fetch `trello`, verify ZIP contents |
| **3** | Build scanner wrapper | Can scan a local skill directory | Unit test: scan a known-good and known-bad skill |
| **4** | Build publisher (R2 + D1 push) | Scan results land in R2 and D1 | Verify report JSON in R2, row in D1 |
| **5** | Build Worker route: `/clawhub/api/v1/*` | ClawHub CLI works with SkillShield registry | `CLAWHUB_REGISTRY=https://skillshield.cochat.ai/clawhub clawhub install trello` |
| **6** | Run full ClawHub scrape | All ClawHub skills scanned and indexed | `/api/v1/stats` shows total count |
| **7** | Build Worker routes: `/reports/*`, `/badge/*`, `/api/v1/*` | Public scan reports + badges + search API working | `curl /reports/clawhub/trello.json` returns scan report |
| **8** | Build webhook listener for ClawHub | New publishes auto-trigger scans | Publish a test skill, verify it appears in CDN |
| **9** | Build skills.sh adapter (scrape + fetch) | Can list and download skills.sh skills | Unit test: fetch `anthropics/skills/frontend-design` |
| **10** | Run full skills.sh scrape | All skills.sh skills scanned and indexed | Stats show both sources |
| **11** | Build GitHub webhook listener | skills.sh repo pushes auto-trigger scans | Push to a test repo, verify scan runs |
| **12** | Build public dashboard (optional) | Stats page at `skillshield.cochat.ai` | Visual verification |

---

## 9. Cron Jobs

Set up recurring scrapes to catch anything webhooks miss.

```bash
# Re-scrape ClawHub daily at 2am UTC (catch missed webhooks)
0 2 * * * curl -X POST http://scanner:3100/scrape/clawhub

# Re-scrape skills.sh daily at 3am UTC
0 3 * * * curl -X POST http://scanner:3100/scrape/skills-sh

# Re-scan all skills weekly with latest scanner version
0 4 * * 0 curl -X POST http://scanner:3100/rescan-all
```

---

## 10. Key Design Decisions (for the agent)

1. **Fail closed, not open.** If the scanner crashes or times out on a skill, that skill is NOT served. It gets a `blocked` verdict with a `scanner_error` finding. Never auto-approve.

2. **ClawHub API compatibility is critical.** The `/clawhub/api/v1/*` routes must return the exact same response shape as ClawHub's real API. The `clawhub` CLI parses these responses with Ark validators. Test with the real CLI.

3. **The scanner service is the only stateful component.** Everything else (Worker, R2, D1) is managed by Cloudflare. The scanner can crash and restart without losing state — D1 and R2 are the source of truth.

4. **Don't serve blocked skills at all.** Return a 403 with a JSON body explaining why and linking to the scan report. This is a feature, not a bug — users should know when a skill was blocked.

5. **Rate-limit the scrapers.** Add 200ms delays between ClawHub API calls and respect GitHub's rate limits. Use a GitHub App token (5000 req/hr) instead of unauthenticated requests (60 req/hr).

6. **LLM scanning costs money.** The `--use-llm` flag calls Anthropic/OpenAI for every skill. Budget roughly $0.01-0.05 per skill scan. For the initial full scrape of ~1000+ skills, expect $10-50 in LLM costs. Consider running LLM analysis only on skills that have static/behavioral findings, or on the initial scrape only.

7. **Use Hono for both Worker and scanner.** Same framework, same patterns, shared types. The agent should use `hono` (not `itty-router` or raw `fetch` handlers).

8. **TypeScript throughout, Python only for skill-scanner.** The scanner wrapper shells out to `skill-scanner` CLI. Don't try to call the Python SDK from Node — the CLI's JSON output is the integration surface.
