# Application

The Discord gateway bot and read-only analytics server share a TypeScript codebase.
Use Node 26 (see `.node-version`) and install the locked dependencies with `npm ci`.

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run audit
```

`npm run dev` starts the bot; `npm run dev:web` starts analytics. Configure local
environment variables using `.env.example`, or use Azure CLI authentication for
managed-identity-compatible Azure SDK development. Never commit credentials.

Discord modals use label components, while OAuth user/guild calls use REST v10.
node-cron 4 schedules one-shot reminders and destroys cancelled registrations.
TypeScript stays on 6.0.x to match the supported TypeScript ESLint/ts-jest range.
Tests use Jest 30; `typecheck` checks test types independently of transpilation.

Implements BRD section 3 (BR-001, BR-030, BR-051, BR-060 through BR-065,
BR-070 through BR-076); satisfies NFR sections 1, 2, and 6.
