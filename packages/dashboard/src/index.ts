export type DashboardStats = {
  totalSkills: number;
  verified: number;
  caution: number;
  blocked: number;
  pending: number;
  totalScans: number;
  bySource: Array<{
    source: string;
    count: number;
  }>;
  lastUpdated: string;
};

export type DashboardRecentSkill = {
  source: string;
  slug: string;
  name: string;
  verdict: string;
  severity: string | null;
  findingsCount: number;
  lastScannedAt: string | null;
  reportUrl: string;
  badgeUrl: string;
};

export type DashboardPageData = {
  generatedAt: string;
  stats: DashboardStats;
  recentSkills: DashboardRecentSkill[];
};

export function renderDashboardPage(data: DashboardPageData): string {
  const verificationRate = data.stats.totalSkills === 0
    ? 0
    : Math.round(((data.stats.verified + data.stats.caution) / data.stats.totalSkills) * 100);
  const sourceMarkup = data.stats.bySource
    .map((entry) => {
      const percentage = data.stats.totalSkills === 0
        ? 0
        : Math.round((entry.count / data.stats.totalSkills) * 100);

      return `<li>
        <div>
          <strong>${escapeHtml(entry.source)}</strong>
          <span>${entry.count} indexed</span>
        </div>
        <div class="meter"><span style="width:${percentage}%"></span></div>
      </li>`;
    })
    .join('');

  const recentMarkup = data.recentSkills.length === 0
    ? '<p class="empty-state">No completed scans yet. Run the scraper or wait for webhook-driven scans.</p>'
    : `<div class="recent-list">${data.recentSkills.map(renderRecentSkillCard).join('')}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SkillShield Dashboard</title>
    <meta name="description" content="SkillShield mirrors ClawHub and skills.sh, then only serves skills that pass security scanning." />
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f2e9;
        --paper: rgba(255, 250, 241, 0.88);
        --ink: #1d2430;
        --muted: #5f6773;
        --line: rgba(29, 36, 48, 0.12);
        --brand: #0e7c66;
        --brand-strong: #085b4a;
        --warm: #d97745;
        --verified: #1c8c5f;
        --caution: #b97812;
        --blocked: #c1483b;
        --pending: #6f7282;
        --shadow: 0 24px 80px rgba(29, 36, 48, 0.12);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(14, 124, 102, 0.16), transparent 34%),
          radial-gradient(circle at top right, rgba(217, 119, 69, 0.14), transparent 28%),
          linear-gradient(180deg, #fbf8f1 0%, var(--bg) 100%);
      }

      a { color: inherit; }
      .shell {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 20px 72px;
      }

      .hero,
      .panel {
        background: var(--paper);
        backdrop-filter: blur(14px);
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 32px;
        overflow: hidden;
        position: relative;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -10% -35% auto;
        width: 280px;
        height: 280px;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(14, 124, 102, 0.22), transparent 70%);
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 14px;
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--brand-strong);
      }

      h1, h2, h3, .metric-value {
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      h1 {
        margin: 0;
        max-width: 11ch;
        font-size: clamp(2.4rem, 7vw, 4.8rem);
        line-height: 0.95;
      }

      .hero-grid {
        display: grid;
        gap: 24px;
        grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
      }

      .lede,
      .muted,
      .metric-label,
      .source-list span,
      .recent-meta,
      .footer-note,
      .empty-state {
        color: var(--muted);
      }

      .lede {
        margin: 18px 0 0;
        max-width: 58ch;
        font-size: 1.05rem;
        line-height: 1.65;
      }

      .hero-links {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 24px;
      }

      .button,
      .button-secondary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 999px;
        text-decoration: none;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        font-weight: 600;
      }

      .button {
        background: var(--brand);
        color: #fff;
      }

      .button-secondary {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.66);
      }

      .hero-aside {
        padding: 20px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(14, 124, 102, 0.15);
      }

      .hero-aside p {
        margin: 0 0 10px;
        line-height: 1.55;
      }

      .metrics {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: 22px;
      }

      .metric {
        padding: 18px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid var(--line);
      }

      .metric-value {
        display: block;
        font-size: clamp(1.8rem, 4vw, 2.6rem);
        line-height: 1;
      }

      .metric-label {
        display: block;
        margin-top: 10px;
        font-size: 0.92rem;
      }

      .layout {
        display: grid;
        gap: 20px;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 0.86fr);
        margin-top: 20px;
      }

      .panel {
        padding: 24px;
      }

      .panel h2 {
        margin: 0 0 8px;
        font-size: 1.5rem;
      }

      .source-list {
        list-style: none;
        margin: 20px 0 0;
        padding: 0;
        display: grid;
        gap: 16px;
      }

      .source-list li div:first-child {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .meter {
        height: 10px;
        border-radius: 999px;
        background: rgba(29, 36, 48, 0.08);
        overflow: hidden;
      }

      .meter span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--brand) 0%, var(--warm) 100%);
      }

      .recent-list {
        display: grid;
        gap: 14px;
        margin-top: 20px;
      }

      .recent-card {
        padding: 18px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.76);
      }

      .recent-card-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }

      .recent-card h3 {
        margin: 0;
        font-size: 1.08rem;
      }

      .recent-meta {
        margin: 8px 0 0;
        font-size: 0.95rem;
        line-height: 1.5;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 12px;
        border-radius: 999px;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #fff;
      }

      .pill-verified { background: var(--verified); }
      .pill-caution { background: var(--caution); }
      .pill-blocked { background: var(--blocked); }
      .pill-pending { background: var(--pending); }

      .recent-links {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 12px;
        font-size: 0.94rem;
      }

      .recent-links a {
        text-decoration-thickness: 1px;
        text-underline-offset: 3px;
      }

      .footer-note {
        margin-top: 16px;
        font-size: 0.92rem;
        line-height: 1.55;
      }

      @media (max-width: 900px) {
        .hero-grid,
        .layout,
        .metrics {
          grid-template-columns: 1fr;
        }

        .hero,
        .panel {
          border-radius: 24px;
        }
      }

      @media (prefers-reduced-motion: no-preference) {
        .hero,
        .panel,
        .metric {
          animation: rise 540ms ease-out both;
        }

        .panel:nth-of-type(2),
        .metric:nth-of-type(3) {
          animation-delay: 80ms;
        }

        .panel:nth-of-type(3),
        .metric:nth-of-type(5) {
          animation-delay: 140ms;
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-grid">
          <div>
            <p class="eyebrow">SkillShield Dashboard</p>
            <h1>Only serve the skills you can trust.</h1>
            <p class="lede">SkillShield mirrors ClawHub and skills.sh, runs Cisco's skill scanner, publishes public reports, and keeps risky packages out of the install path by default.</p>
            <div class="hero-links">
              <a class="button" href="/api/v1/stats">Raw API stats</a>
              <a class="button-secondary" href="/api/v1/recent">Recent scans</a>
              <a class="button-secondary" href="/health">Health check</a>
            </div>
          </div>
          <aside class="hero-aside">
            <p><strong>${verificationRate}%</strong> of indexed skills are currently installable (<code>verified</code> or <code>caution</code>).</p>
            <p>Generated ${escapeHtml(formatTimestamp(data.generatedAt))} with ${data.stats.totalScans} total recorded scans.</p>
            <p>The public routes stay compatible with ClawHub while adding reports, badges, webhook ingestion, and search APIs for operators.</p>
          </aside>
        </div>
        <div class="metrics">
          ${renderMetric('Indexed skills', data.stats.totalSkills)}
          ${renderMetric('Verified', data.stats.verified)}
          ${renderMetric('Caution', data.stats.caution)}
          ${renderMetric('Blocked', data.stats.blocked)}
          ${renderMetric('Pending', data.stats.pending)}
        </div>
      </section>

      <section class="layout">
        <article class="panel">
          <h2>Registry coverage</h2>
          <p class="muted">How the current mirror is split across upstream sources.</p>
          <ul class="source-list">${sourceMarkup}</ul>
          <p class="footer-note">Last updated ${escapeHtml(formatTimestamp(data.stats.lastUpdated))}. Use <code>/api/v1/search</code> and <code>/api/v1/verify/:source/:slug</code> for machine-readable integrations.</p>
        </article>

        <article class="panel">
          <h2>Recent scans</h2>
          <p class="muted">Latest results across both registries, with links to public reports and badges.</p>
          ${recentMarkup}
        </article>
      </section>
    </main>
  </body>
</html>`;
}

