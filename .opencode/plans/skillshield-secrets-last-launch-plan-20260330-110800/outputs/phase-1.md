# Phase 1 Inventory: Current Operational Gaps

## Current repo state

### Deploy automation
- `.github/workflows/deploy-worker.yml` exists but is a placeholder only: manual trigger, one `placeholder` job, and `exit 0` with no checkout, build, test, Wrangler auth, or deploy steps.
- `.github/workflows/deploy-scanner.yml` exists but is a placeholder only: manual trigger, one `placeholder` job, and `exit 0` with no image build, registry push, Fly deploy, or health verification.
- `.github/workflows/full-scrape.yml` exists but is a placeholder only: manual trigger, one `placeholder` job, and `exit 0` with no scanner invocation, source parameters, or post-run verification.
- There is no release automation in the checked-in workflows for Worker deploys, scanner deploys, or operational scrape runs.

### Terraform and infrastructure
- `infrastructure/terraform/main.tf` only pins Terraform version `>= 1.7.0`; it does not declare providers, backend config, variables, locals, or outputs.
- `infrastructure/terraform/d1.tf` is a one-line stub: `# D1 resources land in a later phase.`
- `infrastructure/terraform/r2.tf` is a one-line stub: `# R2 resources land in a later phase.`
- `infrastructure/terraform/dns.tf` is a one-line stub: `# DNS resources land in a later phase.`
- No Terraform file in `infrastructure/terraform/` currently manages the Cloudflare queue named by the Worker config.
- No checked-in Terraform currently covers the Cloudflare resources described in `README.md`: D1, R2, queue, or DNS.

### Worker runtime and queue handling
- `packages/worker/wrangler.toml` defines the Worker name, compatibility date, one `ENVIRONMENT` var, three R2 bucket bindings, one D1 binding, one queue producer binding (`SCAN_QUEUE` -> `scan-jobs`), and a production route (`skillshield.cochat.ai/*`).
- `packages/worker/src/types.ts` declares `SCAN_QUEUE: Queue`, which matches producer usage but does not imply any consumer path.
- `packages/worker/src/routes/webhooks.ts` persists webhook events to D1 and enqueues scan jobs via `c.env.SCAN_QUEUE.send(...)` for both `/webhooks/clawhub` and `/webhooks/github`.
- `packages/worker/src/index.ts` exports only the Hono fetch app. There is no Worker `queue(batch, env, ctx)` handler and no other queue-consumer implementation under `packages/worker`.
- There is also no `[[queues.consumers]]` config in `packages/worker/wrangler.toml`, so the repo currently wires job production only, not consumption.

### Scanner container and deployment readiness
- `packages/scanner/src/index.ts` exposes a Node/Hono service with `/health`, `/scan`, and `/scrape/:source` routes and starts on port `3100` outside tests.
- `packages/scanner/Dockerfile` is scaffold-only. It copies root and package manifests, enables Corepack, and ends with `CMD ["node", "-e", "console.log('scanner image scaffold')"]`.
- The Dockerfile does not install workspace dependencies, copy source code, build packages, install the `skill-scanner` binary, expose a port, or start the actual scanner server.
- The repo therefore has scanner application code, but not a deployable production container image definition.

### Secrets and release sequencing context already present
- `README.md` documents the intended architecture clearly: Cloudflare Worker as public edge, scanner service for heavy work, Cloudflare D1/R2/queue bindings, and webhook-triggered scans.
- `README.md` also lists the scanner env vars needed for real deployment, but the deployment assets that would consume them are not implemented yet.
- The documented deploy flow assumes infrastructure creation, Worker deployment, scanner container deployment, full scrapes, and webhook registration, but the checked-in repo still lacks the concrete IaC and automation needed to execute that flow.

## Release blockers captured from the current repo
- Deploy automation blocker: all three GitHub Actions workflows are non-functional placeholders.
- Infrastructure blocker: Terraform is mostly empty and does not manage D1, R2, DNS, or the queue.
- Scanner container blocker: the Dockerfile does not build or run the real scanner service.
- Queue consumption blocker: webhook routes enqueue jobs, but no queue consumer path exists in Worker config or code.

## Supporting context that reduces ambiguity for later phases
- The Worker public surface and webhook ingestion routes are already implemented enough to anchor later rollout planning.
- The scanner service API surface already exists, so later phases can design deployment and auth around a real service entrypoint instead of a blank package.
- `README.md` and `wrangler.toml` already name the core resources (`skillshield-db`, `skillshield-skills`, `skillshield-reports`, `skillshield-meta`, `scan-jobs`, `skillshield.cochat.ai`), which gives later phases concrete targets to plan against.
