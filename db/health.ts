import { sql } from 'drizzle-orm'

import { db } from './client'

export async function checkDatabaseConnection() {
  await db.execute(sql`select 1`)
}
