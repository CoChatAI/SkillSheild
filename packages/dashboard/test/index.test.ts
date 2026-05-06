import { describe, expect, it } from 'vitest';
import { renderDashboardPage } from '../src/index';

describe('dashboard renderer', () => {
  it('renders stats, recent scans, and public links', () => {
    const html = renderDashboardPage({
      generatedAt: '2026-03-21T12:00:00.000Z',
      stats: {
        totalSkills: 12,
        verified: 8,
        caution: 2,
        blocked: 1,
        pending: 1,
        totalScans: 42,
        bySource: [
          { source: 'clawhub', count: 7 },
          { source: 'skills-sh', count: 5 },
        ],
        lastUpdated: '2026-03-21T12:00:00.000Z',
      },
      recentSkills: [
        {
          source: 'clawhub',
          slug: 'trello',
          name: 'Trello',
          verdict: 'verified',
          severity: 'none',
          findingsCount: 0,
          lastScannedAt: '2026-03-21T11:30:00.000Z',
          reportUrl: 'https://skillshield.cochat.ai/reports/clawhub/trello.json',
          badgeUrl: 'https://skillshield.cochat.ai/badge/clawhub/trello.svg',
        },
      ],
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('The <span class="gradient-text">security-scanned</span> CDN for AI skills');
    expect(html).toContain('Indexed');
    expect(html).toContain('Registry Coverage');
    expect(html).toContain('Report');
    expect(html).toContain('/api/v1/verify/clawhub/trello');
  });
});
