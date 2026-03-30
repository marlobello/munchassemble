# System Architecture

> High-level overview of the Munch Assemble production deployment on Azure.

## Component Diagram

```mermaid
graph TD
    subgraph Discord
        GW[Discord Gateway\nWebSocket]
        API[Discord REST API]
        PANEL[Session Panel Message\nComponents v2]
    end

    subgraph Azure["Azure (rg-munchassemble-prod)"]
        subgraph CAE[Container Apps Environment]
            BOT[munchassemble-bot\nNode.js + TypeScript\nContainer App\nminReplicas: 1]
        end
        KV[Key Vault\nkv-munchassmbl-prod\ndiscord-bot-token]
        COSMOS[Cosmos DB\ncosmos-munchassmbl-prod\nServerless]
        AI[Application Insights\n+ Log Analytics]
    end

    subgraph GHCR[GitHub Container Registry]
        IMAGE[ghcr.io/marlobello/\nmunchassemble-bot]
    end

    subgraph CI["GitHub Actions (CI/CD)"]
        INFRA_WF[deploy-infra.yml\nBicep → Azure]
        APP_WF[deploy-app.yml\nDocker Build → ghcr.io\n→ Container App revision]
    end

    BOT -- "WebSocket (gateway)" --> GW
    BOT -- "HTTPS (REST)" --> API
    BOT -- "reads token at startup" --> KV
    BOT -- "reads/writes" --> COSMOS
    BOT -- "traces + logs" --> AI
    API -- "delivers interactions" --> BOT
    GW -- "gateway events" --> BOT
    PANEL -- "button/select interactions" --> BOT
    BOT -- "edit message / send replies" --> PANEL

    INFRA_WF -- "az deployment" --> Azure
    APP_WF -- "push image" --> IMAGE
    IMAGE -- "pulled on deploy" --> BOT
```

## Runtime Data Flow

```mermaid
sequenceDiagram
    participant User as Discord User
    participant Panel as Session Panel
    participant Bot as Container App (Bot)
    participant DB as Cosmos DB

    User->>Panel: clicks button (e.g. ✅ In)
    Panel->>Bot: POST interaction webhook
    Bot->>DB: read session + participant
    Bot->>DB: write updated participant
    Bot->>DB: read all session data
    Bot->>Panel: PATCH message (interaction.update)
    Panel-->>User: panel refreshes in-place
```

## Infrastructure Components

| Component | SKU / Config | Purpose |
|---|---|---|
| Container App | Consumption, minReplicas=1, always-on | Hosts the bot process |
| Container Apps Env | Consumption | Networking envelope |
| Cosmos DB | Serverless, 3 containers | Persistent session/participant/restaurant/carpool data |
| Key Vault | Standard | Stores `discord-bot-token` secret |
| App Insights | Pay-as-you-go | Traces, logs, live metrics |
| Log Analytics Workspace | Pay-as-you-go | Backend for App Insights |
| Container Registry | **None** — uses ghcr.io (public) | Image hosting |

## Security Model

```mermaid
graph LR
    BOT[Container App\nManaged Identity] -->|Key Vault Secrets User| KV[Key Vault]
    BOT -->|Cosmos DB Built-in Data Contributor| COSMOS[Cosmos DB]
    KV -->|reads discord-bot-token| BOT
    BOT -->|bot token auth| DISCORD[Discord API]
```

- All Azure service access uses **Managed Identity** — no stored credentials or connection strings.
- Bot token is retrieved from Key Vault at startup via `DefaultAzureCredential`.
- No inbound network exposure: bot connects **outbound** to Discord's gateway (WebSocket) and REST API.

## Deployment Pipeline

```mermaid
flowchart LR
    PR[Pull Request\nto main] --> CI_TEST[npm test\n24 unit tests]
    CI_TEST --> MERGE[Merge to main]
    MERGE --> DETECT{changed paths}
    DETECT -- "app/**" --> APP_PIPE[deploy-app.yml\nDocker build + push\n→ update CA revision]
    DETECT -- "infra/**" --> INFRA_PIPE[deploy-infra.yml\nBicep what-if\n→ az deployment]
```

## Source Code Layout

```
munchassemble/
├── app/
│   ├── src/
│   │   ├── commands/          # Slash command definitions (/munchassemble)
│   │   ├── db/
│   │   │   ├── cosmosClient.ts
│   │   │   └── repositories/  # Data access layer (participantRepo, carpoolRepo, …)
│   │   ├── interactions/      # Discord interaction handlers (attendanceHandler, carpoolHandler, …)
│   │   ├── services/          # Business logic (carpoolService, restaurantService, …)
│   │   ├── types/             # Shared TypeScript interfaces + enums
│   │   ├── ui/
│   │   │   └── panelBuilder.ts  # Components v2 panel construction
│   │   └── utils/
│   │       ├── panelRefresh.ts  # Shared panel update utility
│   │       ├── permissions.ts   # Creator/admin checks
│   │       ├── scheduler.ts     # T-15/T-5 reminder cron jobs
│   │       └── stateRules.ts    # Attendance/transport state machine rules
│   └── tests/
│       └── unit/              # Jest unit tests (24 tests)
├── infra/
│   ├── main.bicep             # Top-level orchestration
│   ├── modules/               # Reusable Bicep modules (cosmos, keyvault, containerapp, …)
│   └── env/
│       └── prod.bicepparam    # Production environment parameters
└── docs/
    ├── brd.md                 # Business requirements
    ├── nfr.md                 # Non-functional requirements
    ├── erd.md                 # Entity relationship diagram ← this file's sibling
    ├── state-machine.md       # Attendance/transport state machine
    ├── architecture.md        # This file
    ├── user-journeys.md       # Step-by-step user flows
    ├── adr/                   # Architecture Decision Records
    └── runbooks/              # Operational runbooks
```
