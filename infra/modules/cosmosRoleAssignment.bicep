// infra/modules/cosmosRoleAssignment.bicep
// Grants Cosmos DB Built-in Data Contributor to a managed identity principal.

@description('Name of the existing Cosmos DB account')
param cosmosAccountName string

@description('Principal ID to grant access to')
param principalId string

@description('Cosmos SQL built-in data role GUID. Defaults to Data Contributor (read/write). Use 00000000-0000-0000-0000-000000000001 for read-only.')
param roleDefinitionGuid string = '00000000-0000-0000-0000-000000000002'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource roleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, principalId, roleDefinitionGuid)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${roleDefinitionGuid}'
    principalId: principalId
    scope: cosmosAccount.id
  }
}
