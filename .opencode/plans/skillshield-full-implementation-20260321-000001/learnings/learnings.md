# Learnings: skillshield-full-implementation-20260321-000001

## Phase 1 Learnings

- A simple pnpm workspace with `turbo`, per-package `tsconfig.json`, and source-first exports in `@skillshield/shared` was enough to get cross-package typechecking working without waiting for shared build artifacts.
- The local environment's plain `pnpm install` path failed because Corepack could not verify the pnpm signing key. Using `npx pnpm@10.6.3 ...` worked reliably for install, build, test, and typecheck, so future phases should use that same invocation unless Corepack is repaired.
- Keeping the Worker routes scaffolded but empty let the planned Hono router shape compile now without forcing route logic too early. The health route is already wired through the real app entrypoint and covered by a Vitest request test.
- Matching the D1 schema early in `packages/worker/schema.sql` reduced drift risk for later Worker and publisher phases. The shared Zod schemas now cover the health payload plus core skill and scan domain objects that later phases can extend instead of replacing.
- Build/test gotcha: package `tsconfig.json` files cannot include `test/**/*.ts` while `rootDir` is `src`, or `tsc` will fail during package builds. Restricting build configs to `src` kept the workspace builds clean while Vitest still picked up test files normally.

## Phase 2 Learnings

- Injecting `fetch`, `sleep`, and `extractZip` into the ClawHub adapter kept the production path simple while making pagination and archive handling fully testable without live ClawHub traffic or shelling out to `unzip` in Vitest.
- Node 22's web-stream types did not line up cleanly with `Readable.fromWeb` under this repo's TypeScript settings. A narrow cast at the stream boundary fixed build/typecheck while keeping the rest of the download path typed and straightforward.
- ClawHub list parsing benefits from explicit shape checks up front. Failing fast on missing `slug`, `name`, or `skills[]` will make later scrape/debug work much easier than letting malformed remote payloads leak deeper into the pipeline.
- Sanitizing slugs before turning them into archive filenames avoids accidental nested temp paths for owner-prefixed slugs like `team/trello` while still preserving the real slug in request URLs.
## Phase 3 Learnings

- Wrapping `skill-scanner` behind injected `execFile`, temp-dir, and file-read dependencies made the real production command path straightforward while keeping command construction, JSON normalization, and fail-closed fallbacks fully unit-testable without the Cisco CLI installed locally.
- The local machine does not have the `skill-scanner` binary on `PATH` (`which skill-scanner` returned not found), so phase verification had to rely on mocked unit coverage instead of a live smoke scan. Future phases that want end-to-end scans need the Docker image or local Python install from `cisco-ai-skill-scanner` first.
- Normalizing scanner output into shared camelCase types early avoids leaking CLI snake_case fields into the rest of the app. It also gives later publisher and API work a stable `findingsCount`, `maxSeverity`, `scannerVersion`, `analyzersUsed`, and `policy` shape to persist directly.
- Fail-closed behavior is easiest to preserve when every scanner failure path returns the same synthetic `scanner_error` finding with `high` severity. That keeps downstream verdict logic simple: any process crash, timeout, parse error, or missing binary automatically becomes `blocked` instead of accidentally passing through as unknown.

## Phase 4 Learnings

- Keeping publisher concerns split into report/key builders, archive creation, object storage, and D1 statement construction made the R2 + D1 path easy to test locally without Cloudflare credentials. The public `publishResults` flow now only coordinates those pieces.
- Using `aws4fetch` for the default R2 client kept the implementation lightweight while still giving the scanner service a real SigV4-capable upload path for Cloudflare's S3-compatible endpoint. Mocked storage/database dependencies meant unit tests never needed live buckets or tokens.
- The safest persistence shape for this phase was to upsert both `skills` and `scan_runs` every publish. That keeps the Worker-facing skill record current while also preserving per-version scan history for later API/report work.
- Blocked and pending verdicts should still publish a report but must never publish a downloadable asset. Encoding that once in `shouldPublishAssets()` kept both upload behavior and D1 `r2_key` assignment consistent.
- Verification stayed fully local: `npx pnpm@10.6.3 --filter @skillshield/scanner test`, `npx pnpm@10.6.3 --filter @skillshield/scanner typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/scanner build` all passed after adding the new publisher and D1 code.

## Phase 5 Learnings

