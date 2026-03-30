import type {
  queuedScanJobSchema,
  scanFindingSchema,
  scanJobLocatorSchema,
  scanPolicySchema,
  scanRunSchema,
  searchResponseSchema,
  skillScanResultSchema,
  skillRecordSchema,
  verifyResponseSchema,
} from './schemas';

export type SkillSource = 'clawhub' | 'skills-sh';
export type SkillVerdict = 'verified' | 'caution' | 'blocked' | 'pending';
export type ScanSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type ScanStatus = 'running' | 'completed' | 'failed';
export type ScanAnalyzer = 'static' | 'behavioral' | 'llm' | 'meta';
export type ScanPolicy = import('zod').infer<typeof scanPolicySchema>;

export interface SkillIdentifier {
  source: SkillSource;
  slug: string;
}

export interface SkillVersionReference extends SkillIdentifier {
  version: string;
}

export type ScanJobLocator = import('zod').infer<typeof scanJobLocatorSchema>;
export type QueuedScanJob = import('zod').infer<typeof queuedScanJobSchema>;
export type SkillRecord = import('zod').infer<typeof skillRecordSchema>;
export type ScanFinding = import('zod').infer<typeof scanFindingSchema>;
export type ScanRun = import('zod').infer<typeof scanRunSchema>;
export type SearchResponse = import('zod').infer<typeof searchResponseSchema>;
export type SkillScanResult = import('zod').infer<typeof skillScanResultSchema>;
export type VerifyResponse = import('zod').infer<typeof verifyResponseSchema>;
