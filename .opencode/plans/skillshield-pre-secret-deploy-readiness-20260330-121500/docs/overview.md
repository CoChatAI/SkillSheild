# Plan: skillshield-pre-secret-deploy-readiness-20260330-121500

## Goal
Implement every remaining pre-secret deployment blocker in the SkillShield repo so that, after this RALPH loop completes, the only work left before go-live is applying real secrets/account-specific IDs, deploying the Worker and scanner, applying the D1 schema, running bounded/full scrapes, and registering upstream webhooks.

## Context
- The repo already has the product surface implemented: public Worker routes, scanner routes, dashboard, shared package, and test coverage.
- The user explicitly wants no incomplete pre-secret release work left behind. If any item from the requested list is still undone at the end, the loop is incomplete.
- Required implementation scope for this loop:
  - Implement the missing queue consumer in `packages/worker`
  - Standardize the scan job schema in `packages/shared`
  - Add scanner auth for `POST /scan` and `POST /scrape/:source`
  - Replace `packages/scanner/Dockerfile` with a real production image
  - Add checked-in Fly config for the scanner
  - Replace placeholder workflows in `.github/workflows/`
  - Replace Terraform stubs and add missing queue/variables/outputs files
  - Update `packages/worker/wrangler.toml` for queue consumer config and prod env shape
  - Run the full pre-secret validation pass and fix issues until it passes
- The scanner deployment target is Fly.io; the public edge and state remain on Cloudflare.
- This loop should leave only secrets and live cutover tasks undone.

## Phases Overview
1. Standardize the shared scan-job contract and update webhook producers/tests.
2. Implement the Worker queue consumer and Wrangler queue-consumer/runtime config.
3. Add scanner auth and request validation for `/scan` and `/scrape/:source`.
4. Productionize the scanner container and add Fly configuration.
5. Replace placeholder GitHub Actions workflows with real pre-secret deploy/operator workflows.
6. Replace Terraform stubs, add missing Terraform files, and finish production-shaped infra config.
7. Run the full pre-secret validation pass, fix breakages, and verify that only secrets/cutover remain.

## Success Criteria
- All requested pre-secret implementation tasks are complete in the repo.
- The validation pass succeeds:
  - repo tests/build/typecheck
  - Docker build
  - `terraform validate`
  - Fly config validation
  - workflow validation
- `outputs/final-readiness.md` documents what remains, and it contains only:
  - applying real secrets/account-specific IDs
  - deploying scanner and Worker
  - applying D1 schema
  - running bounded/full scrapes
  - registering upstream webhooks
- No additional implementation checklist is needed after this loop.

## Primary References
- `packages/shared/src/*`
- `packages/worker/src/index.ts`
- `packages/worker/src/routes/webhooks.ts`
- `packages/worker/wrangler.toml`
- `packages/scanner/src/index.ts`
- `packages/scanner/src/service.ts`
- `packages/scanner/Dockerfile`
- `.github/workflows/*`
- `infrastructure/terraform/*`
