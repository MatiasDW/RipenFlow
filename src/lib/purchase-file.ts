import * as XLSX from 'xlsx'

const SUPPORTED_EXTENSIONS = new Set(['csv', 'xls', 'xlsx'])
const PREVIEW_LIMIT = 10

export type ParsedSheet = {
  name: string
  columns: Array<{
    key: string
    label: string
  }>
  dataframe: {
    columnKeys: string[]
    rows: Array<Record<string, string>>
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

  const warnings = new Set<string>([
    'Para IDs, OC, SKU o numeros largos conviene que la columna venga como texto. Excel solo conserva 15 digitos significativos en celdas numericas.',
  ])

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

    const seenKeys = new Map<string, number>()
    const columns = Array.from({ length: totalColumns }, (_, index) => {
      const label = rows[0]?.[index] || `Columna ${index + 1}`
      const baseKey = normalizeColumnKey(label, index)
      const seenCount = seenKeys.get(baseKey) ?? 0
      const key = seenCount === 0 ? baseKey : `${baseKey}_${seenCount + 1}`

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

    return {
      name: sheetName,
      columns,
      dataframe: {
        columnKeys: columns.map((column) => column.key),
        rows: dataframeRows,
      },
      previewRows,
      totalRows: Math.max(rows.length - 1, 0),
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
