# Phase 6 Summary

- Consolidated Phases 1 through 5 into one repo-grounded rollout plan at `outputs/final-plan.md`.
- Preserved the required secrets-last ordering: code and config first, validation second, live credentials and account-specific IDs late, upstream webhook registration last.
- Verified the final plan explicitly covers all four blocker areas from the current repo state:
  - deploy automation in `.github/workflows/*.yml`
  - Terraform gaps in `infrastructure/terraform/*`
  - scanner container readiness in `packages/scanner/Dockerfile`
  - queue consumption gap between `packages/worker/src/routes/webhooks.ts`, `packages/worker/src/index.ts`, and `packages/worker/wrangler.toml`

## Final warnings

- The main remaining risk is operational ordering, not missing documentation. If live webhooks are enabled before the Worker queue consumer and authenticated scanner path are both proven in production, the system can accept real events without a safe execution path.
- Terraform ownership of the queue resource is straightforward, but queue consumer attachment may still need to remain in Wrangler config depending on provider support. The final plan keeps that distinction explicit.
- The scanner container is still the biggest runtime unknown until the real image proves `skill-scanner` installation and archive tooling work in CI and Fly.
