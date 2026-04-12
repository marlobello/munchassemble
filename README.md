# Munch Assemble

A Discord bot that coordinates same-day (or future) lunch outings for a group. One `/munchassemble` command creates a live session panel — everyone RSVPs, picks a restaurant from the configured list, coordinates carpools and muster points, all in one self-updating Discord message.

## How It Works

The bot posts a single **session panel** message that updates in-place with every interaction. No chat spam — everyone works from the same card.

```
📅 Lunch Session — Friday Apr 11
⏰ Lunch 11:15 | Depart 11:00

✅ Attendance
  In:    Alex, Jordan, Sam
  Maybe: Casey
  Out:   Riley

🍔 Restaurant (voting open)
  Chipotle ████ 3 votes
  Sushi Place ██ 1 vote
  [Vote]  [➕ Suggest Spot]  [🔒 Lock Choice]

  When votes are tied (2+ spots at equal votes > 0):
  [Vote]  [➕ Suggest Spot]  [🎲 Tie Break]

🚗 Transportation
  [🚗 Can Drive]  [🚌 Need Ride]  [🚘 Driving Alone]
  Sam → Garage A (2/3 seats) → Jordan

⚙️ Admin
  [🔒 Finalize]  [🔔 Ping Unanswered]  [✏️ Edit Time]  [⚡ Auto Assign]
```

### User Flow

1. **Anyone runs `/munchassemble create`** — fills in a modal (date, times, notes) → panel posts to channel.
2. **Anyone taps I'm In / Maybe / Out** → panel updates instantly with their name.
3. **Anyone taps Vote** → selects from the restaurant list → panel vote count updates.
4. **Anyone taps ➕ Suggest Spot** → picks from the admin-configured restaurant list → added to the vote.
5. **Drivers tap 🚗 Can Drive** → modal asks for seats + muster point (from configured list) → carpool appears on panel.
6. **Riders tap 🚌 Need Ride** → choose a driver from a list of available rides → assigned under that driver on panel.
7. **Admin taps 🔒 Finalize** → panel locks; bot posts a summary to the channel.
8. **Bot auto-posts reminders** at T-15 and T-5 minutes before departure.

---

## Commands

### `/munchassemble`

Available to **all users**. Subcommands:

| Subcommand | Description |
|---|---|
| `/munchassemble create` | Kick off a new lunch session (opens a modal for date/time/notes) |
| `/munchassemble status` | Show a live snapshot of the current planning session (attendance, votes, carpools) |
| `/munchassemble history list` | Show the last 10 completed sessions (date, restaurant, attendee count) |
| `/munchassemble history details <date>` | Show the full attendee list and details for a session on a given date (YYYY-MM-DD) |

> Only one active session per server at a time. `/munchassemble create` returns an error if a session is already active.

#### `/munchassemble create` modal fields

| Field | Default | Description |
|---|---|---|
| Date | Today | Session date (e.g. `2026-04-11`) |
| Lunch Time | `11:15` | Time group arrives at restaurant (24h HH:MM) |
| Departure Time | `11:00` | Time group departs muster points (24h HH:MM) |
| Notes | _(blank)_ | Optional free-text note shown on the panel |

---

### `/munchassemble-config`

Requires the **Mod** role or **Manage Server** permission. Manages persistent server configuration stored in Cosmos DB.

#### `session`

| Subcommand | Description |
|---|---|
| `/munchassemble-config session cancel` | Cancels the current active session so a new one can be created |

#### `musterpoint`

Muster points are named pickup/meeting locations that drivers and riders choose from (e.g. "Garage A", "Main Lobby").

| Subcommand | Description |
|---|---|
| `/munchassemble-config musterpoint add <name>` | Add a muster point to the list |
| `/munchassemble-config musterpoint remove <name>` | Remove a muster point from the list |
| `/munchassemble-config musterpoint list` | Show all configured muster points |

> Drivers select their muster point when they click **Can Drive**. Riders see it next to each driver when they click **Need Ride**.

#### `restaurant`

The restaurant pick list is the only source restaurants can be added from. Users cannot type free-form restaurant names.

| Subcommand | Description |
|---|---|
| `/munchassemble-config restaurant add <name>` | Add a restaurant to the pick list |
| `/munchassemble-config restaurant remove <name>` | Remove a restaurant from the pick list |
| `/munchassemble-config restaurant list` | Show all configured restaurants |

> When a user taps **➕ Suggest Spot**, they see a select menu of restaurants from this list that haven't been added to the current session yet.

#### `noping`

Manage users who are permanently excluded from the **🔔 Ping Unanswered** reminder. Useful for members who never attend but are still in the server.

