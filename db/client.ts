import 'dotenv/config'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { z } from 'zod'

import * as schema from './schema'

const envSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(5),
})

const env = envSchema.parse(process.env)

export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_MAX_CONNECTIONS,
})

export const db = drizzle(sql, {
  schema,
})
