# Production Cutover Runbook

## Purpose

Use this runbook once the pre-secret implementation work is complete.

This document assumes the repo is already in the state described by:

- `.opencode/plans/skillshield-pre-secret-deploy-readiness-20260330-121500/outputs/final-readiness.md`

At the start of this runbook, the only work left should be:

- applying real secrets and account-specific IDs
- deploying the scanner and Worker
- applying the D1 schema
- running bounded and full scrapes
- registering upstream webhooks

## Definition Of Done

Cutover is complete only when all of the following are true:

1. Terraform has created the production Cloudflare resources.
2. Fly has the scanner deployed and returning `200` from `/health`.
3. Cloudflare has the Worker deployed on the production route.
4. `packages/worker/schema.sql` has been applied to the production D1 database.
5. One bounded scrape has succeeded.
6. Full scrapes for the intended launch sources have succeeded.
7. ClawHub and GitHub webhook test deliveries both complete end to end.

## Required Inputs

### Cloudflare IDs and deploy credentials

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `cloudflare_zone_id` for Terraform
- production D1 database ID from Terraform output
- production DNS target for `worker_dns_target` in Terraform

### Worker runtime secrets

- `WEBHOOK_SECRET`
- `SCANNER_AUTH_TOKEN`

### Worker production vars and bindings

- `SCANNER_BASE_URL`
- `SCANNER_REQUEST_TIMEOUT_MS` if overriding the default
- production D1 database ID in `packages/worker/wrangler.toml` under `[env.production]`

### Fly deploy credential

- `FLY_API_TOKEN`

### Scanner runtime secrets

- `SCANNER_AUTH_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`
- `D1_DATABASE_ID`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### Optional scanner runtime secrets

- `R2_SESSION_TOKEN`
- `R2_SKILLS_BUCKET`
- `R2_REPORTS_BUCKET`
- `SKILL_SCANNER_LLM_API_KEY`
- `SKILL_SCANNER_LLM_MODEL`
- `VIRUSTOTAL_API_KEY`

### GitHub Actions runtime wiring

- repo or environment secret `CLOUDFLARE_API_TOKEN`
- repo or environment secret `CLOUDFLARE_ACCOUNT_ID`
- repo or environment secret `FLY_API_TOKEN`
- repo or environment secret `SCANNER_AUTH_TOKEN`
- repo or environment variable `SCANNER_BASE_URL`

## Preflight

Run these checks before touching production credentials.

1. Confirm the final readiness doc still says only cutover items remain.
2. Confirm the production files are the intended ones:
   - `packages/worker/wrangler.toml`
   - `packages/scanner/fly.toml`
   - `.github/workflows/deploy-worker.yml`
   - `.github/workflows/deploy-scanner.yml`
   - `.github/workflows/full-scrape.yml`
   - `infrastructure/terraform/*`
3. Confirm the scanner image still builds locally:

```bash
docker build -f packages/scanner/Dockerfile -t skillshield-scanner-cutover .
```

4. Confirm Terraform still validates:

```bash
terraform -chdir=infrastructure/terraform init -backend=false
terraform -chdir=infrastructure/terraform validate
```

## Step 1: Apply Cloudflare Infrastructure

Run Terraform first so all account-specific IDs come from a real source of truth.

1. Prepare production tfvars or environment variables for:
   - `cloudflare_account_id`
   - `cloudflare_zone_id`
   - `worker_dns_target`
2. Review the planned changes:

```bash
terraform -chdir=infrastructure/terraform plan
```

3. Apply the stack:

```bash
terraform -chdir=infrastructure/terraform apply
```

4. Record these outputs immediately:

```bash
terraform -chdir=infrastructure/terraform output
```

You will need at least:

- `d1_database_id`
- `worker_route`
- `worker_hostname`
- `skills_bucket_name`
- `reports_bucket_name`
- `meta_bucket_name`
- `scan_queue_name`

## Step 2: Wire Fly Scanner Secrets

Set all scanner runtime secrets before attempting deploy.

Example:

```bash
flyctl secrets set \
  SCANNER_AUTH_TOKEN="..." \
  CF_ACCOUNT_ID="..." \
  CF_API_TOKEN="..." \
  D1_DATABASE_ID="..." \
  R2_ENDPOINT="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  --app skillshield-scanner
```

If used, also set:

```bash
flyctl secrets set \
  R2_SESSION_TOKEN="..." \
  R2_SKILLS_BUCKET="skillshield-skills" \
  R2_REPORTS_BUCKET="skillshield-reports" \
  SKILL_SCANNER_LLM_API_KEY="..." \
  SKILL_SCANNER_LLM_MODEL="..." \
  VIRUSTOTAL_API_KEY="..." \
  --app skillshield-scanner
```

## Step 3: Deploy The Scanner First

You want the private execution backend healthy before the Worker starts forwarding queue jobs to it.

### Option A: GitHub Actions

Run `Deploy Scanner` with `deploy=true`.

### Option B: Local CLI

```bash
flyctl auth login
flyctl config validate -c packages/scanner/fly.toml
flyctl deploy --config packages/scanner/fly.toml --remote-only
```

### Verify Scanner Health

```bash
curl -fsS https://skillshield-scanner.fly.dev/health
```

Expected response:

```json
{"status":"ok","service":"skillshield-scanner"}
```

Do not continue until this works.

## Step 4: Wire Worker Production Config And Secrets

The Worker needs both secret values and one real account-specific binding update.

