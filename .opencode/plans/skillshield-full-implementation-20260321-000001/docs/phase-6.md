# Phase 6: Full ClawHub Scrape Path

## Objective
Add the end-to-end scaffolding needed to trigger or perform a full ClawHub scrape through the scanner service.

## Instructions
1. Read the full scrape portions of `plan.md`, including implementation order and cron/job notes.
2. Implement the scanner service entry flow needed to receive scan jobs and a full scrape trigger for ClawHub.
3. Add any scripts, fixtures, or orchestration helpers needed for local smoke testing.
4. If live scraping cannot be performed in this environment, verify the control flow with mocks/fixtures and document the command a user would run against a deployed scanner.
5. Run verification.
6. Write `../outputs/phase-6.md`.

## Dependencies
- Phases 1 through 5 must be complete.

## Expected Output
- Scanner service exposes the ClawHub scrape path or equivalent orchestration scaffold.
- Local verification covers the control flow or documents the remaining external dependency.
- Phase summary exists at `../outputs/phase-6.md`.

## Verification
- Confirm scanner entry points exist.
- Confirm the full scrape path is represented in code and scripts.
- Confirm verification results are recorded.
