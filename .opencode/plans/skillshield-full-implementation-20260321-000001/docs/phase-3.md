# Phase 3: Scanner Wrapper and Local Scan Flow

## Objective
Implement the scanner wrapper that shells out to Cisco's `skill-scanner` CLI and returns normalized results.

## Instructions
1. Read the scanner wrapper section in `plan.md` and any learnings from prior phases.
2. Implement `packages/scanner/src/scanner.ts` and any shared scanner types/utilities it needs.
3. Normalize the CLI output into stable TypeScript shapes and preserve the fail-closed behavior from the plan.
4. Add tests around command construction, analyzer selection, success parsing, and failure fallback behavior.
5. If the real CLI is unavailable locally, use mocks for unit coverage and document the missing binary as an external dependency instead of leaving the phase unverified.
6. Run relevant verification and capture it.
7. Write `../outputs/phase-3.md`.

## Dependencies
- Phases 1 and 2 must be complete.

## Expected Output
- Scanner wrapper exists and returns normalized results.
- Tests or smoke checks verify happy-path and fail-closed behavior.
- Phase summary exists at `../outputs/phase-3.md`.

## Verification
- Confirm `packages/scanner/src/scanner.ts` exists.
- Confirm fail-closed behavior is covered.
- Confirm verification results are recorded.
