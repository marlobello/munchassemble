// infra/modules/containerApp.bicep
// Provisions the Container Apps environment + the Munch Assemble bot Container App.
// Satisfies ADR-0002 (hosting) and NFR §3 (latency), NFR §4 (cost).
// Image is pulled from public ghcr.io — no registry credentials needed.

@description('Deployment location')
param location string

@description('Name of the Container Apps environment')
param envName string

@description('Name of the Container App')
param appName string

@description('Container image to deploy (e.g. ghcr.io/owner/munchassemble:sha-abc1234)')
param containerImage string

@description('Log Analytics workspace resource ID (for Container Apps environment logs)')
param workspaceResourceId string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Cosmos DB endpoint URL')
param cosmosEndpoint string

@description('Key Vault name (used to set KEY_VAULT_NAME env var)')
param keyVaultName string

@description('Discord Guild ID (optional; set to restrict slash command registration to one guild)')
param discordGuildId string = ''

@description('Environment tag')
param env string = 'prod'

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(workspaceResourceId, '2023-09-01').customerId
        sharedKey: listKeys(workspaceResourceId, '2023-09-01').primarySharedKey
      }
    }
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppsEnv.id
    configuration: {
      registries: [] // Public ghcr.io image — no registry credentials needed
      activeRevisionsMode: 'Single'
    }
    template: {
      containers: [
        {
          name: 'bot'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: env }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
            { name: 'DISCORD_GUILD_ID', value: discordGuildId }
            { name: 'HEALTH_PORT', value: '3000' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1 // NFR §3 — no cold starts; keep WebSocket alive
        maxReplicas: 3 // NFR §4 — cap cost
      }
    }
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

@description('Principal ID of the Container App system-assigned managed identity')
output principalId string = containerApp.identity.principalId
