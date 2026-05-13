# Secure Gate Control Plane

Next.js dashboard and API layer for Secure-Gate evaluations.

## Local Development

```bash
npm install
npm run dev
```

## API

- `POST /api/evaluate` evaluates a request and persists the result.
- `GET /api/evaluations` lists recent evaluations.

## Environment

- `DATABASE_URL` is required (SQLite in dev).

```bash
export DATABASE_URL="file:./dev.db"
```

## Commands

```bash
npm run lint
npm run typecheck
npm run build
```
