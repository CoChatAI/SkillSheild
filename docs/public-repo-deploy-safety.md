# Public Repo Deploy Safety

SkillShield is safe to keep in a public GitHub repository as long as deploy credentials and runtime secrets stay outside committed files.

## What Lives Where

## Long-Term Homes

Do not treat one-off `export ...` commands as the permanent home for deploy configuration.

Use this split instead:

- GitHub `production` environment secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `FLY_API_TOKEN`
  - `SCANNER_AUTH_TOKEN` if you want the `Full Scrape` workflow to execute against the scanner
- GitHub repo variable:
  - `SCANNER_BASE_URL`
- Cloudflare Worker runtime secrets:
  - `WEBHOOK_SECRET`
  - `SCANNER_AUTH_TOKEN`
- Fly runtime secrets:
  - `SCANNER_AUTH_TOKEN`
  - `CF_ACCOUNT_ID`
  - `CF_API_TOKEN`
  - `D1_DATABASE_ID`
  - `R2_ENDPOINT`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - optional scanner-related keys
- Local Terraform inputs:
  - store non-secret values in an untracked `infrastructure/terraform/production.auto.tfvars`
  - start from `infrastructure/terraform/production.auto.tfvars.example`
- Local manual deploy shell values:
  - export them only in the terminal session you are actively using, or load them from a local tool such as `direnv` or a password manager shell integration

The important rule is:

- checked-in repo files may contain non-secret defaults and examples
- live tokens and secrets should live in GitHub, Cloudflare, Fly, or your local machine only

## Recommended Setup Order

Use this order so you only set each value once in its long-term home.

1. Create `infrastructure/terraform/production.auto.tfvars` from `production.auto.tfvars.example` and fill in the non-secret Cloudflare values.
2. Add GitHub `production` environment secrets for deploy credentials.
3. Keep the repo variable `SCANNER_BASE_URL` set to the Fly scanner URL.
4. Apply Terraform and capture the outputs, especially the real `d1_database_id`.
5. Set Fly scanner runtime secrets, including the scanner's `CF_API_TOKEN` and the Terraform-produced `D1_DATABASE_ID`.
6. Update `packages/worker/wrangler.toml` production `database_id` with the real Terraform output.
7. Set Worker runtime secrets with Wrangler.
8. Deploy the scanner.
9. Apply the Worker D1 schema.
10. Deploy the Worker.
11. Run bounded scrapes, then full scrapes.
12. Register upstream webhooks last.

### GitHub Actions production environment secrets

Use the `production` GitHub Environment for deploy-time credentials only.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `FLY_API_TOKEN`
- `SCANNER_AUTH_TOKEN` only if you want `.github/workflows/full-scrape.yml` to call the scanner directly

Exact commands for this repo:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo CoChatAI/SkillSheild --env production
gh secret set CLOUDFLARE_ACCOUNT_ID --repo CoChatAI/SkillSheild --env production
gh secret set FLY_API_TOKEN --repo CoChatAI/SkillSheild --env production
gh secret set SCANNER_AUTH_TOKEN --repo CoChatAI/SkillSheild --env production
```

You will be prompted to paste each value unless you pass `--body`.

### GitHub repository variable

- `SCANNER_BASE_URL`

This is not a secret. It is the public Fly scanner URL used by the full-scrape workflow request builder.

Exact command for this repo:

```bash
gh variable set SCANNER_BASE_URL --repo CoChatAI/SkillSheild --body "https://skillshield-scanner.fly.dev"
```

### Cloudflare Worker secrets

Set these with Wrangler, not in the repo.

- `WEBHOOK_SECRET`
- `SCANNER_AUTH_TOKEN`

Exact commands:

```bash
cd packages/worker
npx pnpm@10.6.3 exec wrangler secret put WEBHOOK_SECRET --env production
npx pnpm@10.6.3 exec wrangler secret put SCANNER_AUTH_TOKEN --env production
```

### Fly scanner secrets

Set these with `flyctl secrets set`, not in the repo.

- `SCANNER_AUTH_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`
- `D1_DATABASE_ID`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- optional scanner-related keys such as `SKILL_SCANNER_LLM_API_KEY` and `VIRUSTOTAL_API_KEY`

Exact required command shape:

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

Optional additions:

```bash
flyctl secrets set \
  R2_SESSION_TOKEN="..." \
  R2_SKILLS_BUCKET="skillshield-skills" \
  R2_REPORTS_BUCKET="skillshield-reports" \
  SKILL_SCANNER_LLM_API_KEY="..." \
  SKILL_SCANNER_LLM_MODEL="claude-sonnet-4-20250514" \
  VIRUSTOTAL_API_KEY="..." \
  --app skillshield-scanner
```

## Workflow Safety Rules In This Repo

- Deploy workflows are `workflow_dispatch` only.
- Production jobs are attached to the `production` environment.
- Production jobs only run from the repository default branch.
- Validation jobs do not need deploy secrets.
- Full scrape execution is also default-branch-only.

## What Not To Do

- Do not commit `.env` files with real values.
- Do not store runtime secrets in `wrangler.toml`, Terraform files, or workflow YAML.
- Do not convert deploy workflows to `pull_request_target`.
- Do not let production deploy jobs run automatically on arbitrary branches.

## Suggested GitHub Environment Settings

For the `production` environment:

- add required reviewers
- keep deploy secrets environment-scoped instead of repo-scoped
- use manual `workflow_dispatch` for deploys and scrape execution

If you need the exact cutover order after the repo-side safety setup is in place, use `docs/production-cutover-runbook.md`.
