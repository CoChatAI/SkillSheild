# Production Cutover Runbook

Follow these steps in order. Each step tells you exactly what to do, what value you need, and where to get it.

Do not skip ahead. Later steps depend on outputs from earlier steps.

## Prerequisites

### Accounts you need

Sign into all of these before starting:

1. **GitHub** at `https://github.com`
   - you need admin access to `CoChatAI/SkillSheild`
2. **Cloudflare** at `https://dash.cloudflare.com`
   - you need access to the account that owns the `cochat.ai` zone
3. **Fly.io** at `https://fly.io`
   - you need an account that can create and deploy apps

### Tools you need installed locally

- `gh` (GitHub CLI)
- `terraform`
- `flyctl`
- Docker
- Node.js 22+

This repo uses `npx pnpm@10.6.3 ...` so a global pnpm install is not required.

### Cloudflare API tokens you need to create first

Create these **before** starting the steps below. You will use them throughout.

Go to: `Cloudflare -> My Profile -> API Tokens -> Create Token -> Custom Token`

**Token 1: Worker deploy token**

Permissions:
- `Account -> Workers Scripts -> Edit`
- `Account -> D1 -> Edit`
- `Account -> Queues -> Edit`
- `Account -> Workers R2 Storage -> Edit`
- `Zone -> Workers Routes -> Edit`

Resources:
- `Account Resources -> Include -> your account`
- `Zone Resources -> Include -> your account`

**Token 2: Terraform infra token**

Permissions:
- `Account -> D1 -> Edit`
- `Account -> Queues -> Edit`
- `Account -> Workers R2 Storage -> Edit`
- `Zone -> Workers Routes -> Edit`
- `Zone -> DNS -> Edit`

Resources:
- `Account Resources -> Include -> your account`
- `Zone Resources -> Include -> your account`

**Token 3: Scanner runtime token**

Permissions:
- `Account -> D1 -> Edit`

Resources:
- `Account Resources -> Include -> your account`

### R2 S3-compatible credentials you need to create first

1. Go to: `Cloudflare -> Storage & databases -> R2 -> Overview`
2. In the right sidebar, find the **Account Details** section
3. Next to **API Tokens**, click **Manage**
4. Create a token with **Admin Read & Write** permissions
5. Copy these values immediately:
   - Access Key ID
   - Secret Access Key

The secret is shown once. Save it in your password manager immediately.

Your R2 endpoint is:

```text
https://YOUR_CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com
```

### Secrets you need to generate yourself

Generate two random secrets. Save them in a password manager.

```bash
openssl rand -hex 32
```

Run that twice. Use the outputs as:
- `WEBHOOK_SECRET` (used by Worker and webhook providers)
- `SCANNER_AUTH_TOKEN` (shared between Worker, scanner, and GitHub Actions)

### Cloudflare IDs you need to look up

- **Account ID**: visible on the Cloudflare dashboard home or right sidebar on account-level pages
- **Zone ID**: `Websites -> cochat.ai -> Overview`, right sidebar or API section
- **Workers subdomain**: `Workers & Pages -> Overview`, your `*.workers.dev` subdomain

### Fly deploy token you need to create

Go to: `https://fly.io` -> account settings -> access tokens

Create a deploy token and copy it.

---

## Step 1: Create the Fly app

The Fly app must exist before you can set secrets or deploy.

```bash
flyctl auth login
flyctl apps create skillshield-scanner
```

If `skillshield-scanner` is taken globally, use a different name and update:
- `packages/scanner/fly.toml` (`app = "..."`)
- `packages/worker/wrangler.toml` (`SCANNER_BASE_URL` in `[env.production.vars]`)
- GitHub repo variable `SCANNER_BASE_URL`

Verify it exists:

```bash
flyctl status --app skillshield-scanner
```

## Step 2: Create the Terraform inputs file

```bash
cp infrastructure/terraform/production.auto.tfvars.example infrastructure/terraform/production.auto.tfvars
```

Edit `infrastructure/terraform/production.auto.tfvars`:

```hcl
cloudflare_account_id = "YOUR_CLOUDFLARE_ACCOUNT_ID"
cloudflare_zone_id    = "YOUR_CLOUDFLARE_ZONE_ID"
worker_dns_target     = "skillshield-worker.YOUR_WORKERS_SUBDOMAIN.workers.dev"
```

Where to get them:
- `cloudflare_account_id`: Cloudflare dashboard
- `cloudflare_zone_id`: `Websites -> cochat.ai -> Overview`
- `worker_dns_target`: `Workers & Pages -> Overview`, format: `skillshield-worker.SUBDOMAIN.workers.dev`

## Step 3: Apply Terraform

Use your **Terraform infra token** for this step.

```bash
export CLOUDFLARE_API_TOKEN="YOUR_TERRAFORM_TOKEN"
```

