# Phase 4: Scanner Production Packaging and Fly Config

## Objective
Replace the scanner scaffold image with a real production image and add checked-in Fly config suitable for scale-to-zero deployment.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Replace `packages/scanner/Dockerfile` with a multi-stage production build that installs the actual runtime dependencies required by the scanner code.
3. Ensure the final image starts the real scanner service, exposes the right port, and includes a healthcheck.
4. Add checked-in Fly configuration with non-secret runtime shape only.
5. Keep the implementation secrets-last: no real credentials or live IDs in checked-in files.
6. Run targeted verification relevant to this phase, including local Docker build and Fly config validation if possible.
7. Write `outputs/phase-4.md` and substantive learnings.

## Dependencies
- Phases 1 through 3 complete.

## Expected Output
- Production-ready scanner Dockerfile exists.
- Fly config exists and validates or has clear validation notes.

## Verification
- Confirm the Dockerfile runs the real scanner service.
- Confirm a Fly config file exists and is targeted at the scanner service.
