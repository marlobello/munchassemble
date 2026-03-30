// infra/modules/cosmosContainer.bicep
// Reusable module for creating a Cosmos DB container with a given partition key.

@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string

@description('Container name')
param containerName string

@description('Partition key path (e.g. /guildId)')
param partitionKey string

@description('Default TTL in seconds. -1 = TTL enabled but per-item only. 0 = disabled (default).')
param defaultTtl int = 0

// Base resource definition without TTL
var baseResource = {
  id: containerName
  partitionKey: {
    paths: [partitionKey]
    kind: 'Hash'
  }
  indexingPolicy: {
    indexingMode: 'consistent'
    automatic: true
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${accountName}/${databaseName}/${containerName}'
  properties: {
    // Use union() to add defaultTtl only when explicitly set (non-zero).
    // Passing null/0 for defaultTtl causes a Cosmos BadRequest.
    resource: defaultTtl != 0 ? union(baseResource, { defaultTtl: defaultTtl }) : baseResource
  }
}