function renderMetric(label: string, value: number) {
  return `<article class="metric">
    <span class="metric-value">${value}</span>
    <span class="metric-label">${escapeHtml(label)}</span>
  </article>`;
}

function renderRecentSkillCard(skill: DashboardRecentSkill) {
  const severity = skill.severity ?? 'unknown';

  return `<article class="recent-card">
    <div class="recent-card-header">
      <div>
        <h3>${escapeHtml(skill.name)}</h3>
        <p class="recent-meta">${escapeHtml(skill.source)} - <code>${escapeHtml(skill.slug)}</code></p>
      </div>
      <span class="pill ${renderVerdictClass(skill.verdict)}">${escapeHtml(skill.verdict)}</span>
    </div>
    <p class="recent-meta">Severity ${escapeHtml(severity)} with ${skill.findingsCount} findings. ${escapeHtml(renderRecentTimestamp(skill.lastScannedAt))}</p>
    <div class="recent-links">
      <a href="${escapeHtml(skill.reportUrl)}">Public report</a>
      <a href="${escapeHtml(skill.badgeUrl)}">Badge</a>
      <a href="/api/v1/verify/${escapeHtml(skill.source)}/${escapeHtml(skill.slug)}">Verify endpoint</a>
    </div>
  </article>`;
}

function renderVerdictClass(verdict: string) {
  switch (verdict) {
    case 'verified':
      return 'pill-verified';
    case 'caution':
      return 'pill-caution';
    case 'blocked':
      return 'pill-blocked';
    default:
      return 'pill-pending';
  }
}

function renderRecentTimestamp(value: string | null) {
  if (!value) {
    return 'Waiting for the first completed scan.';
  }

  return `Scanned ${formatTimestamp(value)}.`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
