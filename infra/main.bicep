// main.bicep (orchestration entrypoint)
// Add modules/resources here.

targetScope = 'resourceGroup'

// Example parameters (replace with your own)
// @description('Deployment location')
param location string = resourceGroup().location

// Example: add modules under ./modules and reference them here
// module storage './modules/storage.bicep' = {
//   name: 'storageDeployment'
//   params: {
//     location: location
//   }
// }
