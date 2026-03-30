# Phase 4: Pre-Secret Infrastructure and Deployment Automation Plan

## Current repo gaps this phase closes

- `.github/workflows/deploy-worker.yml`, `.github/workflows/deploy-scanner.yml`, and `.github/workflows/full-scrape.yml` are still `exit 0` placeholders.
- `infrastructure/terraform/main.tf` only pins Terraform, and `d1.tf`, `r2.tf`, and `dns.tf` are stubs with no provider, variables, outputs, or resource definitions.
- `packages/worker/wrangler.toml` is production-leaning but not production-shaped yet because it only defines a queue producer, uses a placeholder D1 ID, and has no environment split for safe pre-secret validation.
- There is no checked-in Fly config at all even though Phase 2 fixed Fly as the scanner host.

## Pre-secret goal

- Land deploy-ready infrastructure and automation assets that are structurally complete before any real Cloudflare, Fly, GitHub, or scanner secrets are introduced.
- Keep secret wiring as a final substitution step into already-reviewed Terraform variables, Wrangler secrets, Fly secrets, and GitHub Actions secrets.

## Terraform plan

### Files to add or replace

- Expand `infrastructure/terraform/main.tf` to declare the Cloudflare provider, required provider version, and shared locals/tags.
- Replace the stub files with real definitions in:
  - `infrastructure/terraform/d1.tf`
  - `infrastructure/terraform/r2.tf`
  - `infrastructure/terraform/dns.tf`
- Add missing foundational files that the current repo does not have but the release needs:
  - `infrastructure/terraform/queues.tf`
  - `infrastructure/terraform/variables.tf`
  - `infrastructure/terraform/outputs.tf`
  - optionally `infrastructure/terraform/versions.tf` if the team wants provider/version pinning split from `main.tf`

### Resources to manage

#### D1
- Manage one Cloudflare D1 database matching the current Worker binding target name `skillshield-db` from `packages/worker/wrangler.toml`.
- Output both the D1 database name and generated database ID so later secret wiring can copy the real ID into Wrangler env config and scanner env/secrets without hand lookup.
- Keep schema application out of Terraform itself. The repo already has `packages/worker/schema.sql`, so schema execution should stay in deploy automation as an explicit post-create step.

#### R2
- Manage all three R2 buckets already named in repo config:
  - `skillshield-skills`
  - `skillshield-reports`
  - `skillshield-meta`
- Output the bucket names exactly as consumed today by `packages/worker/wrangler.toml` and scanner defaults in `packages/scanner/src/publisher.ts`.
- Treat the bucket names as variables with defaults equal to the checked-in names so later environments can override cleanly without editing code.

#### Queue
- Add a new `queues.tf` to manage the missing Cloudflare Queue for `scan-jobs`, because Phase 1 showed no Terraform currently covers it.
- Model the queue as the shared infrastructure seam between webhook ingestion and the Worker queue consumer designed in Phase 3.
- Add outputs for queue name and any queue identifiers needed by later observability or dashboard work.
- If Cloudflare queue consumer attachment is not Terraform-managed in the provider version the team uses, keep that linkage in `wrangler.toml` and document Terraform as owning only the queue resource itself.

#### DNS
- Manage the public hostname `skillshield.cochat.ai` in `dns.tf` rather than leaving DNS as a dashboard-only manual step.
- Point DNS at the Cloudflare Worker route model already implied by `packages/worker/wrangler.toml` and the README deploy flow.
- Make the zone ID and record target variable-driven so the config is reviewable before secrets and account-specific values exist.

### Variables and outputs

- Add required variables for Cloudflare account and zone identity rather than hardcoding account-specific values:
  - `cloudflare_account_id`
  - `cloudflare_zone_id`
  - `environment`
- Add defaulted variables for all resource names so the repo stays aligned with current code:
  - `worker_name = "skillshield-worker"`
  - `worker_route = "skillshield.cochat.ai/*"`
  - `d1_database_name = "skillshield-db"`
  - `skills_bucket_name = "skillshield-skills"`
  - `reports_bucket_name = "skillshield-reports"`
  - `meta_bucket_name = "skillshield-meta"`
  - `scan_queue_name = "scan-jobs"`
  - `scanner_app_name = "skillshield-scanner"`
