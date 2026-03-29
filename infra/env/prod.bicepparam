// prod environment parameters
using '../main.bicep'

param location = 'centralus'
param env = 'prod'
param suffix = 'munchassmbl'
param discordGuildId = '734095597342294107,1088522044913754192'
// containerImage is set at deploy time by deploy-app.yml — leave as default placeholder here
