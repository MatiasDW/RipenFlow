# RipenFlow

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
bun run dev
```

## Produccion local

```bash
cp .env.example .env
bun install
bun run build
bun run db:migrate:deploy
bun run start
```

El server de produccion sirve el frontend compilado desde `dist/` y expone:

- `GET /health`: healthcheck liviano del proceso
- `GET /api/health`: verificacion de conectividad con PostgreSQL

## Docker

```bash
docker compose up --build
```

Servicios:

- app: `http://localhost:5173`
- postgres: `localhost:5432`

Docker Compose toma `POSTGRES_PASSWORD` desde tu entorno o usa `postgres` por defecto.
La app dentro de Docker usa `DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@db:5432/ripenflow`.

## Scripts

```bash
bun run dev
bun run build
bun run start
bun run lint
bun run format
bun run db:generate
bun run db:migrate
bun run db:migrate:deploy
bun run db:studio
```

## Base de datos

La configuracion de Drizzle vive en `drizzle.config.ts`.

El schema inicial vive en `db/schema.ts` y define:

- `purchase_order_imports`
- `purchase_order_import_rows`

Ese modelo acompana el flujo actual de intake para guardar archivos importados y sus filas normalizadas.

## Intake de Excel/CSV

La pantalla de carga valida:

- extensiones `.csv`, `.xls`, `.xlsx`,
- tamano maximo de archivo,
- limite de hojas,
- limite de filas y columnas,
- y presencia de columnas requeridas como `required_date`, `quantity`, `price`, `amount` y `product`.

Si el workbook trae hojas auxiliares, la app selecciona automaticamente la primera hoja que cumpla con las columnas esperadas y deja warnings para las demas.

## Railway

La app ya queda preparada para desplegarse con Railway usando el `Dockerfile` de la raiz.

### Servicios recomendados

- Un servicio web para esta app
- Un servicio PostgreSQL administrado por Railway

### Variables necesarias

- `DATABASE_URL`
- `DATABASE_MAX_CONNECTIONS`
- `PORT`

Railway inyecta `PORT` automaticamente al servicio web y entrega `DATABASE_URL` desde el servicio PostgreSQL.

### Flujo recomendado

1. Crear un proyecto en Railway.
2. Agregar un servicio PostgreSQL.
3. Agregar un servicio desde este repositorio.
4. En el servicio web, referenciar `DATABASE_URL` desde el servicio PostgreSQL.
5. Configurar el healthcheck del servicio web a `/health`.
6. Desplegar.

### Comportamiento del contenedor

El contenedor de produccion:

1. compila el frontend,
2. corre las migraciones pendientes,
3. levanta el server Bun en `0.0.0.0:$PORT`.

## Estructura

```text
src/
  lib/
  main.tsx
  router.tsx
db/
  client.ts
  health.ts
  migrate.ts
  schema.ts
  migrations/
server/
  index.ts
```
