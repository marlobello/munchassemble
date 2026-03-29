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

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  name: '${accountName}/${databaseName}/${containerName}'
  properties: {
    resource: {
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
  }
}
