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
      const sourceName = entry.source === 'clawhub' ? 'ClawHub' : entry.source === 'skills-sh' ? 'skills.sh' : entry.source;

      return `<li class="source-row">
        <div class="source-header">
          <span class="source-name">${esc(sourceName)}</span>
          <span class="source-count">${entry.count.toLocaleString()}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${percentage}%"></div></div>
      </li>`;
    })
    .join('');

  const recentMarkup = data.recentSkills.length === 0
    ? '<p class="empty">No scans yet. Run a scrape or wait for webhook events.</p>'
    : data.recentSkills.map(renderSkillCard).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SkillShield — Security-Scanned Skill CDN</title>
  <meta name="description" content="SkillShield mirrors ClawHub and skills.sh, scans every skill for security threats, and only serves skills that pass." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-deep: #080c14;
      --bg-surface: #0d1220;
      --bg-card: rgba(16, 24, 42, 0.85);
      --bg-card-hover: rgba(22, 32, 56, 0.92);
      --border: rgba(56, 189, 248, 0.08);
      --border-glow: rgba(56, 189, 248, 0.2);
      --text: #e2e8f0;
      --text-muted: #7a8ba7;
      --text-dim: #4a5568;
      --cyan: #38bdf8;
      --cyan-bright: #7dd3fc;
      --cyan-glow: rgba(56, 189, 248, 0.15);
      --teal: #2dd4bf;
      --green: #34d399;
      --amber: #fbbf24;
      --red: #f87171;
      --navy: #1e293b;
      --font: 'DM Sans', system-ui, sans-serif;
      --mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    }

    * { box-sizing: border-box; margin: 0; }

    body {
      font-family: var(--font);
      color: var(--text);
      background: var(--bg-deep);
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Ambient glow background ─── */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      z-index: -1;
      background:
        radial-gradient(ellipse 80% 50% at 20% -10%, rgba(56, 189, 248, 0.08), transparent),
        radial-gradient(ellipse 60% 40% at 80% 10%, rgba(45, 212, 191, 0.06), transparent),
        radial-gradient(ellipse 50% 50% at 50% 100%, rgba(56, 189, 248, 0.04), transparent);
    }

    a { color: var(--cyan); text-decoration: none; }
    a:hover { color: var(--cyan-bright); }
    code { font-family: var(--mono); font-size: 0.88em; }

    .shell { max-width: 1180px; margin: 0 auto; padding: 0 24px 80px; }

    /* ─── Top bar ─── */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      max-width: 1180px;
      margin: 0 auto;
    }
    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.01em;
    }
    .topbar-brand svg { flex-shrink: 0; }
    .topbar-links { display: flex; gap: 20px; font-size: 0.88rem; }
    .topbar-links a { color: var(--text-muted); transition: color 0.15s; }
    .topbar-links a:hover { color: var(--cyan); }

    /* ─── Hero: CDN setup front and center ─── */
    .hero {
      padding: 56px 0 48px;
      text-align: center;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      background: var(--cyan-glow);
      border: 1px solid var(--border-glow);
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--cyan);
      margin-bottom: 24px;
    }
    .hero-badge-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
    }
    .hero h1 {
      font-size: clamp(2.2rem, 6vw, 3.8rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      line-height: 1.05;
      max-width: 16ch;
      margin: 0 auto 18px;
    }
    .hero h1 .gradient-text {
      background: linear-gradient(135deg, var(--cyan) 0%, var(--teal) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-sub {
      font-size: 1.12rem;
      line-height: 1.6;
      color: var(--text-muted);
      max-width: 52ch;
      margin: 0 auto 40px;
    }

    /* ─── Setup blocks ─── */
    .setup-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      max-width: 820px;
      margin: 0 auto 20px;
      width: 100%;
    }
    .setup-block {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      text-align: left;
      transition: border-color 0.2s, box-shadow 0.2s;
      min-width: 0;
    }
    .setup-block:hover {
      border-color: var(--border-glow);
      box-shadow: 0 0 40px rgba(56, 189, 248, 0.06);
    }
    .setup-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--cyan);
      margin-bottom: 14px;
    }
    .setup-label-icon {
      width: 20px; height: 20px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
    }
    .setup-code {
      display: block;
      font-family: var(--mono);
      font-size: 0.84rem;
      line-height: 1.7;
      color: var(--text);
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      padding: 16px 18px;
      overflow-x: auto;
      white-space: pre;
      width: 100%;
      max-width: 100%;
    }
    .setup-code .dim { color: var(--text-dim); }
    .setup-code .val { color: var(--cyan-bright); }
    .setup-code .cmd { color: var(--teal); }

    .setup-note {
      text-align: center;
      color: var(--text-dim);
      font-size: 0.85rem;
      margin-bottom: 48px;
    }
    .setup-note a { color: var(--text-muted); text-decoration: underline; text-underline-offset: 3px; }
    .setup-note a:hover { color: var(--cyan); }

    /* ─── Stats row ─── */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      text-align: center;
      transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: var(--border-glow); }
    .stat-value {
      font-family: var(--mono);
      font-size: clamp(1.6rem, 3.5vw, 2.2rem);
      font-weight: 500;
      line-height: 1;
    }
    .stat-value.verified { color: var(--green); }
    .stat-value.caution { color: var(--amber); }
    .stat-value.blocked { color: var(--red); }
    .stat-value.pending { color: var(--text-dim); }
    .stat-label {
      display: block;
      margin-top: 8px;
      font-size: 0.82rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* ─── Rate pill ─── */
    .rate-row {
      display: flex;
      justify-content: center;
      margin-bottom: 40px;
    }
    .rate-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      border-radius: 999px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      font-size: 0.92rem;
    }
    .rate-pill strong {
      font-family: var(--mono);
      color: var(--green);
    }

    /* ─── Two-column layout ─── */
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 16px;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 28px;
    }
    .card h2 {
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 4px;
    }
    .card-sub {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 20px;
    }

    /* ─── Source list ─── */
    .source-list { list-style: none; padding: 0; display: grid; gap: 16px; }
    .source-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .source-name { font-weight: 600; font-size: 0.95rem; }
    .source-count { font-family: var(--mono); font-size: 0.9rem; color: var(--cyan); }
    .bar-track {
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--cyan), var(--teal));
      transition: width 0.6s ease-out;
    }
    .source-footer {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 0.84rem;
      color: var(--text-dim);
      line-height: 1.6;
    }
    .source-footer code { color: var(--text-muted); }

    /* ─── Recent scans ─── */
    .scan-list { display: grid; gap: 12px; }
    .scan-card {
      padding: 18px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.2);
      transition: border-color 0.2s, background 0.2s;
    }
    .scan-card:hover {
      border-color: var(--border-glow);
      background: rgba(0, 0, 0, 0.3);
    }
    .scan-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .scan-name {
      font-weight: 600;
      font-size: 1rem;
      margin-bottom: 2px;
    }
    .scan-slug {
      font-family: var(--mono);
      font-size: 0.8rem;
      color: var(--text-dim);
    }
    .scan-meta {
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .scan-links {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      font-size: 0.84rem;
    }
    .scan-links a {
      color: var(--text-muted);
      text-decoration: underline;
      text-decoration-color: rgba(122, 139, 167, 0.3);
      text-underline-offset: 3px;
    }
    .scan-links a:hover { color: var(--cyan); text-decoration-color: var(--cyan); }

    /* ─── Verdict pill ─── */
    .verdict {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      height: 26px;
      padding: 0 10px;
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .verdict-verified { background: rgba(52, 211, 153, 0.12); color: var(--green); border: 1px solid rgba(52, 211, 153, 0.2); }
    .verdict-caution { background: rgba(251, 191, 36, 0.1); color: var(--amber); border: 1px solid rgba(251, 191, 36, 0.18); }
    .verdict-blocked { background: rgba(248, 113, 113, 0.1); color: var(--red); border: 1px solid rgba(248, 113, 113, 0.18); }
    .verdict-pending { background: rgba(255, 255, 255, 0.04); color: var(--text-dim); border: 1px solid rgba(255, 255, 255, 0.06); }

    .empty { color: var(--text-dim); font-size: 0.92rem; }

    /* ─── Footer ─── */
    .foot {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.84rem;
      color: var(--text-dim);
    }
    .foot a { color: var(--text-muted); }

    /* ─── Enterprise callout ─── */
    .enterprise-callout {
      margin-top: 24px;
      padding: 24px 28px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.06), rgba(45, 212, 191, 0.04));
      border: 1px solid var(--border-glow);
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .enterprise-callout-text { flex: 1; }
    .enterprise-callout-text strong { color: var(--text); display: block; margin-bottom: 4px; }
    .enterprise-callout-text span { color: var(--text-muted); font-size: 0.9rem; line-height: 1.5; }
    .enterprise-callout code {
      font-size: 0.82rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.3);
      color: var(--cyan-bright);
    }

    /* ─── Responsive ─── */
    @media (max-width: 900px) {
      .setup-grid { grid-template-columns: 1fr; }
      .stats-row { grid-template-columns: repeat(3, 1fr); }
      .grid-2 { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .hero h1 { font-size: 2rem; }
    }

    /* ─── Animations ─── */
    @media (prefers-reduced-motion: no-preference) {
      .hero-badge, .setup-block, .stat-card, .card, .scan-card, .enterprise-callout {
        animation: fadeUp 0.5s ease-out both;
      }
      .setup-block:nth-child(2) { animation-delay: 60ms; }
      .stat-card:nth-child(2) { animation-delay: 40ms; }
      .stat-card:nth-child(3) { animation-delay: 80ms; }
      .stat-card:nth-child(4) { animation-delay: 120ms; }
      .stat-card:nth-child(5) { animation-delay: 160ms; }
      .card:nth-child(2) { animation-delay: 60ms; }
      .enterprise-callout { animation-delay: 100ms; }
      .scan-card { animation: fadeUp 0.4s ease-out both; }
      .scan-card:nth-child(2) { animation-delay: 50ms; }
      .scan-card:nth-child(3) { animation-delay: 100ms; }
      .scan-card:nth-child(4) { animation-delay: 150ms; }
      .scan-card:nth-child(5) { animation-delay: 200ms; }

      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: translateY(0); }
      }
    }
  </style>
