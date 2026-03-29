// infra/modules/kvRoleAssignment.bicep
// Grants Key Vault Secrets User role to a managed identity principal on a Key Vault.

@description('Name of the existing Key Vault')
param keyVaultName string

@description('Principal ID to grant access to')
param principalId string

var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, principalId, kvSecretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
