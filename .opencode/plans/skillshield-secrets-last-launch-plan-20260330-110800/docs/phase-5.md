# Phase 5: Define Secret Wiring and Cutover

## Objective
Define the final secret-wiring step, cutover order, and production verification so the rollout ends cleanly and safely.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Build the secret inventory grouped by platform:
   - Cloudflare Worker
   - Fly scanner runtime
   - GitHub Actions / deploy automation
3. Define the final cutover sequence so secrets are added only after all prior implementation work is complete.
4. Define the production smoke tests and acceptance criteria for go-live.
5. Write the phase artifact to `outputs/phase-5.md`.
6. Write substantive learnings to `learnings/learnings.md` under `## Phase 5 Learnings`.

## Dependencies
- Phases 1 through 4 complete.

## Expected Output
- A final-step-only secret wiring and cutover plan with verification steps.

## Verification
- Confirm the output clearly identifies which secrets belong where and in what order they are introduced.
- Confirm learnings capture the operational risks around cutover.
