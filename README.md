# RipenFlow Madrid

Base lista para trabajar con:

- TypeScript
- React sobre Vite
- TanStack Router + TanStack Query
- Postgres + Drizzle
- Bun como runtime y package manager
- Biome para lint y formato

## Requisitos

- Bun `>= 1.3`
- Una base Postgres accesible desde `DATABASE_URL`

## Arranque

```bash
cp .env.example .env
bun install
bun dev
```

## Scripts

```bash
bun run dev
bun run build
bun run lint
bun run format
bun run db:generate
bun run db:migrate
bun run db:studio
```

## Base de datos

La configuracion de Drizzle vive en `drizzle.config.ts`.

El schema inicial esta en `db/schema.ts` con una tabla `leads` de ejemplo.

## Estructura

```text
src/
  lib/
  main.tsx
  router.tsx
db/
  client.ts
  schema.ts
  migrations/
```
