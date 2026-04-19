import 'dotenv/config'

import { migrate } from 'drizzle-orm/postgres-js/migrator'

import { db, sql } from './client'

async function main() {
  await migrate(db, {
    migrationsFolder: './db/migrations',
  })
}

main()
  .then(async () => {
    await sql.end()
  })
  .catch(async (error) => {
    console.error('Failed to run database migrations', error)
    await sql.end({ timeout: 1 })
    process.exit(1)
  })
