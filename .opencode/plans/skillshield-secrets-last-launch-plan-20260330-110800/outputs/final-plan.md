# SkillShield Secrets-Last Final Rollout Plan

## Goal

- Launch SkillShield from the current repo state without introducing production secrets until the repo is otherwise deployment-ready.
- Close the four known blockers in order: queue consumption, scanner container, Terraform-managed infrastructure, and deploy automation.
- Reserve the last major implementation step for wiring live credentials and performing production cutover.

## Current repo-grounded blockers

### 1. Queue consumption is incomplete
- `packages/worker/src/routes/webhooks.ts` already records webhook events and sends scan jobs to `c.env.SCAN_QUEUE.send(...)`.
- `packages/worker/src/index.ts` exports only the Hono fetch app. There is no Worker `queue(...)` handler.
- `packages/worker/wrangler.toml` defines only `[[queues.producers]]`, not `[[queues.consumers]]`.

### 2. Scanner container is not deployable
- `packages/scanner/src/index.ts` already exposes `/health`, `/scan`, and `/scrape/:source` on a Node server.
- `packages/scanner/Dockerfile` is still a scaffold that never installs the real app or starts the scanner.

### 3. Terraform is mostly empty
- `infrastructure/terraform/main.tf` only pins Terraform version.
- `infrastructure/terraform/d1.tf`, `r2.tf`, and `dns.tf` are stubs.
- There is no queue Terraform at all even though the Worker already targets `scan-jobs`.

### 4. Deploy automation is placeholder-only
- `.github/workflows/deploy-worker.yml`, `deploy-scanner.yml`, and `full-scrape.yml` are all `workflow_dispatch` placeholders that just `exit 0`.

## Target launch shape

### Public edge
- Keep `packages/worker` as the only public surface on Cloudflare.
- Keep public reads for dashboard, API, reports, and badges on Cloudflare-backed D1 and R2.

### Async execution seam
- Keep webhook ingress in the Worker.
- Add a Worker queue consumer so the runtime path becomes:
  `webhook -> Cloudflare Queue (scan-jobs) -> Worker queue consumer -> Fly scanner /scan`.

### Private scanner runtime
- Keep `packages/scanner` as the Fly-hosted private execution service.
- Protect `POST /scan` and `POST /scrape/:source` with a shared bearer token when configured.
- Leave `GET /health` public for health checks.

### Shared state
- Keep D1 as the system of record for scan state and webhook events.
- Keep R2 as the store for reports and published skill artifacts.

## Secrets-last rule

- Everything that can be authored, reviewed, built, validated, and tested without production credentials should land first.
- Production-only values stay out of checked-in config until the final wiring window.
- The final irreversible action is enabling live upstream webhooks after bounded production verification succeeds.

## Implementation sequence

### Step 1. Finish the queue contract and queue consumer
- Add one shared scan-job schema in `packages/shared` that matches the existing payload shape emitted by `packages/worker/src/routes/webhooks.ts`.
- Update webhook producers to parse against that shared schema before enqueueing.
- Add a Worker queue handler, for example in `packages/worker/src/queue.ts`, and export the Worker as an object with both `fetch` and `queue` handlers.
- Add `[[queues.consumers]]` to `packages/worker/wrangler.toml` for `scan-jobs` while keeping the producer binding.
- Add Worker env shape for scanner forwarding:
  - `SCANNER_BASE_URL`
  - `SCANNER_SHARED_TOKEN` as a secret, not a checked-in var
  - optional `SCANNER_REQUEST_TIMEOUT_MS`
- Retry policy: do not add a custom retry loop in Worker code. Let Cloudflare Queue retries handle transient scanner failures.

### Step 2. Harden the scanner request seam
- Parse `POST /scan` using the same shared schema used by the Worker.
- Add bearer-token auth around `POST /scan` and `POST /scrape/:source` using `SCANNER_SHARED_TOKEN`.
- Preserve local usability by bypassing auth when the token is unset.
- Update scanner types so the scan-job request contract is shared rather than duplicated.

### Step 3. Replace the scanner scaffold image with the real production image
- Replace `packages/scanner/Dockerfile` with a multi-stage build.
- Builder stage should install workspace dependencies and build `@skillshield/shared` plus `@skillshield/scanner`.
- Runtime stage should include the tools the current scanner code actually shells out to:
  - `skill-scanner`
  - `unzip`
  - `zip`
  - `tar`
- Start the real scanner server, expose port `3100`, and add a `/health` healthcheck.
- Prefer honoring `process.env.PORT` with `3100` as the default so Fly config stays simple.

### Step 4. Fill in Terraform before any live account wiring
- Expand `infrastructure/terraform/main.tf` to include the Cloudflare provider and shared locals.
- Replace stubs in `d1.tf`, `r2.tf`, and `dns.tf`.
- Add missing release-critical files:
  - `infrastructure/terraform/queues.tf`
  - `infrastructure/terraform/variables.tf`
  - `infrastructure/terraform/outputs.tf`
- Manage these named resources so Terraform matches current code and docs:
  - D1 database: `skillshield-db`
  - R2 buckets: `skillshield-skills`, `skillshield-reports`, `skillshield-meta`
  - queue: `scan-jobs`
  - public route/DNS for `skillshield.cochat.ai`
