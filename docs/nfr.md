# Non-Functional Requirements (NFR)

## 1. Security

- **AuthN/AuthZ:** The bot uses a **Gateway WebSocket connection** (discord.js) — there is no public HTTP endpoint for Discord to call, so Ed25519 HTTP signature verification is not applicable (see ADR-0005). Discord authenticates the bot via the bot token stored in Azure Key Vault (see Secrets management below). Azure resources communicate via Azure Managed Identities — no shared keys between services.
  - **Analytics web app (Phase 4, ADR-0006):** Unlike the bot, the analytics web app exposes a **public HTTPS ingress** (its only inbound network boundary). It is gated by **Discord OAuth2** (Authorization Code flow); after login the app verifies the user is a member of the configured guild before serving any page, and issues a signed, httpOnly session cookie. The web app accesses Cosmos with a **separate managed identity holding only the built-in read-only data role** (least privilege) — it cannot mutate coordination data.
  - Outbound Discord user and guild REST calls explicitly use API v10. OAuth authorization and token exchange retain Discord's unversioned OAuth2 endpoints; guild membership and cookie checks are unchanged.
  - Azure container runtimes explicitly set `NODE_ENV=production`, independently of resource environment tags such as `prod`, so OAuth state and session cookies retain `Secure`, `HttpOnly`, and `SameSite=Lax` attributes.
- **Secrets management:** Discord public key, bot token, the **Discord OAuth client secret** (web app), and any third-party credentials are stored in Azure Key Vault. The Container Apps access them at runtime via Managed Identity references; secrets are never committed to source control or baked into container images.
- **Encryption requirements:** All traffic in transit uses TLS 1.2+. Data at rest in Cosmos DB is encrypted by default (Azure-managed keys). No additional customer-managed key (CMK) requirement at this time.
- **Logging / audit:** Structured logs (JSON) emitted to stdout → forwarded to Application Insights. Logs must not contain Discord user tokens, message content, or PII beyond Discord user IDs necessary for feature operation. The analytics web app must not log OAuth tokens or session cookies.

## 2. Reliability & Availability

- **Availability target:** Best effort — no formal SLA commitment. The app is non-critical; downtime is acceptable outside of active game sessions.
- **RPO / RTO:** No formal targets. Recovery is via redeployment from the CI/CD pipeline. Cosmos DB automatic backups provide a soft RPO of ~1 hour (platform default).
- **Multi-region strategy:** Single region (see §6). No active–active or active–passive failover planned.
- **Resilience baseline:** Container App runs as a **single replica** (`minReplicas: 1`, `maxReplicas: 1`). The bot holds one Discord Gateway WebSocket and keeps multi-step interaction state and scheduler jobs in memory, so it must not be horizontally scaled — a second replica would duplicate the gateway connection and double-handle events. `minReplicas: 1` also eliminates cold-start latency. On revision swaps the bot handles **SIGTERM** for a graceful shutdown (disconnect gateway, stop cron jobs, close the health server).
  - node-cron 4 reminder tasks run once, without overlapping executions. Replacing or cancelling reminders destroys their task registrations; shutdown also drains the nightly expiry scheduler.

## 3. Performance

- **Latency target:** < 2 seconds end-to-end from Discord HTTP request receipt to HTTP response. This provides a safe buffer under Discord's hard 3-second interaction timeout.
- **Throughput target:** Designed for low-volume, bursty use (a single Discord server / small group). No high-throughput SLA required.
- **Scaling expectations:** The **bot** runs as a **single replica** (`minReplicas: 1`, `maxReplicas: 1`). The bot is a stateful singleton (one Discord Gateway connection + in-memory interaction/scheduler state) and is intentionally **not** horizontally scaled. Scale-to-zero is disabled to meet the latency target. The **analytics web app** (Phase 4, ADR-0006) is a separate, stateless Container App that runs **scale-to-zero** (`minReplicas: 0`); the first request after an idle period incurs a cold start, which is acceptable for this non-critical, read-only view (the < 2s target above applies to the Discord interaction path, not the dashboard).

## 4. Cost

