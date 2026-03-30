# Phase 2: Worker Queue Consumer and Wrangler Config

## Objective
Implement the missing queue consumer in `packages/worker` and update `wrangler.toml` so the Worker is configured as both queue producer and consumer.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Add a Worker queue-consumer path that validates queue messages and forwards them to the scanner over HTTP.
3. Keep retries at the queue boundary. The consumer should not implement a custom retry loop.
4. Extend Worker bindings/types for scanner-forwarding runtime config in a secrets-last shape.
5. Update `packages/worker/wrangler.toml` to include queue consumer config and production-shaped, non-secret runtime config.
6. Add or update Worker tests covering queue consumption and failure handling.
7. Run targeted verification relevant to this phase.
8. Write `outputs/phase-2.md` and substantive learnings.

## Dependencies
- Phase 1 complete.

## Expected Output
- Worker can consume `scan-jobs` messages and forward them using the shared contract.
- Wrangler config includes queue consumer setup.

## Verification
- Confirm a queue handler exists in `packages/worker`.
- Confirm Worker tests cover successful forwarding and at least one failure path.
