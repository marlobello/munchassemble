// infra/modules/webContainerApp.bicep
// Provisions the read-only analytics web Container App (ADR-0006, BRD Phase 4).
// Joins the EXISTING Container Apps Environment created by containerApp.bicep.
// Scale-to-zero (minReplicas:0) keeps idle cost ~$0 (NFR §4). External HTTPS ingress
// is the project's only inbound network boundary; access is gated by Discord OAuth in
// the app layer (NFR §1). Cosmos access uses a separate read-only managed identity.

@description('Deployment location')
param location string

@description('Name of the analytics web Container App')
param appName string

@description('Resource ID of the existing Container Apps Environment to join')
param environmentId string

@description('Name of the existing Container Apps Environment (parent for the managed certificate when a custom domain is set)')
param environmentName string

@description('Container image to deploy (e.g. ghcr.io/owner/munchassemble-web:sha-abc1234)')
param containerImage string

@description('Application Insights connection string (shared with the bot)')
param appInsightsConnectionString string

@description('Cosmos DB endpoint URL (read-only access via managed identity)')
param cosmosEndpoint string

@description('Key Vault name — used to read the Discord OAuth client secret + session secret at runtime')
param keyVaultName string

@description('Discord Guild ID(s) the web app gates access to (comma-separated). Only members may view.')
param discordGuildId string

@description('Discord OAuth2 application (client) ID. Public identifier — not a secret.')
param discordOAuthClientId string = ''

@description('Public base URL of the app (e.g. https://munchassemble.dotheneedful.dev). Used to build the OAuth redirect URI; must match the redirect registered in the Discord developer portal.')
param baseUrl string = ''

@description('Optional custom domain to bind to the web app (e.g. munchassemble.dotheneedful.dev). Empty = use the default azurecontainerapps.io FQDN. Requires the CNAME + asuid TXT DNS records to exist first (see runbooks).')
param customDomain string = ''

@description('Port the web server listens on')
param webPort int = 8080

@description('Environment tag')
param env string = 'prod'

var useCustomDomain = !empty(customDomain)

// Free Azure-managed TLS certificate for the custom domain. Validated via the
// asuid.<host> TXT record + CNAME (domainControlValidation: CNAME). Created on the
// shared Container Apps Environment. Only deployed when a custom domain is configured.
resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource managedCert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (useCustomDomain) {
  parent: managedEnv
  name: 'cert-${replace(customDomain, '.', '-')}'
  location: location
  properties: {
    subjectName: customDomain
    domainControlValidation: 'CNAME'
  }
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: environmentId
    configuration: {
      registries: [] // Public ghcr.io image — no registry credentials needed
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: webPort
        transport: 'auto'
        allowInsecure: false // TLS enforced (NFR §1)
        customDomains: useCustomDomain ? [
          {
            name: customDomain
            bindingType: 'SniEnabled'
            certificateId: managedCert.id
          }
        ] : []
      }
    }
    template: {
      containers: [
        {
          name: 'web'
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
            { name: 'DISCORD_OAUTH_CLIENT_ID', value: discordOAuthClientId }
            { name: 'WEB_BASE_URL', value: baseUrl }
            { name: 'WEB_PORT', value: string(webPort) }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: webPort
              }
              initialDelaySeconds: 5
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        // NFR §3/§4 — request-driven, non-critical analytics view. Scale-to-zero when
        // idle; a single replica comfortably serves the guild (~14 users).
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

@description('Principal ID of the web Container App system-assigned managed identity')
output principalId string = webApp.identity.principalId

@description('Public FQDN of the analytics web app')
output fqdn string = webApp.properties.configuration.ingress.fqdn
