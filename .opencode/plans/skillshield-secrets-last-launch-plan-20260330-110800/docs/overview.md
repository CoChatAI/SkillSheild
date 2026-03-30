# Plan: skillshield-secrets-last-launch-plan-20260330-110800

## Goal
Produce a concrete, repo-grounded launch plan for SkillShield that addresses the current gaps in deploy automation, Terraform-managed infrastructure, the scanner container, and queue consumption, while ensuring that all code, config, CI, and IaC work is completed before any real secrets are needed. The final step must be the production secret wiring and cutover.

## Context
- The repository already contains the Worker, scanner, shared package, dashboard, tests, and plan artifacts for the initial build.
- The remaining release blockers are operational rather than product-surface features.
- Known gaps from the current repo state:
  - `.github/workflows/deploy-worker.yml`, `deploy-scanner.yml`, and `full-scrape.yml` are placeholders.
  - `infrastructure/terraform/d1.tf`, `r2.tf`, and `dns.tf` are stubbed; queue Terraform is also missing.
  - `packages/scanner/Dockerfile` is scaffold-only and not deployable.
  - The Worker produces `SCAN_QUEUE` jobs but does not consume them yet.
- The scanner deployment target is Fly.io with scale-to-zero behavior, while the public edge and state remain on Cloudflare.
- The user wants a secrets-last rollout: finish everything possible first, then wire secrets and perform production cutover as the last step.
- This RALPH loop is for planning and execution artifacts, not for implementing the entire deployment stack in this run.

## Phases Overview
1. Inventory the current operational gaps and constraints from the repo.
2. Define the secrets-last target architecture and dependency order.
3. Design the code and runtime work needed before secrets: queue consumer, scanner auth shape, and production Docker image.
4. Design the infrastructure and deployment automation work needed before secrets: Terraform, Wrangler config, Fly config, and GitHub Actions.
5. Define the final cutover phase: secret inventory, cutover order, and production verification.
6. Consolidate the final rollout plan and review it for dependency correctness and completeness.

## Success Criteria
- A complete rollout plan exists that explicitly addresses all four blocker areas:
  - deploy automation
  - Terraform-managed infra
  - production scanner container
  - real queue consumption
- The plan is ordered so that all non-secret work lands before any live credentials are required.
- The final step is clearly identified as secret wiring and production cutover.
- Each phase produces a written output in `outputs/` and substantive learnings in `learnings/learnings.md`.
- The final plan is specific to this repo, references the current file structure and known gaps, and is actionable by an engineer.

## Primary References
- `README.md`
- `packages/worker/wrangler.toml`
- `packages/scanner/Dockerfile`
- `packages/worker/src/index.ts`
- `packages/worker/src/routes/webhooks.ts`
- `.github/workflows/*`
- `infrastructure/terraform/*`