</head>
<body>
  <nav class="topbar">
    <div class="topbar-brand">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <path d="M16 2L4 8v8c0 7.7 5.1 14.9 12 16.8C22.9 30.9 28 23.7 28 16V8L16 2z" fill="#0d1220" stroke="var(--cyan)" stroke-width="1.5"/>
        <path d="M10 16l4 4 8-8" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      SkillShield
    </div>
    <div class="topbar-links">
      <a href="/api/v1/stats">API</a>
      <a href="/api/v1/recent">Recent</a>
      <a href="/health">Health</a>
      <a href="https://github.com/CoChatAI/SkillSheild">GitHub</a>
    </div>
  </nav>

  <main class="shell">
    <section class="hero">
      <div class="hero-badge"><span class="hero-badge-dot"></span> Live &mdash; scanning ${data.stats.totalSkills.toLocaleString()} skills</div>
      <h1>The <span class="gradient-text">security-scanned</span> CDN for AI skills</h1>
      <p class="hero-sub">Point your CLI at SkillShield instead of the upstream registry. Every skill is scanned before it's served. Drop-in compatible with ClawHub and skills.sh.</p>

      <div class="setup-grid">
        <div class="setup-block">
          <div class="setup-label"><span class="setup-label-icon">CH</span> ClawHub CLI</div>
          <code class="setup-code"><span class="dim"># Use SkillShield as your ClawHub registry</span>
