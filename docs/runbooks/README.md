# Runbooks

Operational procedures for Munch Assemble.

---

## Deploy

Deployment is fully automated via GitHub Actions on push to `main`.

| Changed path | Triggered workflow | What happens |
|---|---|---|
| `app/**` | `deploy-app.yml` | Build Docker image → push to GHCR → update **bot** Container App revision |
| `app/**` | `deploy-web.yml` | Build `Dockerfile.web` image → push to GHCR → update **analytics web** Container App revision |
| `infra/**` | `deploy-infra.yml` | `az deployment group create` with Bicep |
| Both | Both workflows run concurrently |

**To trigger manually** (e.g. re-run failed deploy):
```bash
gh workflow run deploy-app.yml --ref main
gh workflow run deploy-web.yml --ref main
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

---

## Empty "No Response" List on the Panel

**Symptom:** The `❓ No Response` line on the panel is blank even though guild members
have not RSVPed (e.g. a member named "Andy" never shows up).

**Cause:** The guild member roster is cached once at startup (`ClientReady`). After a
gateway resume/reconnect `ClientReady` does not re-fire, so the cache can silently
empty out on a long-lived process. `fetchNoResponseNames` then has no members to list.

**Mitigation (in code):** `fetchNoResponseNames` now lazily re-fetches the roster when
the cache is empty, throttled to once per 60s per guild. Confirm via logs:

```bash
az containerapp logs show -n ca-munchassemble-prod -g rg-munchassemble-prod \
  --tail 100 --type console | grep -i "member cache\|Re-fetched"
```

**If it persists:** restart the revision to force a full roster fetch, and verify the
**Server Members Intent** is enabled in the Discord Developer Portal (Bot → Privileged
Gateway Intents).

---

## Analytics Web App (Phase 4, ADR-0006)

The read-only analytics web app (`ca-munchassemble-web-prod`) runs scale-to-zero in the
shared Container Apps Environment and is gated by Discord OAuth (BR-070).

### One-time Discord OAuth setup

1. Discord Developer Portal → your application → **OAuth2**.
2. Under **Redirects**, add: `https://munchassemble.dotheneedful.dev/auth/callback`
   (the custom domain; if no custom domain is configured use the default FQDN from the
   Bicep output `webAppUrl`).
3. Copy the **Client ID** → set the `discordOAuthClientId` Bicep param (it is public, not a secret).
4. Reset/copy the **Client Secret** and store it in Key Vault:
   ```bash
   az keyvault secret set --vault-name kv-munchassmbl-prod \
     --name discord-oauth-client-secret --value <oauth-client-secret>
   ```
5. Create the session-cookie signing secret (any long random string):
   ```bash
   az keyvault secret set --vault-name kv-munchassmbl-prod \
     --name web-session-secret --value "$(openssl rand -hex 32)"
   ```
6. Restart the web revision to pick up Key Vault changes:
   ```bash
   az containerapp revision restart -n ca-munchassemble-web-prod -g rg-munchassemble-prod \
     --revision <revision-name>
   ```

> The web app's managed identity holds only the **read-only** Cosmos data role and the
> **Key Vault Secrets User** role — it can read the OAuth/session secrets and query data
> but cannot mutate coordination data (NFR §1, BR-076).

### Custom domain (munchassemble.dotheneedful.dev)

The web app binds a custom domain with a **free Azure-managed TLS certificate**
(`webCustomDomain` param). Azure validates domain control via DNS, so the two records
below must exist **before** the infra deploy (the managed cert won't issue otherwise).

Create these in Cloudflare DNS (set both to **DNS only / grey cloud** during issuance —
Cloudflare's proxy interferes with managed-cert validation):

| Type | Name | Value |
|---|---|---|
| CNAME | `munchassemble` | `ca-munchassemble-web-prod.happyriver-2952c918.centralus.azurecontainerapps.io` |
| TXT | `asuid.munchassemble` | `<web app customDomainVerificationId>` |

The verification token is subscription-wide; read it from any Container App:
```bash
az containerapp show -n ca-munchassemble-prod -g rg-munchassemble-prod \
  --query properties.customDomainVerificationId -o tsv
```

Container Apps managed certificates require a **two-phase deploy** (Azure must see the
hostname registered on the app before it will issue the cert). The `webEnableManagedCert`
param controls this:

**Phase 1** — `webEnableManagedCert = false` (default): registers the hostname on the web
app (bindingType `Disabled`). Deploy:
```bash
gh workflow run deploy-infra.yml --ref main
```

**Phase 2** — set `webEnableManagedCert = true` in `infra/env/prod.bicepparam`, commit,
and deploy again: issues the managed cert and binds it (`SniEnabled`):
```bash
gh workflow run deploy-infra.yml --ref main
```

Verify binding + cert state:
```bash
az containerapp show -n ca-munchassemble-web-prod -g rg-munchassemble-prod \
  --query "properties.configuration.ingress.customDomains" -o json
```

> Optional: after the cert is issued and bound, you may re-enable the Cloudflare proxy
> (orange cloud) with SSL mode **Full (strict)** — the Azure managed cert is publicly
> trusted, so strict origin validation succeeds.

### Access denied for a legitimate user

The user must be a member of one of the guilds in `DISCORD_GUILD_ID`. Confirm membership
in Discord; the app calls `/users/@me/guilds` and checks for an overlap.

### Deploy / rollback

Same as the bot, but target `ca-munchassemble-web-prod` (see Deploy / Rollback above).

