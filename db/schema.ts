import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const purchaseOrderImports = pgTable('purchase_order_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceFileName: varchar('source_file_name', { length: 255 }).notNull(),
  sourceExtension: varchar('source_extension', { length: 16 }).notNull(),
  totalSheets: integer('total_sheets').notNull(),
  totalRows: integer('total_rows').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const purchaseOrderImportRows = pgTable('purchase_order_import_rows', {
  id: uuid('id').defaultRandom().primaryKey(),
  importId: uuid('import_id')
    .notNull()
    .references(() => purchaseOrderImports.id, { onDelete: 'cascade' }),
  sheetName: varchar('sheet_name', { length: 128 }).notNull(),
  rowNumber: integer('row_number').notNull(),
  requiredDate: varchar('required_date', { length: 64 }),
  quantity: varchar('quantity', { length: 64 }),
  price: varchar('price', { length: 64 }),
  amount: varchar('amount', { length: 64 }),
  product: varchar('product', { length: 255 }),
  rawData: jsonb('raw_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
