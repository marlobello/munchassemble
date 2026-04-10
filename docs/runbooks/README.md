# Runbooks

Operational procedures for Munch Assemble.

---

## Deploy

Deployment is fully automated via GitHub Actions on push to `main`.

| Changed path | Triggered workflow | What happens |
|---|---|---|
| `app/**` | `deploy-app.yml` | Build Docker image → push to ACR → update Container App revision |
| `infra/**` | `deploy-infra.yml` | `az deployment group create` with Bicep |
| Both | Both workflows run concurrently |

**To trigger manually** (e.g. re-run failed deploy):
```bash
gh workflow run deploy-app.yml --ref main
gh workflow run deploy-infra.yml --ref main
```

---

## Rollback

```bash
# List recent Container App revisions
az containerapp revision list \
  --name <container-app-name> \
  --resource-group <rg-name> \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" \
  --output table

# Activate a previous revision
az containerapp revision activate \
  --name <container-app-name> \
  --resource-group <rg-name> \
  --revision <revision-name>

# Deactivate the broken revision
az containerapp revision deactivate \
  --name <container-app-name> \
  --resource-group <rg-name> \
  --revision <bad-revision-name>
```

---

## Cancel a Stuck Session

If a session is stuck and a new one can't be created:
```
/munchassemble-config session cancel
```
Requires **Manage Server** permission on the Discord server.

---

## View Live Logs

```bash
az containerapp logs show \
  --name <container-app-name> \
  --resource-group <rg-name> \
  --follow
```

Or via Azure Portal: Container App → **Log stream**.

---

## Add/Rotate Secrets

```bash
# Update a secret value
az keyvault secret set \
  --vault-name <kv-name> \
  --name discord-bot-token \
  --value <new-token>

# Container App picks up Key Vault secrets on restart — restart to apply:
az containerapp revision restart \
  --name <container-app-name> \
  --resource-group <rg-name> \
  --revision <revision-name>
```

---

## Bot Permission Issues

If the bot posts `DiscordAPIError[50001]: Missing Access`, it lacks channel permissions.

**Fix:** In Discord server → planning channel → Edit Channel → Permissions → add the bot's role with:
- ✅ View Channels
- ✅ Send Messages
- ✅ Read Message History

---

## First-Time Server Setup

After inviting the bot and deploying, configure the guild's pick lists:

```
/munchassemble-config musterpoint add Garage A
/munchassemble-config musterpoint add Garage B
/munchassemble-config musterpoint add Main Lobby

/munchassemble-config restaurant add Chipotle
/munchassemble-config restaurant add Sushi Place
/munchassemble-config restaurant add Panda Express
```

