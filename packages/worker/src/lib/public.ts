import type { SkillSource } from '@skillshield/shared';

const PUBLIC_BASE_URL = 'https://skillshield.cochat.ai';

export function buildReportStorageKey(source: SkillSource, slug: string) {
  if (source === 'clawhub') {
    return `clawhub/${slug}.json`;
  }

  return `skills-sh/${slug}.json`;
}

export function buildPublicReportPath(source: SkillSource, slug: string) {
  if (source === 'clawhub') {
    return `/reports/clawhub/${slug}.json`;
  }

  return `/reports/skills/${slug}.json`;
}

export function buildPublicBadgePath(source: SkillSource, slug: string) {
  if (source === 'clawhub') {
    return `/badge/clawhub/${slug}.svg`;
  }

  return `/badge/skills/${slug}.svg`;
}

export function buildPublicReportUrl(source: SkillSource, slug: string) {
  return `${PUBLIC_BASE_URL}${buildPublicReportPath(source, slug)}`;
}

export function buildPublicBadgeUrl(source: SkillSource, slug: string) {
  return `${PUBLIC_BASE_URL}${buildPublicBadgePath(source, slug)}`;
}