```bash
terraform -chdir=infrastructure/terraform init
terraform -chdir=infrastructure/terraform plan
terraform -chdir=infrastructure/terraform apply
```

Capture the outputs:

```bash
terraform -chdir=infrastructure/terraform output
```

Save at least:
- `d1_database_id` (you need this for Fly secrets and `wrangler.toml`)

## Step 4: Update `wrangler.toml` with the real D1 database ID

Edit `packages/worker/wrangler.toml`.

Find:

```toml
database_id = "terraform-output-placeholder"
```

Replace with the real `d1_database_id` from the Terraform output.

Also confirm that `SCANNER_BASE_URL` matches your Fly app:

```toml
SCANNER_BASE_URL = "https://skillshield-scanner.fly.dev"
```

## Step 5: Set Fly scanner runtime secrets

Use the values you prepared:
- `SCANNER_AUTH_TOKEN`: the random token you generated
- `CF_API_TOKEN`: your **scanner runtime Cloudflare token** (Token 3)
- `CF_ACCOUNT_ID`: your Cloudflare account ID
- `D1_DATABASE_ID`: from Terraform output
- `R2_ENDPOINT`: `https://YOUR_CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com`
- `R2_ACCESS_KEY_ID`: from R2 API credentials
- `R2_SECRET_ACCESS_KEY`: from R2 API credentials

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

Optional:

```bash
flyctl secrets set \
  R2_SKILLS_BUCKET="skillshield-skills" \
  R2_REPORTS_BUCKET="skillshield-reports" \
  SKILL_SCANNER_LLM_API_KEY="..." \
  SKILL_SCANNER_LLM_MODEL="claude-sonnet-4-20250514" \
  VIRUSTOTAL_API_KEY="..." \
  --app skillshield-scanner
```

## Step 6: Deploy the scanner

```bash
flyctl deploy --config packages/scanner/fly.toml --remote-only
```

The scanner is intentionally scaled horizontally for queue-backed ingestion. Keep scanner-local concurrency at 1 and add Fly machines before increasing per-process work.

Current production target from `packages/scanner/fly.toml`:
- `min_machines_running = 2`
- `memory = "1024mb"`

Useful scaling commands:

```bash
flyctl scale count 2 --app skillshield-scanner
flyctl scale memory 1024 --app skillshield-scanner
flyctl status --app skillshield-scanner
```

If Fly reports an org machine-limit error, do not compensate by raising scanner-local concurrency. Resolve the Fly capacity limit first, then re-run the scale command.

Verify:

```bash
curl -fsS https://skillshield-scanner.fly.dev/health
```

Expected:

```json
{"status":"ok","service":"skillshield-scanner"}
```

Do not continue until this works.

## Step 7: Set Worker runtime secrets

Use your **Worker deploy token** for this step and all remaining Wrangler commands.

```bash
export CLOUDFLARE_API_TOKEN="YOUR_WORKER_DEPLOY_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="YOUR_CLOUDFLARE_ACCOUNT_ID"
```

```bash
cd packages/worker
npx pnpm@10.6.3 exec wrangler secret put WEBHOOK_SECRET --env production
npx pnpm@10.6.3 exec wrangler secret put SCANNER_AUTH_TOKEN --env production
```

Use the same `SCANNER_AUTH_TOKEN` value you put into Fly in Step 5.
Use the `WEBHOOK_SECRET` you generated earlier.

## Step 8: Apply the D1 schema

Still in `packages/worker`, still using the Worker deploy token:

```bash
npx pnpm@10.6.3 exec wrangler d1 execute skillshield-db --env production --file schema.sql
```

## Step 9: Deploy the Worker

Still in `packages/worker`:

```bash
npx pnpm@10.6.3 exec wrangler deploy --env production --config wrangler.toml
```

Verify:

```bash
curl -fsS https://skillshield.cochat.ai/health
```

Expected:

```json
{"status":"ok","service":"skillshield"}
```

## Step 10: Set GitHub secrets for CI/CD

These are only needed if you want to deploy and run scrapes from GitHub Actions.

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo CoChatAI/SkillSheild --env production
gh secret set CLOUDFLARE_ACCOUNT_ID --repo CoChatAI/SkillSheild --env production
gh secret set FLY_API_TOKEN --repo CoChatAI/SkillSheild --env production
gh secret set SCANNER_AUTH_TOKEN --repo CoChatAI/SkillSheild --env production
```

Use:
- `CLOUDFLARE_API_TOKEN`: your **Worker deploy token** (Token 1)
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
- `FLY_API_TOKEN`: your Fly deploy token
- `SCANNER_AUTH_TOKEN`: the same random token used in Fly and Worker

Confirm the repo variable is set:

```bash
gh variable list --repo CoChatAI/SkillSheild
```

You want `SCANNER_BASE_URL=https://skillshield-scanner.fly.dev`.

If missing:

