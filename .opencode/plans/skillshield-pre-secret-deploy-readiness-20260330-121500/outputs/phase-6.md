# Phase 6 Output

- Replaced the Terraform stubs in `infrastructure/terraform/` with real Cloudflare-managed resources:
  - `d1.tf`: `cloudflare_d1_database.primary`
  - `r2.tf`: `cloudflare_r2_bucket.skills`, `cloudflare_r2_bucket.reports`, `cloudflare_r2_bucket.meta`
  - `dns.tf`: `cloudflare_workers_route.worker` and `cloudflare_dns_record.worker_hostname`
  - `queues.tf`: `cloudflare_queue.scan_jobs`
- Added `variables.tf` with required Cloudflare identity inputs and defaulted repo-aligned resource names, plus `outputs.tf` exposing the D1 ID, bucket names, queue name/ID, Worker route, DNS record details, and scanner app name.
- Finished the Worker runtime config in `packages/worker/wrangler.toml` so it is both queue-producer and queue-consumer aware in local/default config and in `[env.production]`, while keeping secrets out of checked-in `[vars]`.
- Added `SCANNER_REQUEST_TIMEOUT_MS` support to the Worker queue consumer runtime and updated the Worker deploy workflow to validate and deploy with `--env production`, so the checked-in production config path is the one that gets exercised.

## Verification

- `terraform fmt -check && terraform init -backend=false && terraform validate`
- `./node_modules/.bin/tsc -p packages/worker/tsconfig.json --noEmit`
- `./node_modules/.bin/vitest run packages/worker/test/queue-consumer.test.ts`
- `./node_modules/.bin/wrangler deploy --dry-run --env production --config wrangler.toml` (from `packages/worker`)

## Expected Output Check

- Terraform now includes D1, R2, DNS, queue, variables, and outputs instead of stubs.
- `packages/worker/wrangler.toml` now includes both queue producer and queue consumer configuration in the production-shaped env structure.
