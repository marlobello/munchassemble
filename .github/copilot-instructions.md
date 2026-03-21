# Project context (repo-wide)

## Authoritative requirements
- Business requirements: docs/brd.md
- Non-functional requirements (NFR): docs/nfr.md
- Architecture decisions: docs/adr/

## Working agreement
- Treat BRD/NFR as source of truth. If an implementation conflicts, propose a doc change first.
- When making changes, include a short mapping: "Implements BRD §X" and "satisfies NFR §Y".

## Repo layout
- infra/ contains Azure Bicep IaC and modules
- app/ contains application source code and tests

## Definition of done (DoD)
- Update docs (include README.md) if behavior, endpoints, or deployment changes.
- Add/maintain tests for app changes.
- For infra changes: keep Bicep readable; prefer safe defaults and clear parameter naming.

## Verification expectations
- Provide steps to validate changes (build/test for app, what-if/deploy for infra).
