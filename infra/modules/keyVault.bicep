// infra/modules/keyVault.bicep
// Provisions Azure Key Vault (Standard tier). Satisfies NFR §1.
// Note: role assignment for the Container App identity is done in main.bicep
//       after the Container App is deployed and its principal ID is known.

@description('Deployment location')
param location string

@description('Name of the Key Vault (globally unique, 3–24 chars)')
param keyVaultName string

@description('Environment tag')
param env string = 'dev'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

@description('URI of the Key Vault')
output vaultUri string = keyVault.properties.vaultUri

@description('Resource ID of the Key Vault')
output resourceId string = keyVault.id
