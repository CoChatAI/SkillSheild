# Phase 3: Scanner Auth and Request Validation

## Objective
Protect scanner mutation endpoints with bearer auth and shared request validation, while keeping local development workable without real secrets.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Update `packages/scanner` to use the shared scan-job contract for `POST /scan`.
3. Add bearer-token auth for `POST /scan` and `POST /scrape/:source`, leaving `/health` public.
4. Keep the auth optional when the token is unset so local and test workflows remain practical before secrets.
5. Add or update scanner tests covering auth and request validation.
6. Run targeted verification relevant to this phase.
7. Write `outputs/phase-3.md` and substantive learnings.

## Dependencies
- Phases 1 and 2 complete.

## Expected Output
- Scanner request contract is shared with Worker.
- Scanner mutation endpoints enforce bearer auth when configured.

## Verification
- Confirm `/scan` validates request bodies using the shared schema.
- Confirm scanner tests cover auth success and failure cases.
