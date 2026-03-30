# Phase 5 Output

- Replaced `.github/workflows/deploy-worker.yml` with a real manual workflow that installs the workspace, builds/tests/typechecks the Worker path, runs `wrangler deploy --dry-run` against `packages/worker/wrangler.toml`, and only performs a real deploy when the `deploy` input is enabled and Cloudflare credentials are present.
- Replaced `.github/workflows/deploy-scanner.yml` with a real manual workflow that installs the workspace, builds/tests/typechecks the scanner path, builds the production scanner image from `packages/scanner/Dockerfile`, validates the checked-in Fly config shape, and performs `flyctl config validate` plus `flyctl deploy` only when Fly credentials are available and deploy is explicitly requested.
- Replaced `.github/workflows/full-scrape.yml` with a real operator workflow that builds the request for the existing scanner `POST /scrape/:source` route using `source`, `wait`, `limit`, `delayMs`, and `useLlm`, then gates the live `curl` execution on an explicit `execute` input plus a configured scanner base URL.

## Verification

- `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/deploy-worker.yml .github/workflows/deploy-scanner.yml .github/workflows/full-scrape.yml`
- `./node_modules/.bin/tsc -p packages/worker/tsconfig.json --noEmit`
- `./node_modules/.bin/tsc -p packages/scanner/tsconfig.json --noEmit`
- `rg -n "placeholder|exit 0" .github/workflows` returned no matches
