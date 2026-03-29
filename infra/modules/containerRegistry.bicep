// infra/modules/containerRegistry.bicep
// Provisions an Azure Container Registry for storing the bot container image.

@description('Deployment location')
param location string

@description('Name of the container registry (must be globally unique, lowercase alphanumeric, 5–50 chars)')
param acrName string

@description('Environment tag (dev, prod, etc.)')
param env string = 'dev'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
  tags: {
    environment: env
    project: 'munchassemble'
  }
}

@description('Login server URL of the container registry')
output loginServer string = acr.properties.loginServer

@description('Resource ID of the container registry')
output resourceId string = acr.id
