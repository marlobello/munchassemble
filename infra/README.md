# Infrastructure (Azure Bicep)

## Layout
- main.bicep: orchestration entrypoint
- modules/: reusable modules
- env/: environment parameter files (dev/test/prod)

## Notes
- Keep repo-level Bicep configuration in infra/bicepconfig.json.
