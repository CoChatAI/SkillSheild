# Phase 8: ClawHub Webhook Ingestion

## Objective
Implement the Worker webhook endpoint and queueing path for ClawHub publish events.

## Instructions
1. Read the webhook section of `plan.md` and prior learnings.
2. Implement the Worker webhook route for ClawHub events, including payload parsing, event persistence, and queue/send behavior.
3. Add tests for valid payloads and malformed payload handling.
4. If shared-secret validation is practical locally, include it; otherwise document the exact follow-up needed.
5. Run verification.
6. Write `../outputs/phase-8.md`.

## Dependencies
- Phases 1 through 7 must be complete.

## Expected Output
- ClawHub webhook ingestion path exists and is locally testable.
- Phase summary exists at `../outputs/phase-8.md`.

## Verification
- Confirm the route exists and is wired in.
- Confirm tests cover valid and invalid payloads.
- Confirm verification results are recorded.
