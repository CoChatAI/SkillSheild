export type WorkerBindings = {
  SKILLS_BUCKET: R2Bucket;
  REPORTS_BUCKET: R2Bucket;
  META_BUCKET: R2Bucket;
  DB: D1Database;
  SCAN_QUEUE: Queue;
  SCANNER_BASE_URL: string;
  SCANNER_REQUEST_TIMEOUT_MS?: string;
  SCANNER_AUTH_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  ENVIRONMENT?: string;
};