<span class="cmd">export</span> <span class="val">CLAWHUB_REGISTRY</span>=https://skillshield.cochat.ai/clawhub

<span class="dim"># Then install skills as usual</span>
<span class="cmd">clawhub install</span> <span class="val">brave-search</span></code>
        </div>
        <div class="setup-block">
          <div class="setup-label"><span class="setup-label-icon">SH</span> skills.sh CLI</div>
          <code class="setup-code"><span class="dim"># Use SkillShield as your skills.sh endpoint</span>
<span class="cmd">export</span> <span class="val">SKILLS_API_URL</span>=https://skillshield.cochat.ai

<span class="dim"># Then search and add skills as usual</span>
<span class="cmd">npx skills find</span> <span class="val">design</span></code>
        </div>
      </div>
      <p class="setup-note">Enterprise compliance endpoint available at <a href="/enterprise/clawhub/api/v1/skills">/enterprise/*</a> &mdash; same CLI compatibility, stricter policy.</p>
    </section>

    <div class="stats-row">
      ${renderStat(data.stats.totalSkills, 'Indexed', '')}
      ${renderStat(data.stats.verified, 'Verified', 'verified')}
      ${renderStat(data.stats.caution, 'Caution', 'caution')}
      ${renderStat(data.stats.blocked, 'Blocked', 'blocked')}
      ${renderStat(data.stats.totalScans, 'Scans', '')}
    </div>

    <div class="rate-row">
      <div class="rate-pill">
        <strong>${verificationRate}%</strong> of indexed skills pass security scanning and are installable
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>Registry Coverage</h2>
        <p class="card-sub">Skills indexed across upstream sources</p>
        <ul class="source-list">${sourceMarkup}</ul>
        <div class="source-footer">
          Updated ${esc(fmtTime(data.stats.lastUpdated))}. Machine-readable at <code>/api/v1/search</code> and <code>/api/v1/verify/:source/:slug</code>.
        </div>
      </div>

      <div class="card">
        <h2>Recent Scans</h2>
        <p class="card-sub">Latest results from both registries</p>
        <div class="scan-list">${recentMarkup}</div>
      </div>
    </div>

    <div class="enterprise-callout">
      <div class="enterprise-callout-text">
        <strong>Enterprise Compliance Endpoint</strong>
        <span>The <code>/enterprise/*</code> routes apply full compliance policy including license and metadata checks. Same scan data, stricter serving rules. Use <code>CLAWHUB_REGISTRY=https://skillshield.cochat.ai/enterprise/clawhub</code> for enterprise installs.</span>
      </div>
    </div>

    <footer class="foot">
      SkillShield by <a href="https://cochat.ai">CoChatAI</a>. Powered by <a href="https://github.com/CoChatAI/SkillSheild">open source</a>. Scans by Cisco skill-scanner.
    </footer>
  </main>
</body>
</html>`;
}

function renderStat(value: number, label: string, colorClass: string) {
  const cls = colorClass ? ` ${colorClass}` : '';
  return `<div class="stat-card">
    <span class="stat-value${cls}">${value.toLocaleString()}</span>
    <span class="stat-label">${esc(label)}</span>
  </div>`;
}

function renderSkillCard(skill: DashboardRecentSkill) {
  const severity = skill.severity ?? 'none';
  const sourceName = skill.source === 'clawhub' ? 'ClawHub' : skill.source === 'skills-sh' ? 'skills.sh' : skill.source;

  return `<div class="scan-card">
    <div class="scan-top">
      <div>
        <div class="scan-name">${esc(skill.name)}</div>
        <div class="scan-slug">${esc(sourceName)} / ${esc(skill.slug)}</div>
      </div>
      <span class="verdict ${verdictClass(skill.verdict)}">${esc(skill.verdict)}</span>
    </div>
    <div class="scan-meta">${skill.findingsCount} finding${skill.findingsCount !== 1 ? 's' : ''} &middot; ${esc(severity)} severity &middot; ${esc(fmtTimeShort(skill.lastScannedAt))}</div>
    <div class="scan-links">
      <a href="${esc(skill.reportUrl)}">Report</a>
      <a href="${esc(skill.badgeUrl)}">Badge</a>
      <a href="/api/v1/verify/${esc(skill.source)}/${esc(skill.slug)}">Verify</a>
    </div>
  </div>`;
}

function verdictClass(verdict: string) {
  switch (verdict) {
    case 'verified': return 'verdict-verified';
    case 'caution': return 'verdict-caution';
    case 'blocked': return 'verdict-blocked';
    default: return 'verdict-pending';
  }
}

function fmtTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function fmtTimeShort(value: string | null) {
  if (!value) return 'pending';
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function esc(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
