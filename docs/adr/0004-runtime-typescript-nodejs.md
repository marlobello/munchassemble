# ADR 0004: Application Runtime — TypeScript / Node.js

- Status: Accepted
- Date: 2026-03-20

## Context

We need to choose an application language and runtime for the Discord bot backend. Key criteria:
- Ecosystem support for Discord slash command verification and interaction handling
- Fast startup time (contributes to < 2-second latency target, NFR §3)
- Small container image (contributes to cost guardrails, NFR §4)
- Developer familiarity and long-term maintainability

Options considered: TypeScript/Node.js, Python, C#/.NET, Go.

## Decision

Use **TypeScript** running on **Node.js (LTS)**.

- The `discord-interactions` npm package provides request signature verification out of the box.
- TypeScript adds type safety and improves long-term maintainability without sacrificing the Node.js ecosystem.
- Node.js startup is fast (< 200ms for a small app), well within the cold-start budget.
- Alpine-based Node.js images are compact (~150 MB), keeping container pull times low.

## Consequences

- **Build:** Project uses a standard `tsc` compile step; output runs as plain JavaScript in the container.
- **Testing:** Jest is the recommended test runner.
- **Container:** Multi-stage Dockerfile — build stage (full Node image) + runtime stage (node:lts-alpine).
- **NFR impacts:** Supports NFR §3 (fast startup → low latency), NFR §4 (small image → lower storage cost).
