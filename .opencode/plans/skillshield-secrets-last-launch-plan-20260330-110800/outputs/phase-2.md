# Phase 2: Target Architecture and Secrets-Last Dependency Order

## Target runtime split

### Cloudflare Worker responsibilities
- Keep the Worker as the only public edge surface. That matches `packages/worker/src/index.ts`, which already serves `/`, `/health`, `/api/*`, `/api/v1/*`, `/clawhub/api/v1/*`, `/skills/*`, `/reports/*`, `/badge/*`, and `/webhooks/*`.
- Keep webhook ingestion in the Worker. `packages/worker/src/routes/webhooks.ts` already authenticates webhook requests, records `webhook_events` in D1, and enqueues scan jobs on `SCAN_QUEUE`.
- Add queue consumption to the Worker rather than moving ingestion elsewhere. The current repo only has `[[queues.producers]]` in `packages/worker/wrangler.toml`; the target architecture adds a Worker queue consumer path that reads `scan-jobs` messages and forwards each job to the scanner service.
- Keep public reads in the Worker. The dashboard, report routes, badge routes, and API routes should continue reading from Cloudflare-managed D1 and R2 so the public product stays on Cloudflare even though scanning runs elsewhere.

### Fly scanner responsibilities
- Keep `packages/scanner` as the private execution runtime for scan work. `packages/scanner/src/index.ts` already exposes `/health`, `/scan`, and `/scrape/:source`, and `packages/scanner/src/service.ts` already owns source fetch, scan orchestration, and full-source scrape logic.
- The scanner remains responsible for the heavy path: downloading upstream skill contents, running `skill-scanner`, building archives, uploading assets and reports, and publishing scan results. That is already encoded in `packages/scanner/src/service.ts`, `packages/scanner/src/publisher.ts`, and `packages/scanner/src/db.ts`.
- Fly.io becomes the host for this private Node service. The missing deployable pieces are operational assets around the existing service shape: a real Docker image, Fly app config, CI deploy flow, and a small auth contract for Worker-to-scanner calls.
- The scanner should not become a public edge service. The public hostname and webhook endpoints stay on the Worker; Fly is the execution backend behind that edge.

### Cloudflare-managed state and queue responsibilities
- D1 stays the system of record for public scan state, recent activity, webhook events, and dashboard/API reads. This is already implied by Worker reads in `packages/worker/src/index.ts` and scanner writes in `packages/scanner/src/db.ts`.
- R2 stays the public artifact store for mirrored skill archives and JSON reports. `packages/scanner/src/publisher.ts` already writes assets and reports there, and the Worker already serves public report and badge routes around those resources.
- Cloudflare Queues stays the decoupling layer between webhook ingestion and scanner execution. Today the queue exists only as a producer binding in `packages/worker/wrangler.toml`; the target state is: Worker webhook route -> `scan-jobs` -> Worker queue consumer -> Fly scanner `/scan`.
- DNS and public routing remain Cloudflare-owned. The Fly service is an internal deployment concern, not a replacement for the Cloudflare-hosted edge.

## Why the scanner stays outside Workers

- The scanner code is Node-process-oriented, not edge-runtime-oriented. It uses `@hono/node-server` in `packages/scanner/src/index.ts` and filesystem/process work such as temp directories, `rm`, `zip`, `tar`, and external command execution in `packages/scanner/src/service.ts` and `packages/scanner/src/publisher.ts`.
- The scan path depends on tooling that does not belong in a Worker runtime. `README.md` explicitly calls out that local verification depends on a working `skill-scanner` installation, and the scanner package shells out to archive tools and scanner tooling.
- The scanner also holds the mutable credentials for D1 API writes and R2 API uploads. Those env vars are read directly from process env in `packages/scanner/src/publisher.ts`, which is a much better fit for a private container runtime than for the public Worker edge.
- Fly changes the deployment story from "Wrangler-only" to a split deploy model: Wrangler deploys the edge Worker, while a container pipeline builds and deploys the scanner service separately. That means release automation must treat Worker deploys and scanner deploys as two independent artifacts that only meet through a narrow request contract.

## Secrets-last dependency model

### Work that can be completed before real secrets
- Finalize the target contract between the Worker queue consumer and scanner `/scan` route: request body shape, idempotency expectations, retry behavior, and auth header format.
- Add the missing Worker queue-consumer code path and `[[queues.consumers]]` config in `packages/worker` using placeholder values and local/test coverage.
- Replace `packages/scanner/Dockerfile` with a real production image build that installs dependencies, copies workspace code, builds the scanner, includes required runtime tools, and launches the actual server.
- Add Fly deployment configuration to the repo. There is currently no `fly.toml` or equivalent checked in, so that config should land before any secret wiring.
- Fill in Terraform structure for Cloudflare resources: providers, variables, outputs, D1, R2, queue, and DNS definitions. This work can be authored and reviewed with placeholder IDs/names drawn from `README.md` and `packages/worker/wrangler.toml`.
- Replace the placeholder GitHub Actions workflows with real pipelines for Worker deploy, scanner deploy, and full scrape orchestration, while still targeting non-production or dry-run-safe inputs until secrets are provided.
- Make documentation consistent with reality so the checked-in deploy flow reflects the split runtime and the pre-secret implementation order.

### Work that must wait for real credentials
- Supplying Cloudflare credentials and identifiers that the scanner already expects in env: `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `D1_DATABASE_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and any session token if used.
- Supplying Worker and automation secrets such as `WEBHOOK_SECRET`, Wrangler auth for deploy, registry auth if required by the chosen image push path, and Fly auth for deploy.
- Applying Terraform against the real Cloudflare account and confirming the created D1, R2, queue, and DNS resources match the checked-in config.
- Running `packages/worker/schema.sql` against the real D1 database.
- Deploying the Worker to the production route and deploying the scanner to Fly with real env vars.
- Wiring the real Worker-to-scanner secret, enabling real webhook authentication, registering live ClawHub and GitHub webhooks, and running the first production full scrapes.

## Required rollout order

1. Land code and config changes that do not require live credentials: queue consumer, scanner auth contract, production Dockerfile, Fly config, Terraform definitions, and real CI workflow definitions.
2. Verify those assets locally or in secret-free validation modes: build, typecheck, test, container build, Terraform validation/formatting, and workflow linting where available.
3. Introduce real credentials only after the repo is otherwise deploy-ready.
4. Apply Cloudflare infrastructure with real credentials and initialize the D1 schema.
5. Deploy the Worker and scanner with their real runtime secrets.
6. Register live webhooks, run initial full scrapes, and perform production verification.

## Final secret-wiring step

- The final distinct cutover step is not writing code. It is injecting the real Cloudflare, Fly, scanner, and webhook secrets into the already-finished deploy assets, then performing the first live infrastructure apply and production deploy.
- Everything before that step should be reviewable, testable, and mergeable without needing production credentials.