1. Update `packages/worker/wrangler.toml` production D1 placeholder:

- replace `database_id = "terraform-output-placeholder"`
- with the real `d1_database_id` from Terraform output

2. Confirm the production scanner base URL is correct in `packages/worker/wrangler.toml`:

- `SCANNER_BASE_URL = "https://skillshield-scanner.fly.dev"`

3. Add Worker secrets:

```bash
cd packages/worker
npx pnpm@10.6.3 exec wrangler secret put WEBHOOK_SECRET --env production
npx pnpm@10.6.3 exec wrangler secret put SCANNER_AUTH_TOKEN --env production
```

4. Make sure the same values are present in GitHub Actions if you intend to deploy via workflow.

## Step 5: Apply The D1 Schema

Run this after infrastructure exists and before relying on any production writes.

Example:

```bash
cd packages/worker
npx pnpm@10.6.3 exec wrangler d1 execute skillshield-db --env production --file schema.sql
```

If your Wrangler version or account setup prefers database ID targeting, use the equivalent production-safe `wrangler d1 execute` form for that environment.

## Step 6: Deploy The Worker

### Option A: GitHub Actions

Run `Deploy Worker` with `deploy=true`.

### Option B: Local CLI

```bash
cd packages/worker
npx pnpm@10.6.3 exec wrangler deploy --env production --config wrangler.toml
```

### Verify Worker Health

```bash
curl -fsS https://skillshield.cochat.ai/health
```

Expected response:

```json
{"status":"ok","service":"skillshield"}
```

## Step 7: Smoke-Test The Queue To Scanner Seam

Do this before any full scrape or live webhook registration.

1. Trigger one scanner request directly to confirm auth and publishing work.
2. Then trigger one queue-backed scan path through the Worker if you have a safe test event source available.

At minimum, verify:

- scanner returns `401` without the token when auth is configured
- scanner returns `200` with the token
- a successful scan writes D1 rows
- a successful scan uploads a report to R2
- the Worker can read the resulting public artifact path

Suggested public read checks after one successful scan:

```bash
curl -fsS https://skillshield.cochat.ai/api/v1/stats
curl -fsS https://skillshield.cochat.ai/api/v1/recent
curl -fsS https://skillshield.cochat.ai/
```

## Step 8: Run A Bounded Scrape First

Do not start with a full backfill.

### Option A: GitHub Actions

Run `Full Scrape` with:

- `execute=true`
- `source=clawhub` or `skills-sh`
- `wait=true`
- a small `limit` such as `3` or `5`

### Option B: Direct scanner call

```bash
curl --fail-with-body --show-error --silent \
  -X POST \
  -H "Authorization: Bearer $SCANNER_AUTH_TOKEN" \
  "https://skillshield-scanner.fly.dev/scrape/clawhub?wait=true&limit=5"
```

Repeat for `skills-sh` once the first source succeeds.

### Success criteria

- scrape returns completed counters
- D1 row counts increase
- R2 report objects exist
- Worker public routes can read the new data

## Step 9: Run Full Scrapes

Once bounded scrapes are green, run the real source backfills.

Recommended order:

1. `clawhub`
2. `skills-sh`

If using the workflow, keep `wait=true` for the first full production runs so the output stays explicit.

## Step 10: Register Upstream Webhooks Last

This is the first irreversible external traffic step.

### ClawHub

- Endpoint: `https://skillshield.cochat.ai/webhooks/clawhub`
- Secret: `WEBHOOK_SECRET`

### GitHub

- Endpoint: `https://skillshield.cochat.ai/webhooks/github`
- Secret: `WEBHOOK_SECRET`
- Events:
  - `push`
  - `release`

After registration, send one test delivery from each provider and verify:

- Worker returns the expected response
- `webhook_events` row is written
- queue forwarding occurs
- scanner executes the resulting job

## Step 11: Post-Cutover Checks

Run these checks after webhooks are live.

```bash
curl -fsS https://skillshield.cochat.ai/health
curl -fsS https://skillshield.cochat.ai/api/v1/stats
curl -fsS https://skillshield.cochat.ai/api/v1/recent
curl -fsS "https://skillshield.cochat.ai/api/search?q=design&limit=10"
curl -fsS https://skillshield.cochat.ai/
```

Also verify one real skill path from each source:

- one ClawHub metadata or download path under `/clawhub/api/v1/*`
- one skills.sh metadata or download path under `/skills/*`

## Rollback

If something fails, stop at the earliest safe boundary.

### Scanner deploy fails

- do not deploy the Worker
- inspect Fly logs
- fix scanner runtime or secrets first

### Worker deploy fails

- do not register webhooks
- keep scanner isolated
- fix Worker config or secrets first

### D1 schema apply fails

- do not run scrapes
- correct schema/apply targeting first

### Bounded scrape fails

- do not run full scrapes
- do not register webhooks
- inspect scanner logs and D1/R2 credentials first

### Webhook test delivery fails

- disable or remove webhook configuration immediately
- inspect Worker logs, queue behavior, and scanner auth

## Operator Notes

- `flyctl config validate` is expected to require Fly auth. Use it during live cutover, not as a local anonymous check.
- On this machine, plain `pnpm` may still be blocked by Corepack signature verification. If that recurs locally, use the already-documented direct local binaries or run the GitHub workflows instead.
- Keep webhook registration last. That ordering is the main protection against accepting live upstream events before the queue and scanner path is proven.
