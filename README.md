# Munch Assemble

A Discord bot that helps a group coordinate a same-day (or future) lunch outing via a single self-updating session panel in Discord. Invoke `/munchassemble` to create a session, then the group can RSVP, vote on a restaurant, coordinate carpools, and set muster points — all without chat chaos.

## Architecture Overview

| Component | Technology |
|-----------|-----------|
| Discord bot backend | TypeScript / Node.js on Azure Container Apps |
| Bot connection | discord.js Gateway WebSocket (ADR-0005) |
| Persistent storage | Azure Cosmos DB for NoSQL (Serverless, 6 containers) |
| Secrets | Azure Key Vault (Managed Identity access) |
| Observability | Azure Application Insights |
| Container registry | Azure Container Registry |
| IaC | Azure Bicep (`infra/`) |
| CI/CD | GitHub Actions (`.github/workflows/`) |

**Primary region:** Central US · **Fallback region:** East US 2

## Features

| Phase | Features | Status |
|---|---|---|
| Phase 1 (MVP) | `/munchassemble`, RSVP (In/Maybe/Out), restaurant voting + favorites, live panel, lock/finalize, ping unanswered | ✅ Built |
| Phase 2 | Carpool coordination, muster points, `/munchassemble-config` | 🔜 Next |
| Phase 3 | Smart reminders (T-15, T-5), auto-assign rides | 🔜 Later |

## Docs

- [`docs/brd.md`](docs/brd.md) — Business requirements (BR-001 → BR-063)
- [`docs/nfr.md`](docs/nfr.md) — Non-functional requirements
- [`docs/adr/`](docs/adr/) — Architecture decision records (see ADR-0005 for bot architecture)
- [`docs/runbooks/`](docs/runbooks/) — Operational procedures

## Required Secrets (Key Vault / `.env`)

| Secret name | Description |
|---|---|
| `discord-bot-token` | Discord bot token from Developer Portal |
| `discord-application-id` | Discord application ID |
| `cosmos-endpoint` | Cosmos DB account endpoint URL |

For local dev, copy `app/.env.example` to `app/.env` and fill in the values.

## Quick Start (Local Dev)

> Prerequisites: Node.js LTS, Azure CLI, Docker

```bash
# Install dependencies
cd app && npm install

# Copy and fill in .env
cp .env.example .env

# Run locally (connects to Discord Gateway)
npm run dev

# Build & test
npm run build && npm test
```

## Infrastructure Deployment

> Prerequisites: Azure CLI, Bicep CLI, an Azure subscription

```bash
# 1. Create resource group
az group create --name rg-munchassemble-dev --location centralus

# 2. What-if preview
az deployment group what-if \
  --resource-group rg-munchassemble-dev \
  --template-file infra/main.bicep \
  --parameters infra/env/dev.bicepparam

# 3. Deploy
az deployment group create \
  --resource-group rg-munchassemble-dev \
  --template-file infra/main.bicep \
  --parameters infra/env/dev.bicepparam

# 4. Add secrets to Key Vault (first time only)
KV=$(az deployment group show -g rg-munchassemble-dev -n <deploy-name> --query 'properties.outputs.keyVaultUri.value' -o tsv)
az keyvault secret set --vault-name <kv-name> --name discord-bot-token --value <token>
az keyvault secret set --vault-name <kv-name> --name discord-application-id --value <app-id>
```

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application.
2. Add a Bot. Under **Privileged Gateway Intents**, enable **Server Members Intent** (needed for Ping Unanswered).
3. Generate an invite URL with scopes `bot` + `applications.commands` and permissions: View Channels, Send Messages, Read Message History, Use Application Commands.
4. Invite the bot to your server.
5. Store the **Bot Token** and **Application ID** in Key Vault (see above).

## CI/CD

GitHub Actions workflows (requires Azure OIDC federated credentials set up):

| Workflow | Trigger | Action |
|---|---|---|
| `ci.yml` | PRs + pushes | Build, test, Bicep lint |
| `deploy-infra.yml` | Infra changes on `main` | Bicep what-if (PR) / deploy (merge) |
| `deploy-app.yml` | App changes on `main` | Build image → push ACR → update Container App |

**Required GitHub secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

## Contributing

See [AGENTS.md](AGENTS.md) for AI agent workflow rules and code conventions.

