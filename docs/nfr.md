# Non-Functional Requirements (NFR)

## 1. Security

- **AuthN/AuthZ:** All incoming Discord slash command requests MUST be verified using Discord's Ed25519 request signature (the `X-Signature-Ed25519` / `X-Signature-Timestamp` headers). Unsigned or invalid requests are rejected with HTTP 401. Azure resources communicate via Azure Managed Identities — no shared keys between services.
- **Secrets management:** Discord public key, bot token, and any third-party credentials are stored in Azure Key Vault. The Container App accesses them at runtime via Managed Identity references; secrets are never committed to source control or baked into container images.
- **Encryption requirements:** All traffic in transit uses TLS 1.2+. Data at rest in Cosmos DB is encrypted by default (Azure-managed keys). No additional customer-managed key (CMK) requirement at this time.
- **Logging / audit:** Structured logs (JSON) emitted to stdout → forwarded to Application Insights. Logs must not contain Discord user tokens, message content, or PII beyond Discord user IDs necessary for feature operation.

## 2. Reliability & Availability

- **Availability target:** Best effort — no formal SLA commitment. The app is non-critical; downtime is acceptable outside of active game sessions.
- **RPO / RTO:** No formal targets. Recovery is via redeployment from the CI/CD pipeline. Cosmos DB automatic backups provide a soft RPO of ~1 hour (platform default).
- **Multi-region strategy:** Single region (see §6). No active–active or active–passive failover planned.
- **Resilience baseline:** Container App configured with `minReplicas: 1` to eliminate cold-start latency and reduce Discord timeout failures.

## 3. Performance

- **Latency target:** < 2 seconds end-to-end from Discord HTTP request receipt to HTTP response. This provides a safe buffer under Discord's hard 3-second interaction timeout.
- **Throughput target:** Designed for low-volume, bursty use (a single Discord server / small group). No high-throughput SLA required.
- **Scaling expectations:** Container Apps scales from 1 to a small maximum (e.g., 3 replicas) based on concurrent HTTP requests. Scale-to-zero is disabled to meet the latency target.

## 4. Cost

- **Monthly budget:** < $20 USD/month for all Azure resources combined.
- **Guardrails:**
  - Container Apps: `minReplicas: 1`, `maxReplicas: 3`; use the smallest available CPU/memory profile (e.g., 0.25 vCPU / 0.5 Gi).
  - Cosmos DB: Serverless capacity mode — pay per RU, no provisioned throughput.
  - Application Insights: Sampling enabled; retain logs for 30 days (free tier cap: 5 GB/month).
  - Azure Key Vault: Standard tier.
  - No reserved instances or premium SKUs without explicit approval.

## 5. Operability

- **Monitoring:** Azure Application Insights (basic / pay-as-you-go). Dashboards cover: request volume, error rate, average response latency.
- **Alerting:** Alert on error rate > 5% over a 5-minute window, and on response P95 > 2 seconds. Alerts route to email (no on-call rotation).
- **Runbooks:** See `docs/runbooks/`. Key procedures: deploy, rollback, incident response.
- **On-call / escalation:** No formal on-call. Issues tracked via GitHub Issues.

## 6. Dependency Management

- **Supported versions only:** All runtime dependencies (Node.js, npm packages, Azure SDKs, base container images) MUST be on actively supported, non-EOL versions at the time of adoption.
- **Node.js:** Use the current LTS release. Upgrade to the next LTS within 3 months of the prior LTS reaching end-of-life.
- **npm packages:** Prefer packages with active maintenance signals (recent releases, responsive issue tracker, high download velocity). Avoid packages marked deprecated or with no activity in > 1 year.
- **Dependency audits:** `npm audit` (or equivalent) must pass with no high/critical vulnerabilities as part of CI. Findings must be remediated before merging.
- **Pinning strategy:** Pin exact versions in `package-lock.json`; use semver ranges in `package.json` for minor/patch updates. Review and update dependencies on a regular cadence (e.g., monthly via Dependabot or equivalent).
- **Azure SDKs:** Use the `@azure/*` v12+ SDK family (the current generation). Do not use legacy Azure SDKs (e.g., `azure-*` v1 packages).

## 7. Compliance

- **Regulatory / policy requirements:** No regulated data (not HIPAA, PCI, etc.). Follow general Microsoft and NIST security best practices.
- **Data residency:** Primary region — **Central US**. Fallback region (used only if Central US capacity is unavailable) — **East US 2**. All Azure resources must be deployed within one of these two regions. No cross-region data replication required.