- Keep account-specific IDs and backend-state decisions out of the default checked-in config so validation can run without secrets.

### Step 5. Make Wrangler config production-shaped but still secret-free
- Keep the current binding names already used by Worker code: `DB`, `SKILLS_BUCKET`, `REPORTS_BUCKET`, `META_BUCKET`, `SCAN_QUEUE`.
- Add queue consumer config alongside the existing producer config.
- Add non-secret vars such as `SCANNER_BASE_URL` and optional timeout values.
- Add an environment split such as `[env.production]` while leaving safe placeholders in the default/local config.
- Keep `WEBHOOK_SECRET` and `SCANNER_SHARED_TOKEN` out of `[vars]`; they should be Wrangler secrets only.

### Step 6. Add Fly config
- Add checked-in `fly.toml` for the scanner app.
- Use the real scanner service shape already present in `packages/scanner/src/index.ts`:
  - app name such as `skillshield-scanner`
  - internal port `3100`
  - `/health` checks
  - scale-to-zero-friendly auto-stop/auto-start settings
- Keep only non-secret runtime shape in `fly.toml`.

### Step 7. Replace placeholder GitHub Actions workflows
- `deploy-worker.yml`
  - secret-free validation first: install, shared tests, Worker typecheck/tests, Terraform validate, Wrangler config validation or dry-run-safe equivalent
  - gated deploy path using GitHub secrets for Cloudflare auth
  - explicit D1 schema application from `packages/worker/schema.sql`
  - post-deploy check against Worker `/health`
- `deploy-scanner.yml`
  - secret-free validation first: install, shared tests, scanner typecheck/tests, Docker build, `fly.toml` validation
  - gated deploy path using `FLY_API_TOKEN`
  - post-deploy check against scanner `/health`
- `full-scrape.yml`
  - manual operator workflow
  - inputs aligned to the current scanner route: `source`, `wait`, `limit`, `delayMs`, `useLlm`
  - authenticated call to scanner `POST /scrape/:source`
  - summary output for bounded first-run verification

### Step 8. Validate the whole repo in pre-secret mode
- Run repo build, typecheck, and tests.
- Validate Terraform with `terraform fmt -check` and `terraform validate`.
- Validate `fly.toml`.
- Build the scanner image locally.
- Verify the Worker and scanner request seam with tests before any live credentials are introduced.

### Step 9. Final wiring window: introduce real secrets and account-specific IDs
- Apply Terraform against the real Cloudflare account and record outputs.
- Wire Fly scanner secrets:
  - `SCANNER_SHARED_TOKEN`
  - `CF_API_TOKEN`
  - `D1_DATABASE_ID`
  - `R2_ENDPOINT`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - optional `SKILL_SCANNER_LLM_API_KEY`, `SKILL_SCANNER_LLM_MODEL`, `VIRUSTOTAL_API_KEY`
- Wire Worker secrets and production vars:
  - `WEBHOOK_SECRET`
  - `SCANNER_SHARED_TOKEN`
  - production `SCANNER_BASE_URL`
  - real D1 ID and production route/bindings in Wrangler env config
- Deploy scanner first, then Worker.

### Step 10. Production verification and cutover
- Verify scanner `/health` on Fly.
- Verify Worker `/health` on the production route.
- Run one bounded authenticated production scan or queue-backed test job and confirm:
  - D1 rows are written
  - R2 report upload succeeds
  - public report/badge routes can read the result
- Run a bounded first scrape with `wait=true`.
- Run full scrapes for the intended launch sources only after the bounded run passes.
- Register ClawHub and GitHub webhooks last.
- Declare go-live only after webhook-driven scans succeed end to end.

## Dependency checks

- Queue consumer depends on a shared contract and scanner auth shape.
- Worker production deploy depends on real queue-consumer config, scanner base URL, and D1 schema readiness.
- Scanner production deploy depends on a real image and checked-in Fly config.
- Full scrape workflow depends on scanner auth and a healthy scanner deployment.
- Webhook registration depends on all earlier seams already working so live events do not enqueue into a dead path.

## Definition of done

- The repo contains a shared scan-job schema used by the Worker producer, Worker consumer, and scanner `/scan` route.
- The Worker both produces to and consumes from `scan-jobs`.
- `packages/scanner/Dockerfile` builds and runs the real scanner service with required runtime tools.
- Terraform manages D1, R2, DNS, and the missing queue resource instead of leaving stubs.
- `fly.toml` exists and validates.
- `.github/workflows/deploy-worker.yml`, `deploy-scanner.yml`, and `full-scrape.yml` are real workflows, not placeholders.
- All pre-secret validation passes without production credentials.
- The last major implementation step is production secret wiring and account-specific ID wiring.
- The final irreversible cutover action is registering live upstream webhooks after bounded production verification succeeds.

## Residual launch risks

- Cloudflare provider support for queue-consumer attachment may still require keeping consumer linkage in `wrangler.toml` even if the queue resource itself is Terraform-managed.
- The scanner image must prove `skill-scanner` installation is reproducible in CI and Fly, not only locally.
- The current default `database_id = "local-dev-placeholder"` in `packages/worker/wrangler.toml` is safe pre-cutover, but production env separation must be explicit so the real ID does not leak into local defaults.
- The most likely operational failure mode is still bad ordering. Webhooks must stay last.