- **Monthly budget:** < $20 USD/month for all Azure resources combined.
- **Guardrails:**
  - Container Apps: the **bot** runs `minReplicas: 1`, `maxReplicas: 1` (singleton gateway bot); the **analytics web app** runs `minReplicas: 0` (scale-to-zero) so it costs ~$0 when idle. Both use the smallest available CPU/memory profile (e.g., 0.25 vCPU / 0.5 Gi) and share one Container Apps Environment.
  - Cosmos DB: Serverless capacity mode — pay per RU, no provisioned throughput.
  - Application Insights: Sampling enabled; retain logs for 30 days (free tier cap: 5 GB/month).
  - Azure Key Vault: Standard tier.
  - No reserved instances or premium SKUs without explicit approval.

## 5. Operability

- **Monitoring:** Azure Application Insights (basic / pay-as-you-go), shared by the bot and the analytics web app. Dashboards cover: request volume, error rate, average response latency. For the web app, also track login success/failure and page render latency.
- **Alerting:** Alert on error rate > 5% over a 5-minute window, and on response P95 > 2 seconds. Alerts route to email (no on-call rotation).
- **Runbooks:** See `docs/runbooks/`. Key procedures: deploy, rollback, incident response.
- **On-call / escalation:** No formal on-call. Issues tracked via GitHub Issues.

## 6. Dependency Management

- **Supported versions only:** All runtime dependencies (Node.js, npm packages, Azure SDKs, base container images) MUST be on actively supported, non-EOL versions at the time of adoption.
- **Node.js:** Use the current LTS release (26 as of November 2026). Keep `app/.node-version`, package engine/type definitions, CI, and Docker images aligned. Pin the container image digest and review patch/digest updates monthly. Upgrade to the next LTS within 3 months of the prior LTS reaching end-of-life.
- **npm packages:** Prefer packages with active maintenance signals (recent releases, responsive issue tracker, high download velocity). Avoid packages marked deprecated or with no activity in > 1 year.
- **Dependency audits:** `npm audit` (or equivalent) must pass with no high/critical vulnerabilities as part of CI. Findings must be remediated before merging.
  - Both app release workflows run the same audit, build, test type-check, lint, and unit-test gates before publishing images. Never use forced dependency downgrades or audit exclusions to make these gates pass.
- **Pinning strategy:** Pin exact versions in `package-lock.json`; use semver ranges in `package.json` for minor/patch updates. Review and update dependencies on a regular cadence (e.g., monthly via Dependabot or equivalent).
- **Azure SDKs:** Use actively maintained, current-generation `@azure/*` packages. Major versions are package-specific: Cosmos, Identity, and Key Vault Secrets currently use 4.x; there is no universal v12 requirement. Do not use legacy `azure-*` packages.
- **Toolchain compatibility:** Use ESLint 10 and Jest 30 with maintained TypeScript ESLint and ts-jest releases. TypeScript remains on the compatible 6.0.x line until both tools officially support newer compiler versions; do not override their supported peer ranges. The test compiler configuration explicitly includes Jest and Node types.
- **Transitive dependencies:** Temporary `glob` and `minimatch` overrides select patched releases while upstream tooling updates its dependency ranges. Validate lint, test discovery, and coverage when updating these overrides, and remove them when upstream ranges include patched versions. Track the remaining low-severity `deepmerge` advisory (GHSA-gcqx-w48m-w2h4) in Jest's development-only dependency tree until an upstream fix exists; production dependencies must remain audit-clean.
- **Azure management APIs:** Prefer current stable ARM API versions and monitor retirement announcements. Key Vault must use `2026-02-01` or later before February 27, 2027; this does not change secret data-plane API lifecycles. Preserve explicit RBAC, network, SKU, retention, replica, and certificate settings during API updates.
  - Preserve the deployed consumption-only environment, public ingress boundary, existing peer-security settings, 300-second cooldown/30-second polling, latest-revision traffic, Cosmos automatic failover, indexing paths, and conflict resolution explicitly rather than relying on evolving API defaults.
- **Update cadence:** Dependabot checks npm, Docker, and GitHub Actions monthly. Review the pinned Chart.js CDN version, Node version file, Bicep CLI, and ARM API versions during the same maintenance window.

## 7. Compliance

- **Regulatory / policy requirements:** No regulated data (not HIPAA, PCI, etc.). Follow general Microsoft and NIST security best practices.
- **Data residency:** Primary region — **Central US**. Fallback region (used only if Central US capacity is unavailable) — **East US 2**. All Azure resources must be deployed within one of these two regions. No cross-region data replication required.
