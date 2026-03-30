# Phase 6: Consolidate Final Rollout Plan

## Objective
Produce the final consolidated rollout plan document and verify that it addresses every blocker in the correct order.

## Instructions
1. Read the overview, this phase doc, all prior phase outputs, and the learnings file.
2. Create a final consolidated plan document at `outputs/final-plan.md`.
3. The final plan must:
   - address deploy automation, Terraform, scanner container, and queue consumption
   - use a secrets-last ordering
   - reserve the last step for wiring live credentials and cutover
   - include a clean implementation sequence and a definition of done
4. Review the final document for missing dependencies, contradictions, or missing blocker coverage.
5. Write the per-phase artifact to `outputs/phase-6.md` summarizing what was consolidated and any final warnings.
6. Write substantive learnings to `learnings/learnings.md` under `## Phase 6 Learnings`.

## Dependencies
- Phases 1 through 5 complete.

## Expected Output
- `outputs/final-plan.md` exists and is internally consistent.
- `outputs/phase-6.md` summarizes the consolidation and final review.

## Verification
- Confirm `outputs/final-plan.md` covers all four blocker areas.
- Confirm the last major implementation step is secret wiring and cutover.
- Confirm learnings capture any final residual risks.
