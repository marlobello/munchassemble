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

@description('Optional Discord Guild ID — restricts command registration to one guild (dev only).')
param discordGuildId string = ''

@description('Discord Application ID — not secret; used for registration reference.')
param discordApplicationId string = ''

// ─── Derived names ─────────────────────────────────────────────────────────────

var acrName = 'acr${suffix}${env}'
var cosmosAccountName = 'cosmos-${suffix}-${env}'
var keyVaultName = 'kv-${suffix}-${env}'
var workspaceName = 'log-${suffix}-${env}'
var appInsightsName = 'appi-${suffix}-${env}'
var containerAppsEnvName = 'cae-${suffix}-${env}'
var containerAppName = 'ca-munchassemble-${env}'

// ─── Step 1: Container Registry ───────────────────────────────────────────────

module acr 'modules/containerRegistry.bicep' = {
  name: 'deploy-acr'
  params: {
    location: location
    acrName: acrName
    env: env
  }
}

// ─── Step 2: Application Insights ─────────────────────────────────────────────

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
    acrLoginServer: acr.outputs.loginServer
    discordGuildId: discordGuildId
    discordApplicationId: discordApplicationId
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

// ─── Outputs ──────────────────────────────────────────────────────────────────

@description('ACR login server URL')
output acrLoginServer string = acr.outputs.loginServer

@description('Cosmos DB endpoint')
output cosmosEndpoint string = cosmos.outputs.endpoint

@description('Key Vault URI')
output keyVaultUri string = keyVault.outputs.vaultUri

@description('Application Insights connection string')
output appInsightsConnectionString string = monitoring.outputs.connectionString

@description('Container App managed identity principal ID')
output containerAppPrincipalId string = containerApp.outputs.principalId

