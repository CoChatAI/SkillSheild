# Phase 9: skills.sh Adapter and Fetch Flow

## Objective
Implement the scanner-side adapter for discovering and fetching skills from skills.sh and GitHub.

## Instructions
1. Read the skills.sh adapter section in `plan.md`.
2. Implement `packages/scanner/src/adapters/skills-sh.ts` and any supporting utilities.
3. Keep the discovery and fetch logic explicit. Avoid clever abstraction unless a cut point is obvious.
4. Add tests or fixture-backed smoke checks for parsing skills.sh pages, resolving repository paths, and locating `SKILL.md`.
5. Run verification.
6. Write `../outputs/phase-9.md`.

## Dependencies
- Phases 1 through 8 must be complete.

## Expected Output
- skills.sh adapter exists and is locally testable.
- Phase summary exists at `../outputs/phase-9.md`.

## Verification
- Confirm the adapter source file exists.
- Confirm tests or smoke checks cover discovery and fetch path selection.
- Confirm verification results are recorded.
