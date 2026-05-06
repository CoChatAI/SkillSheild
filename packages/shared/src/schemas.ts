import { z } from 'zod';
import {
  SCAN_ANALYZER_VALUES,
  SCAN_POLICY_VALUES,
  SCAN_STATUS_VALUES,
  SEVERITY_VALUES,
  SOURCE_VALUES,
  VERDICT_VALUES,
} from './constants';

export const sourceSchema = z.enum(SOURCE_VALUES);
export const verdictSchema = z.enum(VERDICT_VALUES);
export const severitySchema = z.enum(SEVERITY_VALUES);
export const scanStatusSchema = z.enum(SCAN_STATUS_VALUES);
export const scanAnalyzerSchema = z.enum(SCAN_ANALYZER_VALUES);
export const scanPolicySchema = z.enum(SCAN_POLICY_VALUES);

const scanJobLocatorFields = z.object({
  source: sourceSchema,
  slug: z.string().trim().min(1).optional(),
  repo: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  useLlm: z.boolean().optional(),
});

export const scanJobLocatorSchema = scanJobLocatorFields.refine((job) => job.slug || job.repo, {
  message: 'Scan jobs require either a slug or repo field.',
});

export const queuedScanJobSchema = scanJobLocatorFields.extend({
  type: z.literal('scan'),
  run_id: z.string().trim().min(1).optional(),
  job_id: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
  triggered_by: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
}).refine((job) => job.slug || job.repo, {
  message: 'Scan jobs require either a slug or repo field.',
});

export const skillRecordSchema = z.object({
  id: z.string(),
  source: sourceSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  category: z.string().nullable(),
  latestVersion: z.string().nullable(),
  latestScannedVersion: z.string().nullable(),
  verdict: verdictSchema,
  scanSeverity: severitySchema.nullable(),
  findingsCount: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  installsUpdatedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  lastScannedAt: z.string().nullable(),
  lastUpdatedAt: z.string(),
  r2Key: z.string().nullable(),
  reportR2Key: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
});

export const scanFindingSchema = z.object({
  severity: severitySchema,
  category: z.string(),
  analyzer: z.string(),
  description: z.string(),
  location: z.string().optional(),
});

export const skillScanResultSchema = z.object({
  findings: z.array(scanFindingSchema),
  findingsCount: z.number().int().nonnegative(),
  maxSeverity: severitySchema,
  isSafe: z.boolean(),
  scannerVersion: z.string(),
  analyzersUsed: z.array(scanAnalyzerSchema),
  policy: scanPolicySchema,
});

export const scanRunSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  version: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  status: scanStatusSchema,
  verdict: verdictSchema.nullable(),
  severity: severitySchema.nullable(),
  findingsCount: z.number().int().nonnegative(),
  findings: z.array(scanFindingSchema),
  scannerVersion: z.string().nullable(),
  analyzersUsed: z.array(z.string()),
  error: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('skillshield'),
});

export const searchResponseSchema = z.object({
  skills: z.array(skillRecordSchema),
  count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export const verifyResponseSchema = z.object({
  verified: z.boolean(),
  verdict: verdictSchema.optional(),
  severity: severitySchema.nullable().optional(),
  findings: z.number().int().nonnegative().optional(),
  scannedAt: z.string().nullable().optional(),
  report: z.string().optional(),
  reason: z.string().optional(),
});