- Add outputs for every created resource name/ID that later phases need for cutover: D1 ID, bucket names, queue name, route, and DNS record details.

### Validation work before secrets

- `terraform fmt -check` and `terraform validate` should run in CI against the checked-in config with placeholder tfvars or environment defaults.
- Keep backend configuration out of the checked-in default plan until the team decides where Terraform state lives. The current repo has no backend config, and forcing one now would add an unnecessary secret dependency.

## Wrangler plan

### Make the Worker config production-shaped

- Extend `packages/worker/wrangler.toml` from producer-only queue wiring to both producer and consumer wiring by adding `[[queues.consumers]]` for `scan-jobs`.
- Keep the existing producer binding `SCAN_QUEUE` because webhook routes still enqueue jobs.
- Add non-secret vars for the queue-consumer to reach the scanner service:
  - `SCANNER_BASE_URL`
  - optional `SCANNER_REQUEST_TIMEOUT_MS`
- Keep secret values out of `[vars]`. The future `SCANNER_SHARED_TOKEN` and `WEBHOOK_SECRET` should remain Wrangler secrets, not checked-in plain vars.

### Add environment split

- Add `[env.staging]` and/or `[env.production]` sections so the file can hold real resource bindings and routes without overwriting local defaults.
- Keep local/default values obviously non-production, including the current placeholder D1 ID, so pre-secret CI can still typecheck and validate config safely.
- Mirror the same binding names across envs so Worker code never branches on environment-specific binding names.

### Keep naming aligned with current code

- Preserve `DB`, `SKILLS_BUCKET`, `REPORTS_BUCKET`, `META_BUCKET`, and `SCAN_QUEUE`, because these names are already used in Worker code and tests.
- Preserve the public route `skillshield.cochat.ai/*`, which is already referenced by tests, README docs, and hardcoded public URL helpers.

## Fly plan

### Add missing checked-in Fly config

- Add a new `fly.toml` at repo root or under `packages/scanner/` and standardize on one location in the workflow docs.
- Use `app = "skillshield-scanner"` unless the team has an existing Fly app naming convention to match.
- Configure the service around the scanner's real Node server in `packages/scanner/src/index.ts`:
  - internal port `3100` unless the code is updated to honor `PORT`
  - health check against `/health`
  - auto-stop/auto-start or min-machines settings consistent with scale-to-zero
  - no public marketing routes or assets; only the private scanner API needs to exist there

### What belongs in config vs secrets

- Check in non-secret runtime shape only:
  - app name
  - region preference if desired
  - HTTP service/internal port
  - health checks
  - optional concurrency and auto-stop settings
- Do not check in real values for scanner env secrets such as:
  - `CF_ACCOUNT_ID`
  - `CF_API_TOKEN`
  - `D1_DATABASE_ID`
  - `R2_ENDPOINT`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `SKILL_SCANNER_LLM_API_KEY`
  - `VIRUSTOTAL_API_KEY`
  - `SCANNER_SHARED_TOKEN`

### Pre-secret Fly verification

- `fly config validate` should pass against the checked-in `fly.toml` without requiring any secrets.
- The scanner image should be buildable locally from `packages/scanner/Dockerfile` before any Fly deploy is attempted.

## GitHub Actions plan

### Shared workflow structure

- Replace each placeholder workflow with a real pipeline that has three layers:
  - validation steps that run without secrets
  - deploy or operator steps gated on the presence of secrets and manual dispatch inputs
  - post-action verification steps that fail loudly when the runtime shape is wrong
- Use `workflow_dispatch` for all three workflows first. Add automatic triggers only after the manual path is proven.
- Centralize repo bootstrap steps in every workflow:
  - `actions/checkout`
  - `actions/setup-node` with Node 22
  - pinned `pnpm@10.6.3`
  - `npx pnpm@10.6.3 install --frozen-lockfile`

### `deploy-worker.yml`

#### Validation stage
- Run targeted checks for the Worker and shared package:
  - `npx pnpm@10.6.3 --filter @skillshield/shared test`
  - `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`
  - `npx pnpm@10.6.3 --filter @skillshield/worker test`
- Run Terraform validation in `infrastructure/terraform` so the Worker deploy pipeline also verifies infrastructure drift is not being ignored.
- Run a non-deploy Wrangler config validation step if available, or at minimum a dry-run-safe `wrangler deploy --dry-run` equivalent for the selected Wrangler version.

