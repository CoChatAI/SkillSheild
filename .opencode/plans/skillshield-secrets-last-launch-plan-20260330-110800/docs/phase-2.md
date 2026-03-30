# Phase 2: Define Target Architecture and Dependency Order

## Objective
Turn the raw inventory into a target release architecture and a dependency ordering that preserves the user's secrets-last constraint.

## Instructions
1. Read `docs/overview.md`, `docs/phase-2.md`, and the accumulated learnings.
2. Define the target runtime split for SkillShield:
   - Cloudflare Worker responsibilities
   - Fly scanner responsibilities
   - Cloudflare-managed state and queue responsibilities
3. Define the dependency ordering for rollout work, explicitly separating:
   - work that can be done without secrets
   - work that must wait for real credentials
4. Explain why the scanner remains outside Workers and how Fly changes the deployment story.
5. Write the phase artifact to `outputs/phase-2.md`.
6. Write substantive learnings to `learnings/learnings.md` under `## Phase 2 Learnings`.

## Dependencies
- Phase 1 complete.

## Expected Output
- A target architecture statement and a secrets-last dependency model for the rollout.

## Verification
- Confirm the output clearly identifies the final secret-wiring step as distinct from prior implementation work.
- Confirm the learnings capture any important tradeoffs or constraints.
