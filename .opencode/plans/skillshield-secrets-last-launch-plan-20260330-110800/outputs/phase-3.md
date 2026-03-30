# Phase 3: Pre-Secret Code and Runtime Implementation Plan

## Current seam to close

- `packages/worker/src/routes/webhooks.ts` already persists webhook events and enqueues scan jobs on `c.env.SCAN_QUEUE.send(...)`.
- `packages/worker/wrangler.toml` only declares `[[queues.producers]]`, so the repo has no consumer wiring yet.
- `packages/scanner/src/index.ts` already exposes `POST /scan`, but it currently accepts arbitrary JSON, has no auth check, and is not shaped around a Worker-to-scanner contract.
- `packages/scanner/Dockerfile` is still a scaffold and does not build or run the actual service.

## Pre-secret implementation goal

- Finish the code and runtime assets so the only remaining production step is supplying real secrets and deploying them.
- Keep the runtime split defined in Phase 2: webhook ingestion and queue consumption stay in the Worker, while the scanner remains the private Fly-hosted executor.

## Queue consumer design

### Target flow
- `POST /webhooks/clawhub` or `POST /webhooks/github` in `packages/worker/src/routes/webhooks.ts` writes `webhook_events` and enqueues one or more normalized scan jobs.
- A new Worker `queue(batch, env, ctx)` handler reads `scan-jobs` messages.
- The queue handler forwards each message to the scanner service over HTTP `POST /scan`.
- The scanner executes `executeScanJob(...)`, writes results to D1 and R2 through its existing publisher path, and returns a structured response.
- The Worker acks the message only after a successful scanner response. Non-2xx or network failures leave the message retriable through Cloudflare Queue retry behavior.

### Worker code shape
- Extend the Worker entrypoint in `packages/worker/src/index.ts` from a fetch-only default export to an object with both `fetch` and `queue` handlers.
- Add a queue handler file near the Worker runtime, for example `packages/worker/src/queue.ts`, to keep the forwarding logic separate from HTTP routes without creating a new package.
- Update `packages/worker/wrangler.toml` with `[[queues.consumers]]` for `scan-jobs`; keep the producer binding because webhook routes still enqueue.
- Extend `packages/worker/src/types.ts` with the scanner-forwarding env needed by the queue consumer:
  - `SCANNER_BASE_URL`
  - `SCANNER_SHARED_TOKEN`
  - optional `SCANNER_REQUEST_TIMEOUT_MS`

### Delivery and retry behavior
- Treat the queue as the boundary for retries. The Worker queue consumer should not implement its own retry loop around `fetch`; it should throw or fail the message when the scanner is unavailable or returns a 5xx.
- Treat 4xx scanner responses as contract failures. Those should be logged with the message body and allowed to fail visibly during pre-secret validation because they mean the Worker and scanner schema drifted.
- Use the existing `event_id` field already written into queued jobs as the cross-system correlation ID in Worker logs and scanner logs.
- Keep fan-out in the webhook route for GitHub repository events exactly where it is today. Each slug-specific message should stay independent so queue retries stay granular.

## Shared queue message contract

### Where it should live
- Put the contract in `packages/shared`, because both the Worker and scanner already depend on that workspace package and it is already the home for Zod schemas plus shared types.
- Add the schema to `packages/shared/src/schemas.ts` and export it from `packages/shared/src/index.ts`.
- Add the inferred TypeScript type to `packages/shared/src/types.ts`.

### Recommended message shape
- Create a `scanQueueMessageSchema` that validates the payload already being sent from `packages/worker/src/routes/webhooks.ts`.
- Keep the initial contract minimal and aligned with current messages rather than inventing a richer job envelope too early.

Suggested fields:
- `type`: literal `'scan'`
- `source`: existing `sourceSchema`
- `slug`: optional string
- `repo`: optional string
- `version`: optional string
- `owner`: optional string
- `triggered_by`: enum of current producers such as `'webhook' | 'github_webhook'`
- `event_id`: string

### Validation rules
- Keep the existing scanner rule that at least one of `slug` or `repo` must be present, but move that rule into the shared Zod schema so both runtimes reject bad jobs the same way.
- Allow both `slug` and `repo` for `skills-sh` jobs because the current webhook route already sends both, and the repo value is useful operational context.
- Normalize this schema once at enqueue time and validate it again at dequeue time before the Worker forwards the request.
- Reuse the same schema, or a schema derived from it, for the scanner `POST /scan` request body. That avoids the Worker and scanner drifting into two similar but different contracts.

### Implementation notes grounded in current code
- The current inline objects in `packages/worker/src/routes/webhooks.ts` should be replaced with `scanQueueMessageSchema.parse(...)` so tests prove the producer emits the shared contract.
- `packages/worker/test/webhooks.test.ts` already asserts the exact payload shape, so it can be updated to import the shared type instead of maintaining a parallel local `QueuedScanJob` type.
- `packages/scanner/src/service.ts` already defines `ScanJobRequest`; that type should be replaced or aliased to the shared contract instead of remaining a scanner-only duplicate.

## Scanner authentication shape

### Current gap
- `packages/scanner/src/index.ts` accepts unauthenticated `POST /scan` and `POST /scrape/:source` requests.
- That is fine for local development, but it is the main missing runtime seam before a Fly deployment can be treated as private-by-contract.

