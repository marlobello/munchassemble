# ADR 0005: Discord Bot Architecture — Gateway WebSocket (discord.js)

- Status: Accepted
- Supersedes: Initial assumption in ADR-0002 (HTTP Interactions Endpoint)
- Date: 2026-03-29

## Context

The bot must handle Discord slash commands, button interactions, select menus, and modals. It also needs to send **proactive messages** (smart reminders at T-15 and T-5 before departure — BR-060/061) without a user interaction triggering them.

Two Discord bot architectures were evaluated:

1. **HTTP Interactions Endpoint:** Discord POSTs to a public HTTPS endpoint on each interaction. Requires Ed25519 signature verification on every request. Proactive messages require the bot token + Discord REST API in a separate scheduler path.
2. **Gateway WebSocket bot (discord.js):** Bot maintains a persistent WebSocket to Discord's Gateway. All interactions (slash commands, component interactions) and proactive message sending use the same discord.js Client. No public HTTPS endpoint needed for Discord to call.

## Decision

Use the **Gateway WebSocket bot** pattern via **discord.js**.

Reasons:
- The Container App runs at `minReplicas: 1` (always-on) — a persistent WebSocket connection adds no meaningful cost or complexity.
- Reminder scheduling (BR-060/061) becomes a trivial `client.channels.cache.get(channelId).send(...)` call inside a node-cron job; no second REST authentication flow needed.
- discord.js handles all interaction types (slash commands, buttons, modals, select menus) with a unified `InteractionCreate` event — no code path divergence.
- Reduces infrastructure surface: no public HTTPS endpoint needed for Discord callbacks.
- Pattern is proven in the adjacent munchhatmap reference implementation.

## Consequences

- **NFR §1 update:** The Ed25519 request signature verification requirement in NFR §1 is removed; it applied to HTTP Interactions Endpoint only. All secrets still come from Key Vault via Managed Identity. Bot token is stored in Key Vault and injected as an environment variable at runtime.
- **Intents:** Bot requires `GatewayIntentBits.Guilds` and `GatewayIntentBits.GuildMembers` (for ping-unanswered feature, BR-012). `MessageContent` privileged intent is **not** required (all interactions are slash command / component based).
- **Resilience:** If the WebSocket disconnects, discord.js reconnects automatically. Reminders scheduled by node-cron are in-process; a restart reschedules them from active sessions on boot.
- **Ops:** Container must stay running to maintain the WebSocket. `minReplicas: 1` already enforces this (ADR-0002).
- **NFR impacts:** Satisfies NFR §3 (low latency via always-warm process), NFR §1 (Key Vault secrets, no hardcoded credentials), NFR §4 (no cost increase).
