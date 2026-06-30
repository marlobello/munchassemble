// prod environment parameters
using '../main.bicep'

param location = 'centralus'
param env = 'prod'
param suffix = 'munchassmbl'
param discordGuildId = '734095597342294107,1088522044913754192'
// Discord OAuth2 client ID for the analytics web app (public identifier, not a secret).
// The OAuth *client secret* lives in Key Vault as `discord-oauth-client-secret` (see runbooks).
param discordOAuthClientId = '1487902529982566551'
// Custom domain for the analytics web app. DNS records (CNAME + asuid TXT) must exist
// in Cloudflare before deploying — see docs/runbooks/README.md.
param webCustomDomain = 'munchassemble.dotheneedful.dev'
// Managed TLS cert is two-phase: deploy with false first (registers the hostname), then
// flip to true and redeploy (issues + binds the cert). See docs/runbooks/README.md.
param webEnableManagedCert = true
// containerImage / webContainerImage are set at deploy time by deploy-app.yml / deploy-web.yml — leave as default placeholders here
