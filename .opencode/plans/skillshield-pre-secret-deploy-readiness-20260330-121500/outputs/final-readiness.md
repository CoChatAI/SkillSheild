# Final Readiness

## Complete

- Shared scan-job schema is standardized and used across the Worker and scanner.
- The Worker now includes the queue consumer path and production-shaped Wrangler config.
- The scanner enforces auth on mutation routes when a token is configured.
- The scanner container and checked-in Fly config are production-shaped and secret-free.
- GitHub Actions workflows are real operator/deploy workflows instead of placeholders.
- Terraform now defines the required Cloudflare D1, R2, queue, DNS, variables, and outputs.

## Validation Summary

- Repo tests/build/typecheck:
  - `./node_modules/.bin/turbo run test`, `build`, and `typecheck` were attempted first and all failed before package execution because this machine's Corepack install cannot verify the pnpm signing key (`Cannot find matching keyid`).
  - Closest honest equivalent completed successfully with local binaries:
    - `./node_modules/.bin/tsc -p packages/shared/tsconfig.json && ./node_modules/.bin/tsc -p packages/dashboard/tsconfig.json && ./node_modules/.bin/tsc -p packages/scanner/tsconfig.json && ./node_modules/.bin/tsc -p packages/worker/tsconfig.json`
    - `./node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit && ./node_modules/.bin/tsc -p packages/dashboard/tsconfig.json --noEmit && ./node_modules/.bin/tsc -p packages/scanner/tsconfig.json --noEmit && ./node_modules/.bin/tsc -p packages/worker/tsconfig.json --noEmit`
    - `./node_modules/.bin/vitest run packages/shared/test/schemas.test.ts packages/dashboard/test/index.test.ts packages/scanner/test/*.test.ts packages/worker/test/*.test.ts`
  - Result: passed via equivalent direct package validation.
- Docker build:
  - `docker build -f packages/scanner/Dockerfile -t skillshield-scanner-phase7 .`
  - Result: passed.
- Terraform validate:
  - `terraform init -backend=false && terraform validate` from `infrastructure/terraform`
  - Result: passed.
- Fly config validation:
  - `flyctl config validate -c packages/scanner/fly.toml`
  - Result: blocked in this environment by missing Fly authentication: `no access token available. Please login with 'flyctl auth login'`.
  - Closest honest equivalent already present in the checked-in workflow: the scanner deploy workflow validates the checked-in config shape pre-secret and runs `flyctl config validate` when `FLY_API_TOKEN` is available.
- Workflow validation:
  - `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/deploy-worker.yml .github/workflows/deploy-scanner.yml .github/workflows/full-scrape.yml`
  - Result: passed.

## Remaining Before Go-Live

- Apply real secrets and account-specific IDs.
- Deploy the Worker and scanner.
- Apply the D1 schema.
- Run bounded and full scrapes.
- Register upstream webhooks.
