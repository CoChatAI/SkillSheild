# Phase 5: Final Secret Wiring and Production Cutover Plan

## Purpose

- Make secret wiring the last operational step after the code, Terraform, Fly config, Wrangler config, Docker image, and GitHub Actions workflows from Phases 1 through 4 are already merged and validated without live credentials.
- Introduce only the minimum production-only values needed to turn the repo's placeholder and account-agnostic config into a live deployment.

## Hard gate before any secret is added

- Do not start this phase until all earlier non-secret work is complete and verified:
  - Terraform config exists for D1, R2, DNS, and `scan-jobs`.
  - `packages/worker/wrangler.toml` has final queue producer and consumer shape plus environment split.
  - `packages/scanner/Dockerfile` builds the real scanner image.
  - `fly.toml` exists and validates.
  - `.github/workflows/deploy-worker.yml`, `deploy-scanner.yml`, and `full-scrape.yml` are real workflows, not placeholders.
  - The Worker queue consumer and scanner bearer-token contract from Phase 3 are implemented and tested.

## Secret inventory by platform

### Cloudflare Worker

- `WEBHOOK_SECRET`
  - Used by `packages/worker/src/routes/webhooks.ts` to protect `/webhooks/clawhub` and verify GitHub webhook signatures.
  - Must match the secret configured in ClawHub and GitHub webhook settings.
- `SCANNER_SHARED_TOKEN`
  - Added as a Wrangler secret once the Phase 3 queue-consumer-to-scanner auth work lands.
  - Used by the Worker queue consumer when it sends `Authorization: Bearer <token>` to the Fly scanner `POST /scan` endpoint.

### Fly scanner runtime

- `SCANNER_SHARED_TOKEN`
  - Same value as the Worker secret above.
  - Protects `POST /scan` and `POST /scrape/:source` while leaving `/health` public for health checks.
- `CF_API_TOKEN`
  - Used by `packages/scanner/src/publisher.ts` and `packages/scanner/src/db.ts` to write scan results into D1 through the Cloudflare API.
- `D1_DATABASE_ID`
  - The real production D1 ID that replaces the placeholder currently seen in `packages/worker/wrangler.toml`.
- `R2_ENDPOINT`
  - Cloudflare R2 S3-compatible endpoint used by `packages/scanner/src/publisher.ts`.
- `R2_ACCESS_KEY_ID`
  - R2 credential for object uploads.
- `R2_SECRET_ACCESS_KEY`
  - R2 secret for object uploads.
- Optional runtime values that should still be wired only at cutover if production-specific:
  - `R2_SESSION_TOKEN` if temporary credentials are used.
  - `R2_SKILLS_BUCKET` if the deployment overrides the current default `skillshield-skills`.
  - `R2_REPORTS_BUCKET` if the deployment overrides the current default `skillshield-reports`.
  - `SKILL_SCANNER_LLM_API_KEY` if LLM-backed scanner analysis is enabled in production.
  - `SKILL_SCANNER_LLM_MODEL` if production should pin a non-default model.
  - `VIRUSTOTAL_API_KEY` if VirusTotal-backed enrichment is enabled.

### GitHub Actions / deploy automation

- Cloudflare deploy credentials for `deploy-worker.yml`
  - `CLOUDFLARE_API_TOKEN` or the exact token name chosen in the workflow.
  - `CLOUDFLARE_ACCOUNT_ID` if the workflow needs explicit account selection.
- Fly deploy credentials for `deploy-scanner.yml`
  - `FLY_API_TOKEN`.
- Scanner operator workflow secrets for `full-scrape.yml`
  - `SCANNER_BASE_URL` if the workflow is not deriving it from Fly output.
  - `SCANNER_SHARED_TOKEN` so the workflow can call the private scanner scrape endpoint.
- Terraform apply credentials if Terraform apply is executed from GitHub Actions rather than locally
  - Cloudflare token and account/zone IDs as chosen in the workflow implementation.

## Values that are not secrets but belong in the same final wiring window

- Production D1 database ID.
- Cloudflare account ID and zone ID.
- Final Fly scanner hostname used for `SCANNER_BASE_URL`.
- Final Worker route and DNS target if they are environment-injected rather than checked in.

These are account-specific cutover values. They should be introduced at the end with the secrets because they are what turns the repo from pre-secret validation mode into a real production deployment.

## Final cutover sequence

1. Freeze the repo at the pre-secret-ready state.
   - Confirm the outputs from Phases 1 through 4 are merged.
   - Confirm CI passes without production credentials.
   - Confirm no placeholder workflow remains.

2. Create or confirm production infrastructure.
   - Apply the reviewed Terraform for D1, R2, queue, and DNS.
   - Record the real outputs: D1 ID, bucket names, queue name, route details, and DNS details.
   - Do not register webhooks yet.

