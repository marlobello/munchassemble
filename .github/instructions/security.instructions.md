---
applyTo: "**/*"
---

## Security / compliance
- Never introduce secrets into code or config committed to the repo.
- Prefer Azure Managed Identities for all intra-app communications. Avoid key-based authentication if possible.
- Follow security best practices as outlined by Microsoft and NIST. This is not a regulated application, but should follow most security practices. When a security recommendation conflicts with cost control, ask the user to make a decision.
- If a change alters authn/authz, encryption, network boundaries, or logging/audit, update docs/nfr.md and docs/runbooks.
