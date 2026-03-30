# Phase 3: Design Pre-Secret Code and Runtime Work

## Objective
Define the concrete code and runtime work that must be completed before production credentials are introduced.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Design the queue-consumer path that closes the gap between `SCAN_QUEUE.send(...)` and the scanner service.
3. Define the shared queue message contract and where it should live.
4. Define the scanner authentication shape so the endpoints can be implemented and tested before real secrets exist.
5. Define the production Docker image requirements for `packages/scanner/Dockerfile`, including build/runtime dependencies, health checks, and local verification.
6. Organize the output so an engineer can implement the code in a sensible sequence before secrets.
7. Write the phase artifact to `outputs/phase-3.md`.
8. Write substantive learnings to `learnings/learnings.md` under `## Phase 3 Learnings`.

## Dependencies
- Phases 1 and 2 complete.

## Expected Output
- A concrete pre-secret implementation plan for queue consumption, scanner auth shape, and the production container.

## Verification
- Confirm the output covers queue consumer, shared schema, scanner auth shape, and Dockerfile productionization.
- Confirm learnings capture implementation risks or simplifications.
