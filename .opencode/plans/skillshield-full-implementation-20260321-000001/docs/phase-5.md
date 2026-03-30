# Phase 5: ClawHub-Compatible Worker Routes

## Objective
Build the Worker routes that let the ClawHub CLI use SkillShield as a registry mirror.

## Instructions
1. Read the Worker route map and `src/routes/clawhub.ts` details in `plan.md`.
2. Implement the Worker route modules, router composition, and any small data-access helpers required for the ClawHub compatibility path.
3. Preserve the response shapes and blocked/not-found behaviors described in the plan.
4. Add tests for `/skills`, `/skills/:slug`, and `/download`, including blocked and missing cases.
5. Run relevant verification.
6. Write `../outputs/phase-5.md`.

## Dependencies
- Phases 1 through 4 must be complete.

## Expected Output
- ClawHub-compatible Worker routes exist and are locally testable.
- Phase summary exists at `../outputs/phase-5.md`.

## Verification
- Confirm route files exist and are wired into the Worker entry.
- Confirm tests cover list, metadata, download, blocked, and missing paths.
- Confirm verification results are recorded.
