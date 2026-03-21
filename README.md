# Munch Assemble

A Discord bot plugin that lets users invoke `/munchassemble` to organize Munch Men and track game statistics.

## Architecture Overview

| Component | Technology |
|-----------|-----------|
| Discord bot backend | TypeScript / Node.js on Azure Container Apps |
| Persistent storage | Azure Cosmos DB (NoSQL, Serverless) |
| Secrets | Azure Key Vault (Managed Identity access) |
| Observability | Azure Application Insights |
| IaC | Azure Bicep (`infra/`) |
| CI/CD | GitHub Actions (`.github/workflows/`) |

**Primary region:** Central US · **Fallback region:** East US 2

## Docs

- [`docs/brd.md`](docs/brd.md) — Business requirements (WIP)
- [`docs/nfr.md`](docs/nfr.md) — Non-functional requirements
- [`docs/adr/`](docs/adr/) — Architecture decision records
- [`docs/runbooks/`](docs/runbooks/) — Operational procedures

## Quick Start

> Prerequisites: Node.js LTS, Azure CLI, Bicep CLI, Docker

```bash
# Install dependencies
cd app && npm install

# Run locally (requires .env with DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN)
npm run dev

# Build & test
npm run build && npm test
```

## Contributing

See [AGENTS.md](AGENTS.md) for AI agent workflow rules and code conventions.
