import 'dotenv/config'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { z } from 'zod'

import * as schema from './schema'

const envSchema = z.object({
  DATABASE_URL: z.url(),
})

const env = envSchema.parse(process.env)

export const sql = postgres(env.DATABASE_URL, {
  max: 1,
})

export const db = drizzle(sql, {
  schema,
})
