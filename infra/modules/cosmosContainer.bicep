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

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${accountName}/${databaseName}/${containerName}'
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [partitionKey]
        kind: 'Hash'
      }
      // TTL: -1 = feature enabled, items expire only when _ttl is set on the document.
      // Omit the field (0) to disable TTL entirely for containers that don't need it.
      defaultTtl: defaultTtl == 0 ? null : defaultTtl
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
      }
    }
  }
}
