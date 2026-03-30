# Phase 6: Terraform and Final Runtime Config

## Objective
Replace Terraform stubs, add missing Terraform files, and finish production-shaped Worker runtime config.

## Instructions
1. Read the overview, this phase doc, and prior learnings.
2. Replace the Terraform stubs in `infrastructure/terraform/` with real resource definitions.
3. Add the missing Terraform files for queue, variables, and outputs.
4. Keep names aligned with current repo defaults unless there is a strong reason to change them.
5. Finish `packages/worker/wrangler.toml` so it includes queue consumer config and production-shaped env structure while remaining secrets-last.
6. Run targeted verification relevant to this phase, especially Terraform validation where possible.
7. Write `outputs/phase-6.md` and substantive learnings.

## Dependencies
- Phases 1 through 5 complete.

## Expected Output
- Terraform resources are defined instead of stubbed.
- Worker runtime config is production-shaped and queue-consumer aware.

## Verification
- Confirm Terraform includes D1, R2, DNS, queue, variables, and outputs.
- Confirm `wrangler.toml` includes both queue producer and consumer configuration.
