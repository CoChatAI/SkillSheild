# Phase 7: Full Pre-Secret Validation and Readiness Review

## Objective
Run the full pre-secret validation pass, fix issues, and confirm that only secrets and live cutover tasks remain.

## Instructions
1. Read the overview, this phase doc, all prior outputs, and prior learnings.
2. Run the full validation pass requested by the user:
   - repo tests/build/typecheck
   - Docker build
   - `terraform validate`
   - Fly config validation
   - workflow validation
3. If validation fails, fix the underlying issues and re-run until the pass is green or a truly external blocker remains.
4. Create `outputs/final-readiness.md` summarizing what is complete and what remains.
5. The only remaining items allowed in `final-readiness.md` are:
   - applying real secrets/account-specific IDs
   - deploying scanner and Worker
   - applying D1 schema
   - running bounded/full scrapes
   - registering upstream webhooks
6. Write `outputs/phase-7.md` and substantive learnings.

## Dependencies
- Phases 1 through 6 complete.

## Expected Output
- Validation pass is complete and documented.
- `outputs/final-readiness.md` exists and leaves only secrets/cutover tasks.

## Verification
- Confirm the requested validation commands or equivalent checks were run and recorded.
- Confirm `final-readiness.md` does not contain additional implementation tasks.
