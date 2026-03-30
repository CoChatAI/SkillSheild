# Phase 1: Foundation and Monorepo Scaffolding

## Objective
Create the initial repository structure, workspace tooling, shared package foundation, and a minimal Worker app with a health endpoint.

## Instructions
1. Read `plan.md`, especially sections 1, 2, 3, 4, 6, 7, and 8.
2. Scaffold the monorepo root files from the plan: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and a useful `.gitignore`.
3. Create the package directories for `packages/worker`, `packages/scanner`, `packages/shared`, and `packages/dashboard`, plus the initial `infrastructure/` and `.github/workflows/` structure where it helps later phases.
4. Implement the shared package with initial constants, types, and Zod schemas that match the domain in `plan.md`.
5. Implement a minimal Worker app using Hono with `/health` returning the planned JSON payload.
6. Add `wrangler.toml`, `schema.sql`, TypeScript config, and package scripts needed for local development.
7. Add basic test scaffolding where it meaningfully supports the health endpoint or shared schemas.
8. Run the most relevant local verification available, such as install, typecheck, tests, or build commands. If a dependency is missing, document it clearly.
9. Write `../outputs/phase-1.md` describing what was created, what passed, and any external follow-up needed.

## Dependencies
- None.

## Expected Output
- Monorepo skeleton exists and is coherent.
- Shared package compiles or has clearly documented blockers.
- Worker package exposes a health endpoint and basic scripts.
- Phase summary exists at `../outputs/phase-1.md`.

## Verification
- Confirm the new root and package files exist.
- Confirm the health route implementation exists.
- Confirm local verification commands were attempted and results recorded.
