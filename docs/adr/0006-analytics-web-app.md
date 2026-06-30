# ADR 0006: Read-Only Analytics Web App on Azure Container Apps

- Status: Accepted
- Date: 2026-06-29

## Context

All Munch Assemble coordination data (sessions, attendance, votes, carpools) lives in
Cosmos DB but is only ever surfaced inside Discord via the bot's session panel. There is
demand to view this data **historically** — popular restaurants, attendance trends, who
drives most, and a session history — in a richer form than Discord embeds allow.

The existing bot (ADR-0005) is a **singleton Gateway WebSocket process** with no inbound
HTTP ingress and `minReplicas: 1` / `maxReplicas: 1`. It must not be horizontally scaled
and is the wrong place to serve a request-driven web UI.

Constraints:
- Must stay within the **< $20/month** budget (NFR §4).
- Must use **Managed Identity** for data access — least privilege (NFR §1).
- The data contains Discord usernames; access must be **restricted to guild members**.
- The BRD previously listed a web frontend as out-of-scope (now updated — BRD §2/Phase 4).

## Decision

Add a **separate, read-only analytics web app** as a **new Container App**
(`ca-munchassemble-web-<env>`) in the **existing** Container Apps Environment.

- **Hosting:** Reuses the existing Container Apps Environment. External HTTPS ingress.
  `minReplicas: 0` (scale-to-zero) because it is request-driven and non-critical —
  unlike the always-on bot. Smallest CPU/memory profile.
- **Identity & data access:** Its own **system-assigned managed identity**, granted the
  **built-in Cosmos read-only data role** (`00000000-0000-0000-0000-000000000001`) — it
  can never mutate coordination data. It reuses the bot's `types/` and read paths from
  `db/repositories`.
- **AuthN/AuthZ:** **Discord OAuth2** Authorization Code flow. After login the app
  verifies the user is a member of the configured guild (`/users/@me/guilds`) and issues
  a signed, httpOnly session cookie. The OAuth client secret is stored in **Key Vault**
  and read via Managed Identity (Key Vault Secrets User).
- **Frontend:** Server-rendered pages + Chart.js. No SPA — unnecessary at this scale.
- **Delivery:** A dedicated `Dockerfile.web` and `start:web` entrypoint reusing the
  existing `app/` codebase, deployed by an independent `deploy-web.yml` workflow so the
  singleton bot and the scalable web app ship separately.

Options considered and rejected:
- **Add HTTP UI to the bot process** — violates the singleton/no-ingress constraints
  (ADR-0005, NFR §2/§3) and couples scaling.
- **Azure Static Web Apps + Functions** — viable, but introduces a second hosting model
  and runtime; the existing Container Apps + Bicep + TypeScript patterns are reused with
  less new surface.
- **Public dashboard** — rejected; usernames are PII-adjacent, so guild-gated access is
  required (NFR §1).

## Consequences

- **New network boundary:** This is the project's first inbound HTTPS ingress. NFR §1 is
  updated to cover Discord OAuth authn/authz and the ingress surface.
- **New identity & secret:** A second managed identity with read-only Cosmos RBAC and a
  new Key Vault secret (`discord-oauth-client-secret`). Secrets remain in Key Vault and
  are never committed (NFR §1).
- **Cost:** Scale-to-zero keeps idle cost ~$0; the web app only consumes resources when
  visited. Cross-partition aggregate queries are cheap at this scale (~14 users).
  Remains within the < $20/month budget (NFR §4).
- **Performance tradeoff:** `minReplicas: 0` means the *first* request after idle incurs
  a cold start. This is acceptable for a non-critical analytics view (NFR §3 latency
  targets apply to the Discord interaction path, not this dashboard).
- **Retention dependency:** Historical analytics require durable history. Completed
  sessions are retained indefinitely (the previously-documented 30-day TTL was never
  implemented and the misleading `defaultTtl`/`_ttl` config is removed).
- **Manual prerequisite:** A Discord OAuth application + redirect URI must be configured
  in the Discord developer portal and its secret placed in Key Vault (see runbooks).
- **NFR impacts:** Satisfies NFR §1 (OAuth, Key Vault secret, least-privilege read-only
  MI), NFR §3 (scale-to-zero tradeoff documented), NFR §4 (cost), NFR §5 (web monitoring
  via the shared Application Insights / Log Analytics).