#### Deploy stage
- Require manual environment selection such as `staging` or `production`.
- Authenticate with Wrangler only through GitHub Actions secrets at deploy time.
- Deploy from `packages/worker` with explicit environment selection so the right `wrangler.toml` env block is used.
- Run D1 schema application as a separate, explicit step after infrastructure exists but before the Worker deploy is declared complete.

#### Post-deploy verification
- Hit `https://skillshield.cochat.ai/health` or the environment-specific Worker URL and verify `status: ok`.
- Optionally verify that the queue consumer config deployed by checking Worker config output or a smoke enqueue once later phases land the consumer.

### `deploy-scanner.yml`

#### Validation stage
- Run scanner and shared checks:
  - `npx pnpm@10.6.3 --filter @skillshield/shared test`
  - `npx pnpm@10.6.3 --filter @skillshield/scanner typecheck`
  - `npx pnpm@10.6.3 --filter @skillshield/scanner test`
- Build the production image from `packages/scanner/Dockerfile`.
- Validate `fly.toml` before any secret-backed deploy step.

#### Deploy stage
- Authenticate to Fly using GitHub Actions secrets only at deploy time.
- Deploy the image with the checked-in `fly.toml`.
- Keep scanner env and secret provisioning out of the image build; set them through Fly secrets or deploy-time environment management in the final cutover phase.

#### Post-deploy verification
- Poll the Fly app health endpoint `/health` until it returns `200`.
- Record the resolved Fly hostname in workflow output so the later Worker `SCANNER_BASE_URL` secret/var wiring step has a concrete target.

### `full-scrape.yml`

#### Operator inputs
- Replace the placeholder with a manual operator workflow that accepts at least:
  - `source` as `clawhub` or `skills-sh`
  - `wait` boolean
  - optional `limit`
  - optional `delayMs`
  - optional `useLlm`
- This maps directly to the current scanner route shape in `packages/scanner/src/index.ts`, which already accepts `wait`, `limit`, `delayMs`, and `useLlm` query parameters on `POST /scrape/:source`.

#### Execution shape
- Call the private scanner endpoint rather than trying to fake a scrape inside GitHub Actions.
- Authenticate with the same `SCANNER_SHARED_TOKEN` bearer contract designed in Phase 3, but only inject that token at runtime from GitHub Actions secrets.
- Fail fast on non-2xx responses and print the scanner response body for operator debugging.

#### Post-run verification
- If `wait=true`, require the workflow to parse the returned counters and surface `completed`, `failed`, and `verdicts` in the job summary.
- If `wait=false`, surface that the scrape was started asynchronously and record the source plus inputs for auditability.

## Recommended delivery order inside this phase scope

1. Add Terraform structure first: provider, variables, outputs, and new `queues.tf` so the missing infrastructure surface is fully named.
2. Update `packages/worker/wrangler.toml` to production-shaped bindings and env blocks, still without secrets.
3. Add `fly.toml` with health checks, scale-to-zero behavior, and app naming.
4. Replace `deploy-worker.yml` with validation plus gated deploy steps.
5. Replace `deploy-scanner.yml` with image-build, Fly-validate, and gated deploy steps.
6. Replace `full-scrape.yml` with the manual operator workflow that calls the scanner route.
7. Verify all of the above with secret-free checks: Terraform validate, workflow linting if available, Wrangler config validation, Fly config validation, and Docker build.

## What still intentionally waits for Phase 5

- Real Cloudflare account credentials and IDs.
- Real Fly auth and scanner runtime secrets.
- Real Wrangler secrets such as `WEBHOOK_SECRET` and `SCANNER_SHARED_TOKEN`.
- Live DNS apply, Worker deploy, scanner deploy, webhook registration, and first production scrape execution.

## Expected pre-secret end state

- Terraform defines D1, R2, DNS, and the missing `scan-jobs` queue instead of leaving stubs.
- `packages/worker/wrangler.toml` is ready for both queue production and consumption, with secret-free runtime vars checked in and secrets deferred.
- A checked-in `fly.toml` exists for the scanner service and validates before any credentials are provided.
- All three placeholder GitHub Actions workflows are replaced by real, manual-first automation that is structurally complete before secret wiring.
