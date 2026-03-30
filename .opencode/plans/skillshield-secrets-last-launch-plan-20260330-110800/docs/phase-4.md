# Phase 4: Design Pre-Secret Infra and Deployment Automation

## Objective
Define the infrastructure and CI/CD work that can be completed before any live credentials are added.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Define the Terraform work needed to replace the current stubs and add any missing release-critical resources.
3. Define the `wrangler.toml` and Fly configuration changes needed to make runtime bindings/config production-shaped without storing secrets.
4. Define the GitHub Actions work needed for:
   - Worker deployment pipeline
   - scanner deployment pipeline
   - full-scrape operator workflow
5. Keep the plan secrets-last: workflows and config should be fully structured before credentials are introduced.
6. Write the phase artifact to `outputs/phase-4.md`.
7. Write substantive learnings to `learnings/learnings.md` under `## Phase 4 Learnings`.

## Dependencies
- Phases 1 through 3 complete.

## Expected Output
- A concrete pre-secret plan for Terraform, Wrangler/Fly config, and GitHub Actions.

## Verification
- Confirm the output explicitly covers the three placeholder workflows and the Terraform gaps.
- Confirm the learnings record any missing resource or naming issues discovered during planning.
