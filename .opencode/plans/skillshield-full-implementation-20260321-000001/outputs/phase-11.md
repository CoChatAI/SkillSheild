# Phase 11 Output

- Implemented `POST /webhooks/github` in `packages/worker/src/routes/webhooks.ts` and kept it wired through `packages/worker/src/index.ts`, so the Worker now accepts GitHub `push` and `release` webhook events for `skills-sh` repositories.
- The GitHub webhook path now verifies `X-Hub-Signature-256` when `WEBHOOK_SECRET` is configured, persists supported webhook payloads to `webhook_events`, looks up indexed `skills-sh` slugs for the repository, and queues one scan job per known skill with a normalized branch or tag version.
- Added `listSkillsShSlugsForRepository()` in `packages/worker/src/lib/d1.ts` so the webhook route can fan out repo-level events into concrete skill scan jobs using indexed D1 records.
- Updated `packages/scanner/src/service.ts` so `skills-sh` publishes store `metadata.repo`, which gives the webhook fan-out path a stable repository key after the initial scrape has populated D1.
- Expanded `packages/worker/test/webhooks.test.ts` to cover GitHub `push` and `release` events, skipped event handling, repo-not-indexed skips, malformed payload rejection, and queue payload shape. Updated `packages/scanner/test/service.test.ts` to cover the new `metadata.repo` publish behavior.
- Local verification passed:
  - `npx pnpm@10.6.3 --filter @skillshield/worker test`
  - `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`
  - `npx pnpm@10.6.3 --filter @skillshield/worker build`
  - `npx pnpm@10.6.3 --filter @skillshield/scanner test`
  - `npx pnpm@10.6.3 --filter @skillshield/scanner typecheck`
  - `npx pnpm@10.6.3 --filter @skillshield/scanner build`
- Production follow-up: register GitHub repository or GitHub App webhooks against `https://skillshield.cochat.ai/webhooks/github`, subscribe to `push` and `release`, and configure the webhook secret to match the Worker `WEBHOOK_SECRET`. Repo fan-out only queues scans for repositories already indexed in D1, so run the full `skills-sh` scrape first or backfill the repo metadata before relying on webhook-only updates.
