import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db/client'
import {
  chamberConfigs,
  purchaseOrderImportRows,
  purchaseOrderImports,
} from '../db/schema'

const rowSchema = z.record(z.string(), z.string())

const parsedSheetSchema = z.object({
  name: z.string().min(1),
  dataframe: z.object({
    columnKeys: z.array(z.string()),
    rows: z.array(rowSchema),
    totalRows: z.number().int().nonnegative(),
  }),
})

const workbookPayloadSchema = z.object({
  fileName: z.string().min(1),
  extension: z.string().min(1),
  size: z.number().int().nonnegative(),
  sheets: z.array(parsedSheetSchema).min(1),
})

const chamberConfigModeSchema = z.enum(['ripening', 'conservation', 'occupied'])

const chamberConfigPayloadSchema = z.object({
  chamberCount: z.number().int().positive(),
  modes: z.record(z.string(), chamberConfigModeSchema),
})

const preferredColumnOrder = [
  'required_date',
  'quantity',
  'product',
  'price',
  'amount',
  'center',
  'provider',
  'ripener',
  'recipe_program_code',
  'recipe_target_color_grade',
  'purchase_order_ref',
  'source_sheet',
  'sku_family',
  'uom',
] as const

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function buildWorkbookLabel(importCount: number) {
  return importCount === 1
    ? 'Base acumulada (1 carga)'
    : `Base acumulada (${importCount} cargas)`
}

function normalizeStoredRow(rawData: unknown, fallbackSourceSheet: string) {
  const nextRow: Record<string, string> = {}
  const rawRecord =
    rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {}

  for (const [key, value] of Object.entries(rawRecord)) {
    nextRow[key] = typeof value === 'string' ? value : String(value ?? '')
  }

  if (!nextRow.source_sheet) {
    nextRow.source_sheet = fallbackSourceSheet
  }

  return nextRow
}

function buildColumnKeys(rows: Array<Record<string, string>>) {
  const discoveredKeys = new Set<string>()
  const preferredColumnSet = new Set<string>(preferredColumnOrder)

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      discoveredKeys.add(key)
    }
  }

  const orderedKeys = preferredColumnOrder.filter((key) =>
    discoveredKeys.has(key),
  )
  const extraKeys = [...discoveredKeys]
    .filter((key) => !preferredColumnSet.has(key))
    .sort((left, right) => left.localeCompare(right))

  return [...orderedKeys, ...extraKeys]
}

function buildPlanningWorkbook(
  rows: Array<{
    rawData: unknown
    sourceSheet: string | null
  }>,
  importCount: number,
) {
  if (rows.length === 0) {
    return null
  }

  const normalizedRows = rows.map((row) =>
    normalizeStoredRow(row.rawData, row.sourceSheet ?? 'Carga acumulada'),
  )
  const columnKeys = buildColumnKeys(normalizedRows)

  return {
    fileName: buildWorkbookLabel(importCount),
    extension: 'db',
    size: 0,
    sheets: [
      {
        name: 'Ordenes acumuladas',
        columns: columnKeys.map((key) => ({
          key,
          label: key,
        })),
        dataframe: {
          columnKeys,
          rows: normalizedRows,
          sampleRows: normalizedRows.slice(0, 3),
          totalRows: normalizedRows.length,
        },
        previewRows: normalizedRows.slice(0, 10).map((row, index) => ({
          rowNumber: index + 2,
          cells: columnKeys.map((key) => row[key] ?? ''),
        })),
        totalRows: normalizedRows.length,
        totalColumns: columnKeys.length,
      },
    ],
    warnings: [],
  }
}

function buildDefaultChamberConfig() {
  return {
    chamberCount: 4,
    modes: {
      'Camara A': 'ripening',
      'Camara B': 'ripening',
      'Camara C': 'ripening',
      'Camara D': 'ripening',
    } as Record<string, z.infer<typeof chamberConfigModeSchema>>,
  }
}

async function listChamberConfigState() {
  const rows = await db
    .select({
      chamberName: chamberConfigs.chamberName,
      mode: chamberConfigs.mode,
    })
    .from(chamberConfigs)
    .orderBy(asc(chamberConfigs.chamberName))

  if (rows.length === 0) {
    const defaultConfig = buildDefaultChamberConfig()

    await db.insert(chamberConfigs).values(
      Object.entries(defaultConfig.modes).map(([chamberName, mode]) => ({
        chamberName,
        mode,
      })),
    )

    return defaultConfig
  }

  const modes = Object.fromEntries(
    rows.map((row) => [row.chamberName, row.mode]),
  ) as Record<string, z.infer<typeof chamberConfigModeSchema>>

  return {
    chamberCount: rows.length,
    modes,
  }
}