3. Wire scanner runtime secrets first.
   - Add Fly secrets for `SCANNER_SHARED_TOKEN`, `CF_API_TOKEN`, `D1_DATABASE_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
   - Add optional scanner feature secrets only if those features are intended on day one.
   - Deploy the scanner with `deploy-scanner.yml`.
   - Verify Fly health before touching the Worker.

4. Wire Worker secrets and production vars second.
   - Set Wrangler secret `WEBHOOK_SECRET`.
   - Set Wrangler secret `SCANNER_SHARED_TOKEN`.
   - Set non-secret production var `SCANNER_BASE_URL` to the verified Fly scanner URL.
   - Set the real production D1 ID and other production resource bindings in the production Wrangler environment.
   - Apply the D1 schema from `packages/worker/schema.sql` if the database is new.
   - Deploy the Worker with `deploy-worker.yml`.

5. Run bounded production smoke checks before backfill.
   - Verify Worker `/health` on the production route.
   - Verify scanner `/health` on Fly.
   - Trigger one authenticated scanner `POST /scan` or one queue-backed test job and confirm a D1 row plus report upload are produced.
   - Confirm the Worker can publicly read the resulting report and badge paths.

6. Run the first controlled scrape.
   - Use `full-scrape.yml` with a bounded `limit` first, one source at a time.
   - Start with `wait=true` for the first production run so the operator gets explicit success or failure counters.
   - Confirm new rows appear in D1 and expected assets appear in R2.
   - Confirm the dashboard and public API routes reflect the new scans.

7. Expand to full production scrape.
   - Run `clawhub` and `skills-sh` full scrapes once the bounded scrape succeeds.
   - Confirm public reads still work for several sampled skills across both sources.

8. Register upstream webhooks last.
   - Register ClawHub webhook to `https://skillshield.cochat.ai/webhooks/clawhub` using `WEBHOOK_SECRET`.
   - Register GitHub webhook to `https://skillshield.cochat.ai/webhooks/github` with the same secret and the `push` and `release` events already handled by `packages/worker/src/routes/webhooks.ts`.
   - Send one test delivery from each provider and confirm the Worker stores the event and the queue-to-scanner path completes.

9. Declare go-live only after webhook-driven scans succeed.
   - At this point the system is no longer depending only on operator-triggered scrapes.
   - This is the real production cutover moment because live upstream change events are now enabled.

## Production smoke tests

### Runtime health

- `GET https://skillshield.cochat.ai/health` returns `200` and `{"status":"ok","service":"skillshield"}`.
- `GET <scanner-fly-url>/health` returns `200` and the scanner service payload.

### Queue and scanner seam

- A real queue-backed scan job reaches the scanner and returns success instead of stalling in the queue.
- A bad scanner token causes an obvious `401`, proving auth is actually enforced.
- A transient scanner failure causes retry behavior at the queue boundary instead of silent success.

### Storage and database publishing

- The scanner successfully writes a report object to `skillshield-reports` or the configured override.
- The scanner successfully writes the latest asset archive to `skillshield-skills` or the configured override when the verdict allows publishing.
- The matching `skills` and `scan_runs` rows appear in D1.

### Public read path

- The Worker can serve the generated report from `/reports/*`.
- The Worker can serve the badge from `/badge/*`.
- `/api/v1/stats`, `/api/v1/recent`, and the root dashboard `/` reflect the newly scanned skill.

### Webhook path

- A ClawHub test webhook returns `202` and creates a `webhook_events` row.
- A GitHub `push` or `release` webhook returns the expected queued response and fans out only for indexed repositories.
- Each webhook test leads to an observable scan result end to end.

## Go-live acceptance criteria

- All required production secrets and IDs are present in Fly, Wrangler, and GitHub Actions with no plaintext credentials committed to the repo.
- The scanner is healthy on Fly and can publish to both D1 and R2 using production credentials.
- The Worker is healthy on `skillshield.cochat.ai`, can enqueue jobs, and can forward them to the authenticated scanner.
- At least one bounded production scrape succeeds for each source intended for launch.
- Public report, badge, dashboard, and API reads work against freshly scanned data.
- ClawHub and GitHub webhook test deliveries succeed end to end.
- Webhooks are registered only after the manual scrape and queue-path verification succeed.

## Rollback posture

- If scanner health or publishing fails after secrets are wired, remove or rotate `SCANNER_SHARED_TOKEN` and pause deploy workflows before registering webhooks.
- If the Worker deploy fails, do not register webhooks; keep the scanner healthy but isolated.
- If bounded scrape fails, stop before full scrape and before webhook registration.
- If webhook-driven scans fail after registration, immediately disable upstream webhooks and investigate using the saved `webhook_events` rows and queue/scanner logs.

## Expected final state

- All non-secret implementation work was completed before this phase.
- Production-only secrets and IDs were introduced in one narrow cutover window.
- Operator-triggered smoke tests passed before any live upstream webhook traffic was enabled.
- Webhook registration was the final irreversible step.
