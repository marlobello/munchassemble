// dev environment parameters
using '../main.bicep'

param location = 'centralus'
param env = 'dev'
param suffix = 'munchassmbl'
param discordGuildId = '' // set to your Discord guild ID for dev to scope command registration
param discordApplicationId = '' // fill in your Discord Application ID (from discord.com/developers)
