import * as XLSX from 'xlsx'

const SUPPORTED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const PREVIEW_LIMIT = 10
const DATAFRAME_SAMPLE_LIMIT = 3
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024
const MAX_SHEETS = 8
const MAX_ROWS_PER_SHEET = 5000
const MAX_TOTAL_ROWS = 12000
const MAX_COLUMNS_PER_SHEET = 100

export type ParsedSheet = {
  name: string
  columns: Array<{
    key: string
    label: string
  }>
  dataframe: {
    columnKeys: string[]
    rows: Array<Record<string, string>>
    sampleRows: Array<Record<string, string>>
    totalRows: number
  }
  previewRows: Array<{
    rowNumber: number
    cells: string[]
  }>
  totalRows: number
  totalColumns: number
}

export type ParsedWorkbook = {
  fileName: string
  extension: string
  size: number
  sheets: ParsedSheet[]
  warnings: string[]
}

export const purchaseFileLimits = {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxSheets: MAX_SHEETS,
  maxRowsPerSheet: MAX_ROWS_PER_SHEET,
  maxTotalRows: MAX_TOTAL_ROWS,
  maxColumnsPerSheet: MAX_COLUMNS_PER_SHEET,
}

function getExtension(fileName: string) {
  const lastSegment = fileName.split('.').pop()?.toLowerCase()

  return lastSegment ?? ''
}

function normalizeCell(cell: unknown) {
  if (cell === null || cell === undefined) {
    return ''
  }

  if (typeof cell === 'string') {
    return cell
  }

  return String(cell)
}

function normalizeColumnKey(label: string, index: number) {
  const normalized = label
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')

  return normalized || `columna_${index + 1}`
}

export function findMissingColumnKeys(
  columnKeys: string[],
  requiredColumnKeys: string[],
) {
  const availableKeys = new Set(columnKeys)

  return requiredColumnKeys.filter((columnKey) => !availableKeys.has(columnKey))
}

function collectWorksheetWarnings(worksheet: XLSX.WorkSheet) {
  let longNumericCellCount = 0

  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith('!')) {
      continue
    }

    if (!cell || typeof cell !== 'object' || !('t' in cell)) {
      continue
    }

    const typedCell = cell as XLSX.CellObject
    const displayValue = normalizeCell(typedCell.w ?? typedCell.v).replaceAll(
      /\s|,|\./g,
      '',
    )

    if (typedCell.t === 'n' && /^\d{15,}$/.test(displayValue)) {
      longNumericCellCount += 1
    }
  }

  if (longNumericCellCount === 0) {
    return []
  }

  return [
    `Se detectaron ${longNumericCellCount} celdas numericas largas. Si en Excel no estaban guardadas como texto, la precision puede haberse perdido antes de subir el archivo.`,
  ]
}

export async function parsePurchaseFile(file: File): Promise<ParsedWorkbook> {
  const extension = getExtension(file.name)

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Solo se permiten archivos .csv, .xls o .xlsx')
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `El archivo supera el limite de ${formatBytes(MAX_FILE_SIZE_BYTES)}. Divide la carga o reduce el contenido antes de subirlo.`,
    )
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, {
    type: 'array',
    dense: true,
    cellDates: false,
    cellText: true,
    raw: false,
  })

  if (workbook.SheetNames.length === 0) {
    throw new Error('El archivo no contiene hojas para procesar')
  }

  if (workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error(
      `El archivo trae ${workbook.SheetNames.length} hojas. El limite operativo actual es ${MAX_SHEETS}.`,
    )
  }

  const warnings = new Set<string>([
    'Para IDs, OC, SKU o numeros largos conviene que la columna venga como texto. Excel solo conserva 15 digitos significativos en celdas numericas.',
  ])
  let totalRowCount = 0

  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils
      .sheet_to_json<(string | number | boolean | Date)[]>(worksheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      })
      .map((row) => row.map(normalizeCell))

    for (const warning of collectWorksheetWarnings(worksheet)) {
      warnings.add(warning)
    }

    const totalColumns = rows.reduce(
      (maxColumns, row) => Math.max(maxColumns, row.length),
      0,
    )
    const totalRows = Math.max(rows.length - 1, 0)

    if (totalColumns > MAX_COLUMNS_PER_SHEET) {
      throw new Error(
        `La hoja "${sheetName}" trae ${totalColumns} columnas. El limite operativo actual es ${MAX_COLUMNS_PER_SHEET}.`,
      )
    }

    if (totalRows > MAX_ROWS_PER_SHEET) {
      throw new Error(
        `La hoja "${sheetName}" trae ${totalRows} filas de datos. El limite operativo actual es ${MAX_ROWS_PER_SHEET}.`,
      )
    }

    totalRowCount += totalRows

    if (totalRowCount > MAX_TOTAL_ROWS) {
      throw new Error(
        `El archivo supera el limite total de ${MAX_TOTAL_ROWS} filas de datos entre todas las hojas.`,
      )
    }

    const seenKeys = new Map<string, number>()
    const columns = Array.from({ length: totalColumns }, (_, index) => {
      const label = rows[0]?.[index] || `Columna ${index + 1}`
      const baseKey = normalizeColumnKey(label, index)
      const seenCount = seenKeys.get(baseKey) ?? 0
      const key = seenCount === 0 ? baseKey : `${baseKey}_${seenCount + 1}`

      if (seenCount > 0) {
        warnings.add(
          `La hoja "${sheetName}" tiene encabezados repetidos que normalizan a "${baseKey}". Se renombraron automaticamente para evitar colisiones.`,
        )
      }

      seenKeys.set(baseKey, seenCount + 1)

      return {
        key,
        label,
      }
    })

    const previewRows = rows.slice(1, PREVIEW_LIMIT + 1).map((row, index) => ({
      rowNumber: index + 2,
      cells: row,
    }))

    const dataframeRows = rows
      .slice(1)
      .map((row) =>
        Object.fromEntries(
          columns.map((column, columnIndex) => [
            column.key,
            normalizeCell(row[columnIndex]),
          ]),
        ),
      )
    const dataframeSampleRows = dataframeRows.slice(0, DATAFRAME_SAMPLE_LIMIT)

    return {
      name: sheetName,
      columns,
      dataframe: {
        columnKeys: columns.map((column) => column.key),
        rows: dataframeRows,
        sampleRows: dataframeSampleRows,
        totalRows,
      },
      previewRows,
      totalRows,
      totalColumns,
    }
  })

  return {
    fileName: file.name,
    extension,
    size: file.size,
    sheets,
    warnings: [...warnings],
  }
}

export function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