### Recommended auth contract
- Add one shared bearer token for machine-to-machine calls: `Authorization: Bearer <SCANNER_SHARED_TOKEN>`.
- The Worker queue consumer sends this header on every `POST /scan` request.
- The scanner checks this header before processing `POST /scan` and `POST /scrape/:source`.
- Keep `GET /health` unauthenticated so Fly health checks and local smoke checks stay simple.

### Secret-less implementation approach
- Implement the auth code now with a placeholder token in local `.env` or test env; do not wait for production secrets.
- Use the same “optional when unset” pattern already present in the Worker webhook auth (`hasWebhookSecret`) so local development remains easy:
  - if `SCANNER_SHARED_TOKEN` is unset, scanner auth is bypassed
  - if it is set, bearer auth is required
- This lets tests and local Docker runs cover both authenticated and unauthenticated modes before any real production token exists.

### Scanner route hardening
- Parse `POST /scan` with the shared Zod schema before calling `executeScanJob(...)`.
- Return `401` for missing or invalid bearer tokens.
- Return `400` for schema failures instead of relying on `executeScanJob(...)` to reject malformed JSON later.
- Preserve the current `500` path for real execution failures so queue retries still happen for transient runtime problems.

### Tests to add before secrets
- Worker queue-consumer tests: valid job forwards to scanner, bad job is rejected before fetch, 5xx from scanner causes retry/failure behavior.
- Scanner route tests: `/scan` rejects missing token when configured, accepts valid token, rejects invalid body, and keeps `/health` public.
- Shared schema tests in `packages/shared/test/schemas.test.ts` for valid ClawHub and skills.sh queue messages plus the `slug`/`repo` requirement.

## Production Docker image requirements

### What the current code requires at runtime
- Node 22 is already the base in `packages/scanner/Dockerfile` and matches the repo.
- The scanner service runs a Node server from `packages/scanner/src/index.ts` on port `3100`.
- The scanner shells out to external tools:
  - `skill-scanner` in `packages/scanner/src/scanner.ts`
  - `unzip` in `packages/scanner/src/adapters/clawhub.ts`
  - `zip` and `tar` in `packages/scanner/src/publisher.ts`
- The image therefore must include those binaries, not just Node dependencies.

### Required Dockerfile outcome
- Replace the scaffold Dockerfile with a real multi-stage build.
- Builder stage:
  - use `node:22-slim`
  - enable Corepack or use the repo-pinned `pnpm@10.6.3`
  - copy workspace manifests and package sources
  - install workspace dependencies
  - run scanner build plus any required shared-package build
- Runtime stage:
  - install OS packages needed by the current code paths: `unzip`, `zip`, `tar`, and any package needed to install or run `skill-scanner`
  - copy built scanner and shared outputs plus production node modules
  - install or otherwise make `skill-scanner` available on `PATH`
  - expose port `3100`
  - run the real server entrypoint rather than a placeholder `node -e ...`

### Health check and runtime conventions
- Add a container `HEALTHCHECK` that probes `http://127.0.0.1:3100/health`.
- Make the server honor `PORT` if Fly injects it; if the code keeps hard-coding `3100`, the Fly config must map to that exact port. The cleaner pre-secret change is to make the server default to `3100` but read `process.env.PORT` first.
- Keep temp-file behavior inside the container as-is; the current scanner already creates and removes temp dirs per job.

### Local verification before secrets
- `docker build -f packages/scanner/Dockerfile .` must succeed without production credentials.
- `docker run -p 3100:3100 ...` with a placeholder `SCANNER_SHARED_TOKEN` should return `200` from `/health`.
- A local `POST /scan` with mocked or intentionally incomplete cloud env should still exercise auth and request validation even if publish steps fail later.
- Repo-level verification should still include `npx pnpm@10.6.3 build`, `npx pnpm@10.6.3 typecheck`, and targeted tests for `@skillshield/shared`, `@skillshield/worker`, and `@skillshield/scanner`.

## Implementation sequence before secrets

1. Add the shared scan-job schema and type in `packages/shared`, then update shared tests.
2. Update `packages/worker/src/routes/webhooks.ts` and `packages/worker/test/webhooks.test.ts` to produce the shared contract rather than inline ad hoc objects.
3. Add the Worker queue consumer and extend the Worker default export plus `wrangler.toml` consumer config.
4. Add scanner auth middleware and request-body validation in `packages/scanner/src/index.ts`.
5. Replace scanner-local duplicate job typing in `packages/scanner/src/service.ts` with the shared contract.
6. Add queue-consumer tests and scanner auth/request-validation tests.
7. Replace `packages/scanner/Dockerfile` with the production image definition and verify the image locally.
8. Only after those steps are merged should later phases wire Fly config, CI deploy steps, and finally real secrets.

## Expected pre-secret deliverable state

- The repo contains one shared scan-job schema used by the Worker producer, Worker consumer, and scanner `/scan` route.
- The Worker can both enqueue and consume `scan-jobs` messages.
- The scanner enforces a bearer-token auth contract when configured, while remaining locally testable without production credentials.
- The scanner container is buildable, starts the real service, includes required archive/scanner tooling, and exposes a health endpoint suitable for Fly.
