# Phase 2: ClawHub Adapter and Fetch Flow

## Objective
Implement the scanner-side ClawHub adapter so the service can list and download ClawHub skills locally.

## Instructions
1. Read `plan.md`, especially the scanner architecture and ClawHub adapter sections.
2. Implement any shared scanner utilities needed for external commands, temp directories, or HTTP helpers.
3. Add `packages/scanner/src/adapters/clawhub.ts` with list and fetch behavior aligned with the plan.
4. Keep the code simple and debuggable; prefer explicit parsing and clear errors.
5. Add tests or smoke coverage for the adapter using mocks/fixtures so the phase can verify behavior without relying on live remote calls.
6. Run the relevant verification for this package.
7. Write `../outputs/phase-2.md` with what works, what was verified, and any gaps.

## Dependencies
- Phase 1 must be complete.

## Expected Output
- ClawHub adapter implementation exists.
- Listing and fetch/download logic is locally testable.
- Phase summary exists at `../outputs/phase-2.md`.

## Verification
- Confirm the adapter source file exists.
- Confirm tests or smoke checks cover list/fetch logic.
- Confirm verification results are recorded in the phase output.
