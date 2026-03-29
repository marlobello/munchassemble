// infra/modules/appInsights.bicep
// Provisions Log Analytics Workspace + Application Insights (workspace-based).
// Satisfies NFR §5 (monitoring) and NFR §4 (30-day retention, sampling).

@description('Deployment location')
param location string

@description('Name for the Log Analytics workspace')
param workspaceName string

@description('Name for the Application Insights resource')
param appInsightsName string

@description('Environment tag')
param env string = 'dev'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    SamplingPercentage: 20 // NFR §4 — keep ingestion low
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

@description('Application Insights connection string')
output connectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key')
output instrumentationKey string = appInsights.properties.InstrumentationKey

@description('Resource ID of the Application Insights component')
output resourceId string = appInsights.id
