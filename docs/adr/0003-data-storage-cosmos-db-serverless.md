# ADR 0003: Use Azure Cosmos DB (Serverless) for Persistent Storage

- Status: Accepted
- Date: 2026-03-20

## Context

Munch Assemble needs to persist game data (e.g., player rosters, statistics, past session results). We need storage that:
- Is schema-flexible to evolve with the BRD as requirements are fleshed out
- Has a pay-per-use cost model (low/bursty traffic)
- Stays within < $20/month (NFR §4)
- Works well with JSON payloads from Discord interactions

Options considered: Azure Cosmos DB (Serverless), Azure Table Storage, Azure SQL (Basic), stateless only.

## Decision

Use **Azure Cosmos DB for NoSQL in Serverless capacity mode**.

- Serverless billing (per RU consumed) means zero cost when idle.
- NoSQL document model aligns naturally with Discord interaction payloads and game data structures.
- Managed Identity connection via the Cosmos DB data plane RBAC eliminates connection string secrets (NFR §1).
- Single-region deployment in Central US (NFR §6).

## Consequences

- **Cost:** Serverless RU costs are negligible at low volume; estimated < $2/month at typical usage.
- **Flexibility:** Schema can evolve without migrations — useful while BRD is still being defined.
- **Latency:** Cosmos DB p99 < 10ms for point reads in the same region, contributing comfortably within the 2-second end-to-end budget (NFR §3).
- **Limitation:** Serverless mode does not support multi-region writes (acceptable given best-effort availability target, NFR §2).
- **NFR impacts:** Satisfies NFR §1 (Managed Identity), NFR §4 (cost guardrails), NFR §6 (Central US residency).
