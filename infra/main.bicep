// main.bicep — Munch Assemble orchestration entrypoint
// Implements BRD Phase 1–3 infrastructure. See docs/adr/ for architecture decisions.

targetScope = 'resourceGroup'

// ─── Parameters ───────────────────────────────────────────────────────────────

@description('Deployment location. Default: resource group location.')
param location string = resourceGroup().location

@description('Short environment name (dev, prod).')
param env string = 'dev'

@description('Name suffix for all resources (e.g. "munchassmbl"). Lowercase, alphanumeric, ≤12 chars.')
@maxLength(12)
param suffix string

@description('Container image to deploy (e.g. myacr.azurecr.io/munchassemble:1.0.0).')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Analytics web app image (ADR-0006). Set at deploy time by deploy-web.yml.')
param webContainerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Discord OAuth2 application (client) ID for the analytics web app. Public identifier — not a secret.')
param discordOAuthClientId string = ''

@description('Optional custom domain for the analytics web app (e.g. munchassemble.dotheneedful.dev). Empty = use the default azurecontainerapps.io FQDN. Requires DNS records (CNAME + asuid TXT) created first — see docs/runbooks.')
param webCustomDomain string = ''

@description('Managed TLS cert two-phase toggle. Deploy false first (registers the hostname), then true (issues + binds the cert). See docs/runbooks.')
param webEnableManagedCert bool = false

@description('Optional Discord Guild ID — restricts command registration to one guild.')
param discordGuildId string = ''

// ─── Derived names ─────────────────────────────────────────────────────────────

var cosmosAccountName = 'cosmos-${suffix}-${env}'
var keyVaultName = 'kv-${suffix}-${env}'
var workspaceName = 'log-${suffix}-${env}'
var appInsightsName = 'appi-${suffix}-${env}'
var containerAppsEnvName = 'cae-${suffix}-${env}'
var containerAppName = 'ca-munchassemble-${env}'
var webContainerAppName = 'ca-munchassemble-web-${env}'
// Container Apps ingress FQDN is always `<app-name>.<env-default-domain>`, so the web
// app's default public URL is deterministic once the environment exists. When a custom
// domain is configured it takes precedence as the OAuth redirect base.
var webDefaultUrl = 'https://${webContainerAppName}.${containerApp.outputs.environmentDefaultDomain}'
var webBaseUrl = empty(webCustomDomain) ? webDefaultUrl : 'https://${webCustomDomain}'

// ─── Step 1: Application Insights ─────────────────────────────────────────────

module monitoring 'modules/appInsights.bicep' = {
  name: 'deploy-monitoring'
  params: {
    location: location
    workspaceName: workspaceName
    appInsightsName: appInsightsName
    env: env
  }
}

// ─── Step 3: Cosmos DB (no role assignment here — avoids cycle) ───────────────

module cosmos 'modules/cosmosDb.bicep' = {
  name: 'deploy-cosmos'
  params: {
    location: location
    accountName: cosmosAccountName
    env: env
  }
}

// ─── Step 4: Key Vault (no role assignment here — avoids cycle) ───────────────

module keyVault 'modules/keyVault.bicep' = {
  name: 'deploy-keyvault'
  params: {
    location: location
    keyVaultName: keyVaultName
    env: env
  }
}

// ─── Step 5: Container App ────────────────────────────────────────────────────
// Depends on cosmos + monitoring outputs. Creates system-assigned managed identity.

module containerApp 'modules/containerApp.bicep' = {
  name: 'deploy-container-app'
  params: {
    location: location
    envName: containerAppsEnvName
    appName: containerAppName
    containerImage: containerImage
    workspaceResourceId: monitoring.outputs.workspaceId
    appInsightsConnectionString: monitoring.outputs.connectionString
    cosmosEndpoint: cosmos.outputs.endpoint
    keyVaultName: keyVaultName
    discordGuildId: discordGuildId
    env: env
  }
}

// ─── Step 6: Role assignments (after Container App — needs its principal ID) ──

module cosmosRoleAssignment 'modules/cosmosRoleAssignment.bicep' = {
  name: 'assign-cosmos-role'
  params: {
    cosmosAccountName: cosmosAccountName
    principalId: containerApp.outputs.principalId
  }
}

module kvRoleAssignment 'modules/kvRoleAssignment.bicep' = {
  name: 'assign-kv-role'
  params: {
    keyVaultName: keyVaultName
    principalId: containerApp.outputs.principalId
  }
}

// ─── Step 7: Analytics web app (ADR-0006, BRD Phase 4) ───────────────────────
// Joins the shared Container Apps Environment; read-only Cosmos access; Discord-OAuth
// gated in the app layer. Scale-to-zero for cost (NFR §4).

module webApp 'modules/webContainerApp.bicep' = {
  name: 'deploy-web-app'
  params: {
    location: location
    appName: webContainerAppName
    environmentId: containerApp.outputs.environmentId
    environmentName: containerAppsEnvName
    containerImage: webContainerImage
    appInsightsConnectionString: monitoring.outputs.connectionString
    cosmosEndpoint: cosmos.outputs.endpoint
    keyVaultName: keyVaultName
    discordGuildId: discordGuildId
    discordOAuthClientId: discordOAuthClientId
    baseUrl: webBaseUrl
    customDomain: webCustomDomain
    enableManagedCert: webEnableManagedCert
    env: env
  }
}

// ─── Step 8: Web app role assignments (read-only Cosmos + Key Vault secrets) ──

module webCosmosRoleAssignment 'modules/cosmosRoleAssignment.bicep' = {
  name: 'assign-web-cosmos-role'
  params: {
    cosmosAccountName: cosmosAccountName
    principalId: webApp.outputs.principalId
    // Built-in Cosmos read-only data role — least privilege (NFR §1).
    roleDefinitionGuid: '00000000-0000-0000-0000-000000000001'
  }
}

module webKvRoleAssignment 'modules/kvRoleAssignment.bicep' = {
  name: 'assign-web-kv-role'
  params: {
    keyVaultName: keyVaultName
    principalId: webApp.outputs.principalId
  }
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

@description('Cosmos DB endpoint')
output cosmosEndpoint string = cosmos.outputs.endpoint

@description('Key Vault URI')
output keyVaultUri string = keyVault.outputs.vaultUri

@description('Application Insights connection string')
output appInsightsConnectionString string = monitoring.outputs.connectionString

@description('Container App managed identity principal ID')
output containerAppPrincipalId string = containerApp.outputs.principalId

@description('Analytics web app public URL')
output webAppUrl string = 'https://${webApp.outputs.fqdn}'

