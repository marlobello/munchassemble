# Infrastructure (Azure Bicep)

## Layout
- main.bicep: orchestration entrypoint
- modules/: reusable modules
- env/: environment parameter files (dev/test/prod)

## Notes
- Keep repo-level Bicep configuration in infra/bicepconfig.json.
- CI and release workflows use Bicep CLI 0.48.1.
- Stable management API versions: Container Apps 2026-07-01, Cosmos DB
  2026-03-15, Key Vault 2026-05-15, and Log Analytics 2026-03-01.
  Application Insights 2020-02-02 and role assignments 2022-04-01 remain current.
- API upgrades preserve existing managed identities, role scopes, resource
  names, SKUs, replica limits, retention, and TLS bindings (NFR sections 1, 2, 4, 6).
- The production infrastructure workflow reads and passes both running container
  images; a redeploy must never replace a released app with a placeholder image.
- For local validation, run `az bicep build --file infra/main.bicep`, then use
  the production what-if procedure in `docs/runbooks/README.md`.