- Keeping the ClawHub Worker path thin by moving SQL and metadata parsing into `packages/worker/src/lib/d1.ts` made the route handlers much easier to read and gave the tests a narrow set of D1 query shapes to mock.
- The compatibility path needs two different missing/blocked behaviors: metadata endpoints return a minimal `{ error: 'not_found' }` for truly missing skills, while download returns the more descriptive `not_found` payload with the report URL so the CLI gets a stable install-time error surface.
- Supporting `/skills/:slug/:version` locally was straightforward once Phase 4's `scan_runs` upsert shape was in place. Joining `scan_runs` back to `skills` gives enough information to distinguish a real historical version from a missing one without introducing extra tables.
- The most useful verification for this phase was full route-level request tests with mocked `D1Database` and `R2Bucket` bindings. That exercised Hono router wiring, response JSON, headers, asset lookup, blocked behavior, and versioned downloads without needing a live Worker runtime.
- Verification passed locally with `npx pnpm@10.6.3 --filter @skillshield/worker test`, `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/worker build`.

## Phase 6 Learnings

- Pulling the scan-job flow and full-scrape loop into `packages/scanner/src/service.ts` made the Hono routes thin and gave Phase 6 a clean place to unit test orchestration without needing a live ClawHub registry, scanner binary, or Cloudflare credentials.
- The fetched skill directories need explicit cleanup after both single-job scans and full scrapes. Without a `finally` cleanup step, a real ClawHub backfill would leak temp directories quickly because every adapter fetch creates a new extracted archive directory.
- Adding `wait=true` plus small query overrides like `limit`, `delayMs`, and `useLlm` made the full scrape route practical for local smoke checks while preserving the default fire-and-forget behavior that cron or manual remote triggers want.
- Live end-to-end scraping is still blocked locally by the missing `skill-scanner` binary and real registry/storage credentials, so the safest verification path in this environment is mocked route/orchestration coverage plus documenting the exact trigger command for a deployed scanner.

## Phase 7 Learnings

- Hono route params do not preserve a clean param name when the route segment is declared as `:slug.json` or `:skill.svg`; the param becomes `slug.json` or `skill.svg`. Matching the whole segment as `:slug` or `:skill` and stripping the suffix inside the handler kept the public `.json` and `.svg` URLs working without fighting the router.
- Small helpers in `packages/worker/src/lib/public.ts` kept report storage keys and public URLs aligned across `/reports`, `/badge`, and `/api/v1/verify`, which mattered most for `skills-sh` slugs that already contain `/` characters.
- The unified API search route was easiest to stabilize by parsing `metadata` into an object and returning a consistent SkillShield record shape rather than leaking raw D1 rows directly.
- Route-level Worker tests with mocked `D1Database.batch`, `prepare().all()`, `prepare().first()`, and `R2Bucket.get()` gave enough coverage to validate reports, badges, search, verify, stats, and recent responses locally without live Cloudflare resources.
- Verification passed locally with `npx pnpm@10.6.3 --filter @skillshield/worker test`, `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/worker build`.
## Phase 8 Learnings

- Parsing the raw request body first and then `JSON.parse`-ing it was the simplest way to both reject malformed webhook JSON cleanly and persist the exact payload into `webhook_events` without re-serializing a transformed object.
- ClawHub webhook slug parsing needed to preserve multi-segment paths like `owner/skill`, not just the last URL segment. Joining the path segments from the embed URL keeps webhook-triggered scan jobs aligned with the ClawHub adapter's slash-containing slugs.
- Optional shared-secret auth was practical to add locally by accepting either `Authorization: Bearer <secret>` or `X-Webhook-Secret`. The route stays open in local/test environments with no secret configured, while production can lock it down with `WEBHOOK_SECRET` immediately.
- Route-level Worker tests were enough to verify the full ingestion path: auth, malformed JSON rejection, invalid embed rejection, D1 event persistence, and queue message shape all passed without needing live Cloudflare bindings.
- Verification passed locally with `npx pnpm@10.6.3 --filter @skillshield/worker test`, `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/worker build`.

## Phase 9 Learnings

