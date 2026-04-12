// infra/modules/cosmosDb.bicep
// Provisions Cosmos DB for NoSQL (Serverless) with all required containers.
// Satisfies ADR-0003 and NFR §1 (Managed Identity data plane RBAC).
// Note: role assignment for the Container App identity is done in main.bicep
//       to avoid a circular dependency between cosmosDb and containerApp modules.

@description('Deployment location')
param location string

@description('Cosmos DB account name (globally unique, lowercase, 3–44 chars)')
param accountName string

@description('Database name')
param databaseName string = 'munchassemble'

@description('Environment tag')
param env string = 'dev'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 8
        backupStorageRedundancy: 'Local'
      }
    }
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

module sessionContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-sessions'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'sessions'
    partitionKey: '/guildId'
    // TTL enabled; completed sessions set _ttl = 2592000 (30 days) on the document.
    defaultTtl: -1
  }
}

module participantContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-participants'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'participants'
    partitionKey: '/sessionId'
  }
}

module restaurantContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-restaurants'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'restaurants'
    partitionKey: '/sessionId'
  }
}

module musterContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-musterpoints'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'musterpoints'
    partitionKey: '/guildId'
  }
}

module restaurantOptionContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-restaurantoptions'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'restaurantoptions'
    partitionKey: '/guildId'
  }
}

module favoriteContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-favorites'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'favorites'
    partitionKey: '/guildId'
  }
}

module carpoolContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-carpools'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'carpools'
    partitionKey: '/sessionId'
  }
}

module noPingContainer 'cosmosContainer.bicep' = {
  name: 'cosmos-container-noping'
  params: {
    accountName: cosmosAccount.name
    databaseName: database.name
    containerName: 'noping'
    partitionKey: '/guildId'
  }
}

@description('Cosmos DB account endpoint')
output endpoint string = cosmosAccount.properties.documentEndpoint

@description('Resource ID of the Cosmos DB account')
output resourceId string = cosmosAccount.id

@description('Cosmos DB account name (needed for role assignment in parent template)')
output accountName string = cosmosAccount.name
