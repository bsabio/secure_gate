# Secure Gate

AI-driven security middleware for evaluating authentication attempts.

## Workspaces

- `src/` hosts the core Secure-Gate risk engine and AI agent integration.
- `control-plane/` hosts the Next.js dashboard and API layer.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the control-plane app:

```bash
npm run dev
```

Run tests (core engine):

```bash
npm test
```

## Quality Commands

```bash
npm run lint
npm run typecheck
npm run format:check
```

## CI

GitHub Actions runs lint, typecheck, tests, and the control-plane build on every PR.

## Environment

The control plane requires:

- `DATABASE_URL` (SQLite for local dev)

Example:

```bash
export DATABASE_URL="file:./dev.db"
```