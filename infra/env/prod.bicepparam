// prod environment parameters
using '../main.bicep'

param location = 'centralus'
param env = 'prod'
param suffix = 'munchassmbl'
param discordGuildId = '' // leave empty to register commands in all guilds
// param containerImage = 'acrmunchasssmblprod.azurecr.io/munchassemble:<tag>'  // set at deploy time
