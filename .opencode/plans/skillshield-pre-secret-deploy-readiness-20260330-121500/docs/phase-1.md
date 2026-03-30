# Phase 1: Shared Scan Job Contract

## Objective
Standardize the scan-job schema in `packages/shared` and update the current webhook producer/tests to use that shared contract.

## Instructions
1. Read `docs/overview.md`, this phase doc, and `learnings/learnings.md`.
2. Add a shared schema and type in `packages/shared` for queued scan jobs, grounded in the payloads currently produced by `packages/worker/src/routes/webhooks.ts`.
3. Move the existing `slug`/`repo` requirement into the shared schema so both Worker and scanner use the same validation rule.
4. Update the Worker webhook routes to validate/enqueue the shared contract rather than ad hoc inline objects.
5. Update or add tests in `packages/shared` and `packages/worker` so the shared contract is exercised directly.
6. Keep the change minimal and aligned with the current payload shape; do not invent a broader queue envelope.
7. Run targeted verification relevant to this phase.
8. Write `outputs/phase-1.md` and record substantive notes in `learnings/learnings.md` under `## Phase 1 Learnings`.

## Dependencies
- None.

## Expected Output
- Shared queue schema/type exists and is used by the Worker webhook producers/tests.

## Verification
- Confirm the shared schema/type is exported from `packages/shared`.
- Confirm webhook tests use the shared contract and pass.