- skills.sh discovery stayed most debuggable when the adapter scraped a short explicit page list (`/`, `/trending`, `/hot`) and parsed only three-segment relative links. That avoided pulling in a real HTML parser while still filtering out nav links, download links, and duplicate skill cards reliably.
- Injecting `cloneRepository` made fetch-path tests easy to drive with temporary fixture repos, and it gives later phases a clean seam if GitHub auth or alternate clone behavior is needed without rewriting the adapter.
- Locating `SKILL.md` needed an explicit preference order: `./<skill>`, `./skills/<skill>`, repo root, then a bounded recursive search. Real repos can contain multiple skills, so preferring directories whose path includes the requested skill name prevents the adapter from grabbing the wrong `SKILL.md` when several exist.
- TypeScript narrowed the slug parser less aggressively than expected after checking `parts.length === 3`; casting the split result to a three-item tuple after validation was required to satisfy `build` and `typecheck` even though Vitest already passed.
- Verification passed locally with `npx pnpm@10.6.3 --filter @skillshield/scanner test`, `npx pnpm@10.6.3 --filter @skillshield/scanner typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/scanner build`.

## Phase 10 Learnings

- Phase 6's generic `runFullSourceScrape()` path already handled `skills-sh` once the adapter existed, so the missing Phase 10 work was mostly around making that path explicit and verifiable rather than adding a second orchestration branch.
- A dedicated `packages/scanner/scripts/full-scrape-skills.ts` smoke helper was worth adding even though `/scrape/:source` is generic. It gives deployment-time operators a concrete command for the daily skills.sh scrape and keeps the cron/manual trigger flow symmetric with ClawHub.
- The most useful local verification was route-level coverage against `POST /scrape/skills-sh?wait=true...` with mocked adapter, scanner, and publisher dependencies. That exercised enumeration, scan-option overrides, publish metadata, and the final scrape summary without needing live skills.sh HTML, GitHub clones, the Cisco scanner binary, or Cloudflare credentials.
- Live full scraping is still not appropriate in this environment because it would require real network access plus the missing `skill-scanner` binary and Cloudflare publish credentials. The safe follow-up is to run `npx pnpm@10.6.3 --filter @skillshield/scanner smoke:skills-sh-scrape -- --wait=true --use-llm=false --limit=10 --delay-ms=0` against a deployed scanner after those dependencies are configured.

## Phase 11 Learnings

- The Worker-side GitHub webhook became much more actionable once it looked up all indexed `skills-sh` slugs for a repository and queued one scan per slug, instead of emitting a repo-only job shape that the scanner could not execute directly.
- Storing `metadata.repo` during `skills-sh` publishes is worth doing even with a `slug LIKE owner/repo/%` fallback, because it gives the webhook route a stable repo lookup key after future slug format changes or renamed skill directories.
- GitHub webhook auth needs raw-body handling before JSON parsing so the `X-Hub-Signature-256` HMAC can be verified against the exact payload GitHub signed. Keeping the route open only when `WEBHOOK_SECRET` is unset preserved easy local testing while still matching production webhook behavior.
- The most useful route-level coverage for this phase was a mix of supported GitHub events (`push`, `release`), skip cases (`irrelevant_event`, `repo_not_indexed`), and malformed payloads (`invalid_json`, missing repo). That exercised persistence, D1 repo lookup, queue fan-out, and signature verification without needing live GitHub delivery.
- Local verification passed with `npx pnpm@10.6.3 --filter @skillshield/worker test`, `npx pnpm@10.6.3 --filter @skillshield/worker typecheck`, `npx pnpm@10.6.3 --filter @skillshield/worker build`, `npx pnpm@10.6.3 --filter @skillshield/scanner test`, `npx pnpm@10.6.3 --filter @skillshield/scanner typecheck`, and `npx pnpm@10.6.3 --filter @skillshield/scanner build`.

## Phase 12 Learnings

- The cleanest way to add the public dashboard without inventing another deployment target was to make `packages/dashboard` a small HTML renderer package and have the Worker serve it at `/`. That keeps the public URL in the main product surface while still giving the dashboard package an isolated build and test target.
- The new workspace package dependency from `@skillshield/worker` to `@skillshield/dashboard` needed a fresh `npx pnpm@10.6.3 install` before Turbo's Worker build could resolve the package. Source-first workspace exports matched the existing `@skillshield/shared` pattern and avoided needing a separate publish step.
- Inline HTML template strings for the dashboard are easy to iterate on, but stray backticks inside the template break TypeScript parsing immediately. Using `<code>` tags instead of markdown-style backticks in the rendered copy kept the page readable and the build stable.
- The most useful final verification was the full workspace `build`, `typecheck`, and `test` run rather than package-by-package spot checks. That caught the new package-resolution issue quickly and confirmed the root dashboard route, renderer package, scanner, shared schemas, and Worker APIs all still passed together after the polish work.
