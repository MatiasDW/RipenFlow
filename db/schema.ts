import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
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

export const ripeningPhaseDefinitions = pgTable(
  'ripening_phase_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    phaseNumber: integer('phase_number').notNull(),
    phaseName: varchar('phase_name', { length: 255 }).notNull(),
    durationHours: numeric('duration_hours', { precision: 8, scale: 2 }),
    durationDays: numeric('duration_days', { precision: 8, scale: 2 }),
    temperatureC: varchar('temperature_c', { length: 64 }),
    reaction: varchar('reaction', { length: 512 }),
    ambientHumidity: varchar('ambient_humidity', { length: 64 }),
    ethylene: varchar('ethylene', { length: 64 }),
    oxygen: varchar('oxygen', { length: 64 }),
    carbonDioxide: varchar('carbon_dioxide', { length: 64 }),
    colorState: varchar('color_state', { length: 64 }),
    doorsOpen: boolean('doors_open'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    phaseNumberKey: uniqueIndex(
      'ripening_phase_definitions_phase_number_key',
    ).on(table.phaseNumber),
  }),
)

export const ripeningRecipeProfiles = pgTable(
  'ripening_recipe_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceWorkbook: varchar('source_workbook', { length: 255 }).notNull(),
    variantCode: varchar('variant_code', { length: 64 }).notNull(),
    programCode: varchar('program_code', { length: 64 }).notNull(),
    targetColorGrade: varchar('target_color_grade', { length: 32 }).notNull(),
    totalHours: numeric('total_hours', { precision: 8, scale: 2 }).notNull(),
    totalDays: numeric('total_days', { precision: 8, scale: 2 }).notNull(),
    productFamily: varchar('product_family', { length: 64 })
      .default('banana')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    variantProgramGradeKey: uniqueIndex(
      'ripening_recipe_profiles_variant_program_grade_key',
    ).on(table.variantCode, table.programCode, table.targetColorGrade),
  }),
)

export const ripeningRecipeSteps = pgTable(
  'ripening_recipe_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipeProfileId: uuid('recipe_profile_id')
      .notNull()
      .references(() => ripeningRecipeProfiles.id, { onDelete: 'cascade' }),
    phaseNumber: integer('phase_number').notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    targetTemperatureC: numeric('target_temperature_c', {
      precision: 8,
      scale: 2,
    }),
    durationHours: numeric('duration_hours', { precision: 8, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    recipePhaseKey: uniqueIndex('ripening_recipe_steps_recipe_phase_key').on(
      table.recipeProfileId,
      table.phaseNumber,
    ),
  }),
)
