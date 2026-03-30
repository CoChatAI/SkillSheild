# Phase 5: Real GitHub Actions Workflows

## Objective
Replace all placeholder workflows with real pre-secret validation and deploy/operator workflows.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Replace `.github/workflows/deploy-worker.yml` with a real workflow that validates the Worker path and contains a gated deploy path.
3. Replace `.github/workflows/deploy-scanner.yml` with a real workflow that validates the scanner path, builds the image, validates Fly config, and contains a gated deploy path.
4. Replace `.github/workflows/full-scrape.yml` with a real operator workflow aligned to the existing scanner scrape route shape.
5. Keep the workflows usable before secrets by separating validation from deploy-time credential use.
6. Run workflow validation if available.
7. Write `outputs/phase-5.md` and substantive learnings.

## Dependencies
- Phases 1 through 4 complete.

## Expected Output
- All three placeholder workflows are replaced with real, secret-aware but pre-secret-valid workflows.

## Verification
- Confirm no workflow remains as a simple placeholder job.
- Confirm the workflows reference the current repo/runtime shape rather than invented interfaces.