async function persistWorkbookSnapshot(
  tx: DbTransaction,
  workbook: z.infer<typeof workbookPayloadSchema>,
) {
  const totalRows = workbook.sheets.reduce(
    (sum, sheet) => sum + sheet.dataframe.totalRows,
    0,
  )

  const [createdImport] = await tx
    .insert(purchaseOrderImports)
    .values({
      sourceFileName: workbook.fileName,
      sourceExtension: workbook.extension,
      sourceFileSizeBytes: workbook.size,
      totalSheets: workbook.sheets.length,
      totalRows,
    })
    .returning({
      id: purchaseOrderImports.id,
    })

  const rowValues = workbook.sheets.flatMap((sheet) =>
    sheet.dataframe.rows.map((row, index) => {
      const normalizedRow = normalizeStoredRow(row, sheet.name)

      return {
        importId: createdImport.id,
        sheetName: sheet.name,
        rowNumber: index + 2,
        requiredDate: normalizedRow.required_date || null,
        quantity: normalizedRow.quantity || null,
        price: normalizedRow.price || null,
        amount: normalizedRow.amount || null,
        product: normalizedRow.product || null,
        center: normalizedRow.center || null,
        provider: normalizedRow.provider || null,
        ripener: normalizedRow.ripener || null,
        purchaseOrderRef: normalizedRow.purchase_order_ref || null,
        skuFamily: normalizedRow.sku_family || null,
        unitOfMeasure: normalizedRow.uom || null,
        sourceSheet: normalizedRow.source_sheet || sheet.name,
        rawData: normalizedRow,
      }
    }),
  )

  if (rowValues.length > 0) {
    await tx.insert(purchaseOrderImportRows).values(rowValues)
  }

  return createdImport
}

export async function listPlanningState() {
  const imports = await db
    .select({
      id: purchaseOrderImports.id,
      sourceFileName: purchaseOrderImports.sourceFileName,
      totalRows: purchaseOrderImports.totalRows,
      createdAt: purchaseOrderImports.createdAt,
    })
    .from(purchaseOrderImports)
    .orderBy(desc(purchaseOrderImports.createdAt))

  const rows = await db
    .select({
      rawData: purchaseOrderImportRows.rawData,
      sourceSheet: purchaseOrderImportRows.sourceSheet,
    })
    .from(purchaseOrderImportRows)
    .innerJoin(
      purchaseOrderImports,
      eq(purchaseOrderImportRows.importId, purchaseOrderImports.id),
    )
    .orderBy(
      asc(purchaseOrderImports.createdAt),
      asc(purchaseOrderImportRows.rowNumber),
    )

  const chamberConfig = await listChamberConfigState()

  return {
    importCount: imports.length,
    latestImport: imports[0] ?? null,
    workbook: buildPlanningWorkbook(rows, imports.length),
    chamberConfig,
  }
}

export async function persistImportedWorkbook(payload: unknown) {
  const workbook = workbookPayloadSchema.parse(payload)

  const persistedImport = await db.transaction(async (tx) => {
    return persistWorkbookSnapshot(tx, workbook)
  })

  const state = await listPlanningState()

  return {
    ...state,
    persistedImportId: persistedImport.id,
  }
}

export async function replacePlanningWorkbook(payload: unknown) {
  const workbook = workbookPayloadSchema.parse(payload)

  const persistedImport = await db.transaction(async (tx) => {
    await tx.delete(purchaseOrderImportRows)
    await tx.delete(purchaseOrderImports)

    return persistWorkbookSnapshot(tx, workbook)
  })

  const state = await listPlanningState()

  return {
    ...state,
    persistedImportId: persistedImport.id,
  }
}

export async function persistChamberConfig(payload: unknown) {
  const config = chamberConfigPayloadSchema.parse(payload)
  const expectedChamberNames = Array.from(
    { length: config.chamberCount },
    (_, index) => `Camara ${String.fromCharCode(65 + index)}`,
  )
  const modes = Object.fromEntries(
    expectedChamberNames.map((name) => [
      name,
      config.modes[name] ?? 'ripening',
    ]),
  ) as Record<string, z.infer<typeof chamberConfigModeSchema>>

  await db.transaction(async (tx) => {
    await tx.delete(chamberConfigs)
    await tx.insert(chamberConfigs).values(
      expectedChamberNames.map((chamberName) => ({
        chamberName,
        mode: modes[chamberName],
      })),
    )
  })

  return listPlanningState()
}
