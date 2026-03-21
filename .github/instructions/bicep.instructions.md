---
applyTo: "infra/**/*.bicep,infra/**/*.bicepparam"
---

## Bicep standards
- Prefer modules for reusable components; keep infra/main.bicep orchestration thin.
- Use clear parameter naming and safe defaults.
- Add @description decorators for key params/outputs when helpful.

## Validation expectations
- Prefer repo-level configuration in infra/bicepconfig.json rather than many inline suppressions.

## Requirements mapping
- If infra changes affect Security/Availability/Cost, reference docs/nfr.md in the plan.

## Deployment and configuration drift
- Where ever possible avoid making imperative operations against Azure resources. Instead built the configuration into the Bicep IaC and run the infra pipeline to deploy. This will ensure idempotency.