| Subcommand | Description |
|---|---|
| `/munchassemble-config noping add <user>` | Exclude a user from Ping Unanswered reminders |
| `/munchassemble-config noping remove <user>` | Re-include a user in Ping Unanswered reminders |
| `/munchassemble-config noping list` | List all users currently excluded from pings |

---

## Panel Buttons Reference

| Button | Who | What it does |
|---|---|---|
| ✅ I'm In | Anyone | Mark yourself attending; auto-promotes Unset to In |
| 🤔 Maybe | Anyone | Mark yourself as maybe |
| ❌ I'm Out | Anyone | Mark yourself out; clears your vote and transport |
| 🍔 Vote | Anyone In/Maybe | Pick your preferred restaurant from a select menu |
| ➕ Suggest Spot | Anyone In/Maybe | Suggest a restaurant from the configured list to add to the vote |
| 🔒 Lock Choice | Creator/Admin | Lock the winning restaurant; disables voting |
| 🎲 Tie Break | Creator/Admin | Appears instead of Lock Choice when 2+ spots are tied; randomly picks a winner and locks it |
| 🚗 Can Drive | In only | Register as a driver (modal: seats + muster point) |
| 🚌 Need Ride | In/Maybe | Select a driver, or be queued if none available |
| 🚘 Driving Alone | In/Maybe | Mark yourself as driving independently |
| 🔒 Finalize Plan | Creator/Admin | Lock the session and post a summary |
| 🔔 Ping Unanswered | Creator/Admin | Mention all members who haven't RSVPed |
| ✏️ Edit Time | Creator/Admin | Update lunch time and departure time |
| ⚡ Auto Assign | Creator/Admin | Auto-distribute unassigned riders across available drivers |

---

## Architecture Overview

| Component | Technology |
|---|---|
| Discord bot backend | TypeScript / Node.js on Azure Container Apps |
| Bot connection | discord.js Gateway WebSocket (ADR-0005) |
| Persistent storage | Azure Cosmos DB for NoSQL (Serverless) |
| Secrets | Azure Key Vault (Managed Identity access) |
| Observability | Azure Application Insights |
| Container registry | Azure Container Registry |
| IaC | Azure Bicep (`infra/`) |
| CI/CD | GitHub Actions (`.github/workflows/`) |

**Primary region:** Central US · **Fallback region:** East US 2

**Cosmos DB containers:** `sessions`, `participants`, `restaurants`, `carpools`, `musterpoints`, `restaurantoptions`

---

## Docs

- [`docs/brd.md`](docs/brd.md) — Business requirements (BR-001 → BR-063)
- [`docs/nfr.md`](docs/nfr.md) — Non-functional requirements
- [`docs/adr/`](docs/adr/) — Architecture decision records
- [`docs/runbooks/`](docs/runbooks/) — Operational procedures
- [`docs/user-journeys.md`](docs/user-journeys.md) — Step-by-step user flows with sequence diagrams

---

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application.
2. **Bot tab** → Enable **Server Members Intent** (needed for Ping Unanswered).
3. **OAuth2 → URL Generator** → scopes: `bot` + `applications.commands` → Bot Permissions:
   - ✅ View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Use Application Commands
4. Copy the generated URL → invite the bot to your server.
5. Grant **View Channels** + **Send Messages** on the planning channel (channel-level override recommended).
6. Store the **Bot Token** and **Application ID** in Key Vault (see below).

---

## Required Secrets (Key Vault / `.env`)

| Secret name | Description |
|---|---|
| `discord-bot-token` | Discord bot token from Developer Portal |
| `discord-application-id` | Discord application ID |
| `cosmos-endpoint` | Cosmos DB account endpoint URL |

For local dev, copy `app/.env.example` to `app/.env` and fill in the values.

---

## Quick Start (Local Dev)

> Prerequisites: Node.js LTS, Azure CLI

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

---

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
az keyvault secret set --vault-name <kv-name> --name discord-bot-token --value <token>
az keyvault secret set --vault-name <kv-name> --name discord-application-id --value <app-id>
az keyvault secret set --vault-name <kv-name> --name cosmos-endpoint --value <endpoint>
```

---

## CI/CD

GitHub Actions workflows (requires Azure OIDC federated credentials):

| Workflow | Trigger | Action |
|---|---|---|
| `ci.yml` | PRs + pushes to `main` | Build, test, Bicep lint |
| `deploy-infra.yml` | Infra file changes on `main` | Bicep what-if (PR) / deploy (push) |
| `deploy-app.yml` | App file changes on `main` | Build image → push ACR → update Container App |

**Required GitHub secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`

---

## Contributing

See [AGENTS.md](AGENTS.md) for AI agent workflow rules and code conventions.

