# Phase 11: GitHub Webhook Ingestion for skills.sh Repos

## Objective
Implement the webhook path that reacts to GitHub push or release events for skills.sh-backed repositories.

## Instructions
1. Read the webhook plan details and previous learnings.
2. Implement the GitHub webhook route and queue payload handling in the Worker.
3. Add tests covering supported events, skipped events, and malformed payloads.
4. Document any production-only setup such as GitHub App or repo webhook registration.
5. Run verification.
6. Write `../outputs/phase-11.md`.

## Dependencies
- Phases 1 through 10 must be complete.

## Expected Output
- GitHub webhook ingestion path exists and is locally testable.
- Phase summary exists at `../outputs/phase-11.md`.

## Verification
- Confirm the route exists and is wired in.
- Confirm tests cover supported and skipped events.
- Confirm verification results are recorded.
