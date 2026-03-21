# ADR 0002: Host Discord Bot Backend on Azure Container Apps

- Status: Accepted
- Date: 2026-03-20

## Context

The Munch Assemble Discord bot uses slash commands, which require a publicly accessible HTTPS endpoint that responds within 3 seconds. We need a hosting platform that:
- Has no cold-start latency under typical usage (minReplicas ≥ 1)
- Scales horizontally for burst traffic
- Stays within the < $20/month budget
- Supports managed identity for secrets access (NFR §1)

Options considered: Azure Functions (Consumption), Azure App Service, Azure Container Apps, Azure Container Instances.

## Decision

Use **Azure Container Apps** running a **TypeScript / Node.js** container.

- `minReplicas: 1` eliminates cold starts and keeps P95 latency under the 2-second target (NFR §3).
- `maxReplicas: 3` caps cost while handling reasonable burst (NFR §4).
- Smallest available CPU/memory profile (0.25 vCPU / 0.5 Gi) keeps monthly cost minimal.
- Native Managed Identity support satisfies NFR §1 without embedding credentials.

## Consequences

- **Cost:** At minReplicas = 1, the app is always warm; idle cost is ~$3–5/month for the smallest profile — well within budget.
- **Ops:** Container image must be kept small and startup fast (< 1 second) to stay within the latency target.
- **Scaling:** If throughput requirements grow significantly, maxReplicas and CPU/memory profiles can be increased; this may breach the $20 budget and would require re-evaluation.
- **NFR impacts:** Satisfies NFR §3 (latency), NFR §4 (cost guardrails), NFR §1 (Managed Identity).
