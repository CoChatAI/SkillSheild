# Phase 4: Publisher and Persistence Integration

## Objective
Implement publishing of reports/assets to R2-compatible storage and persistence updates for D1.

## Instructions
1. Read the publisher and database sections in `plan.md`.
2. Implement `packages/scanner/src/publisher.ts` and supporting helpers with clear boundaries around storage and D1 update behavior.
3. Keep external integrations injectable or mockable so local verification does not require live credentials.
4. Ensure the implementation preserves the planned verdict rules and asset/report key conventions.
5. Add tests for report generation, key construction, blocked-vs-servable asset behavior, and D1 payload construction.
6. Run verification.
7. Write `../outputs/phase-4.md`.

## Dependencies
- Phases 1 through 3 must be complete.

## Expected Output
- Publisher implementation exists with testable storage/database behavior.
- Phase summary exists at `../outputs/phase-4.md`.

## Verification
- Confirm publisher code exists.
- Confirm mocked tests cover report and key behavior.
- Confirm verification results are recorded.
