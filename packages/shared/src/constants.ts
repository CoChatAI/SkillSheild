export const SKILLSHIELD_SERVICE_NAME = 'skillshield';
export const DEFAULT_ENVIRONMENT = 'development';

export const SOURCE_VALUES = ['clawhub', 'skills-sh'] as const;
export const VERDICT_VALUES = ['verified', 'caution', 'blocked', 'pending'] as const;
export const SEVERITY_VALUES = ['none', 'low', 'medium', 'high', 'critical'] as const;
export const SCAN_STATUS_VALUES = ['running', 'completed', 'failed'] as const;
export const SCAN_ANALYZER_VALUES = ['static', 'behavioral', 'llm', 'meta'] as const;
export const SCAN_POLICY_VALUES = ['strict', 'balanced', 'permissive'] as const;

export const CLAWHUB_REGISTRY_URL = 'https://clawhub.ai';
export const SKILLS_SH_BASE_URL = 'https://skills.sh';
export const PUBLIC_API_BASE_PATH = '/api/v1';
export const HEALTH_ROUTE = '/health';

export const CLOUDFLARE_BUCKET_NAMES = {
  skills: 'skillshield-skills',
  reports: 'skillshield-reports',
  meta: 'skillshield-meta',
} as const;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
