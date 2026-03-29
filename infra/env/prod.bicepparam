// prod environment parameters
using '../main.bicep'

param location = 'centralus'
param env = 'prod'
param suffix = 'munchassmbl'
param discordGuildId = '' // right-click your server in Discord → Copy Server ID (requires Developer Mode)
// containerImage is set at deploy time by deploy-app.yml — leave as default placeholder here