```bash
gh variable set SCANNER_BASE_URL --repo CoChatAI/SkillSheild --body "https://skillshield-scanner.fly.dev"
```

## Step 11: Run a bounded scrape

Do not start with a full backfill. Test with a small limit first.

```bash
curl --fail-with-body --show-error --silent \
  -X POST \
  -H "Authorization: Bearer YOUR_SCANNER_AUTH_TOKEN" \
  "https://skillshield-scanner.fly.dev/scrape/clawhub?wait=true&limit=5"
```

Then:

```bash
curl --fail-with-body --show-error --silent \
  -X POST \
  -H "Authorization: Bearer YOUR_SCANNER_AUTH_TOKEN" \
  "https://skillshield-scanner.fly.dev/scrape/skills-sh?wait=true&limit=5"
```

Verify data landed:

```bash
curl -fsS https://skillshield.cochat.ai/api/v1/stats
curl -fsS https://skillshield.cochat.ai/api/v1/recent
```

## Step 12: Run full scrapes

After bounded scrapes pass, run real backfills. Full scrapes should enqueue jobs and return quickly; they should not keep GitHub Actions waiting for every skill scan to finish.

Order:
1. `clawhub`
2. `skills-sh`

Use GitHub Actions `Full Scrape` workflow:
- `execute=true`
- `wait=false`
- no `limit`

The workflow builds a `POST /scrape/:source?wait=false` request. A successful full scrape returns `202` with a `runId`, discovered count, and queued count. The Cloudflare Queue consumer then dispatches individual `/scan` calls to the Fly scanner with `SCANNER_AUTH_TOKEN`.

Or call the scanner directly without the `limit` parameter:

```bash
curl --fail-with-body --show-error --silent \
  -X POST \
  -H "Authorization: Bearer YOUR_SCANNER_AUTH_TOKEN" \
  "https://skillshield-scanner.fly.dev/scrape/clawhub?wait=false"
```

Only use `wait=true` for bounded smoke tests such as `limit=5`.

### Monitor queue-backed scrape status

Use the Worker status endpoint with the same `SCANNER_AUTH_TOKEN` used by the scanner and GitHub Actions:

```bash
curl --fail-with-body --show-error --silent \
  -H "Authorization: Bearer YOUR_SCANNER_AUTH_TOKEN" \
  "https://skillshield.cochat.ai/api/v1/scrape-runs?limit=10"
```

Drill into a specific run's jobs:

```bash
curl --fail-with-body --show-error --silent \
  -H "Authorization: Bearer YOUR_SCANNER_AUTH_TOKEN" \
  "https://skillshield.cochat.ai/api/v1/scrape-runs/RUN_ID/jobs?limit=100"
```

Interpretation:
- `queued_jobs` includes both queued and retrying jobs.
- `running_jobs` are jobs currently being dispatched to the scanner.
- `completed_jobs` and `failed_jobs` are terminal job counts.
- A run becomes `completed` when no queued, running, or retrying jobs remain and no jobs failed.
- A run becomes `failed` when no active jobs remain and at least one job failed.

Dashboard exposure for scrape runs is a follow-up. The authenticated API above is the production operator surface for this rollout.

## Step 13: Register upstream webhooks

Only do this after all of the above works.

### ClawHub

- Endpoint: `https://skillshield.cochat.ai/webhooks/clawhub`
- Secret: your `WEBHOOK_SECRET`

### GitHub

- Where: `Repository -> Settings -> Webhooks` for each skills.sh-backed repo
- Endpoint: `https://skillshield.cochat.ai/webhooks/github`
- Secret: your `WEBHOOK_SECRET`
- Events: `push` and `release`

After registration, send one test delivery from each provider and verify:
- Worker returns the expected response
- `webhook_events` row is written
- queue forwarding occurs
- scanner executes the resulting job

## Step 14: Final smoke checks

```bash
curl -fsS https://skillshield.cochat.ai/health
curl -fsS https://skillshield.cochat.ai/api/v1/stats
curl -fsS https://skillshield.cochat.ai/api/v1/recent
curl -fsS "https://skillshield.cochat.ai/api/search?q=design&limit=10"
curl -fsS https://skillshield.cochat.ai/
```

Also verify:
- one ClawHub route works under `/clawhub/api/v1/*`
- one skills.sh route works under `/skills/*`

## Rollback

If something fails, stop at the earliest safe boundary.

- **Scanner deploy fails**: do not deploy the Worker. Fix scanner first.
- **Worker deploy fails**: do not register webhooks. Fix Worker first.
- **D1 schema fails**: do not run scrapes. Fix schema targeting first.
- **Bounded scrape fails**: do not run full scrapes. Check scanner logs and credentials.
- **Webhook test fails**: remove the webhook registration immediately. Check Worker logs, queue, and scanner auth.

## Done

If all 14 steps pass, SkillShield is live.
