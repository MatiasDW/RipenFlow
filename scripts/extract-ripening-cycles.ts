import path from 'node:path'
import { inspect } from 'node:util'

import * as XLSX from 'xlsx'

type PhaseDefinition = {
  phaseNumber: number
  phaseName: string
  durationHours: number | null
  durationDays: number | null
  temperatureC: string | null
  reaction: string | null
  ambientHumidity: string | null
  ethylene: string | null
  oxygen: string | null
  carbonDioxide: string | null
  colorState: string | null
  doorsOpen: boolean | null
}

type RecipeStep = {
  phaseNumber: number
  sequenceNumber: number
  targetTemperatureC: number | null
  durationHours: number | null
}

type RecipeProfile = {
  variantCode: string
  variantLabel: string
  programCode: string
  targetColorGrade: string
  totalHours: number
  totalDays: number
  productFamily: string
  steps: RecipeStep[]
}

type RipeningCycleCatalog = {
  sourceWorkbook: string
  extractedAt: string
  phaseDefinitions: PhaseDefinition[]
  recipeProfiles: RecipeProfile[]
}

const defaultWorkbookPath = path.join(
  process.cwd(),
  '.context/attachments/Ciclos de Maduración 1 al 9  v3 06 05 2025.xlsx',
)
const outputPath = path.join(
  process.cwd(),
  'src/data/ripening-cycles.generated.ts',
)

const recipeColumnPairs = [
  { tempCol: 1, hoursCol: 2, programCode: 'SOFTRIPE', targetColorGrade: '2.5' },
  { tempCol: 3, hoursCol: 4, programCode: 'SOFTRIPE', targetColorGrade: '3' },
  { tempCol: 5, hoursCol: 6, programCode: 'SOFTRIPE', targetColorGrade: '3.5' },
  { tempCol: 7, hoursCol: 8, programCode: 'SOFTRIPE', targetColorGrade: '4' },
  { tempCol: 9, hoursCol: 10, programCode: 'TURBO', targetColorGrade: '3.5' },
  { tempCol: 11, hoursCol: 12, programCode: 'TURBO', targetColorGrade: '4' },
] as const

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function parseNumber(value: unknown) {
  const normalized = normalizeCell(value).replace(',', '.')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : null
}

function parseBoolean(value: unknown) {
  const normalized = normalizeCell(value).toUpperCase()

  if (normalized === 'SI') {
    return true
  }

  if (normalized === 'NO') {
    return false
  }

  return null
}

async function readRows(workbookPath: string, sheetName: string) {
  const workbook = XLSX.read(await Bun.file(workbookPath).arrayBuffer(), {
    type: 'array',
    dense: true,
    cellDates: false,
    cellText: true,
    raw: false,
  })
  const sheet = workbook.Sheets[sheetName]

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" was not found in ${workbookPath}`)
  }

  return XLSX.utils
    .sheet_to_json<(string | number | boolean)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })
    .map((row) => row.map(normalizeCell))
}

function extractPhaseDefinitions(rows: string[][]) {
  const uniqueByPhaseNumber = new Map<number, PhaseDefinition>()

  for (const phase of rows
    .slice(5)
    .map((row) => ({
      phaseNumber: parseNumber(row[0]),
      phaseName: normalizeCell(row[1]),
      durationHours: parseNumber(row[2]),
      durationDays: parseNumber(row[3]),
      temperatureC: normalizeCell(row[4]) || null,
      reaction: normalizeCell(row[5]) || null,
      ambientHumidity: normalizeCell(row[6]) || null,
      ethylene: normalizeCell(row[7]) || null,
      oxygen: normalizeCell(row[8]) || null,
      carbonDioxide: normalizeCell(row[9]) || null,
      colorState: normalizeCell(row[10]) || null,
      doorsOpen: parseBoolean(row[11]),
    }))
    .filter(
      (phase): phase is PhaseDefinition =>
        phase.phaseNumber !== null && phase.phaseName.length > 0,
    )) {
    if (!uniqueByPhaseNumber.has(phase.phaseNumber)) {
      uniqueByPhaseNumber.set(phase.phaseNumber, phase)
    }
  }

  return [...uniqueByPhaseNumber.values()]
}

function extractRecipeProfiles(rows: string[][]) {
  const blockStarts = rows
    .map((row, index) => ({
      label: normalizeCell(row[0]).toUpperCase(),
      index,
    }))
    .filter((entry) => entry.label === 'GRADO COLOR')
    .map((entry) => entry.index)

  return blockStarts.flatMap((blockStart, blockIndex) => {
    const variantCode = blockIndex === 0 ? 'standard' : 'blue_point_modified'
    const variantLabel =
      blockIndex === 0 ? 'Standard profile' : 'Blue point modification'
    const totalsRow = rows[blockStart + 12] ?? []
    const daysRow = rows[blockStart + 13] ?? []

    return recipeColumnPairs.map((columnPair) => {
      const steps: RecipeStep[] = []

      for (let offset = 2; offset <= 11; offset += 1) {
        const row = rows[blockStart + offset] ?? []
        const phaseNumber = parseNumber(row[0])
        const targetTemperatureC = parseNumber(row[columnPair.tempCol])
        const durationHours = parseNumber(row[columnPair.hoursCol])

        if (
          phaseNumber === null ||
          (targetTemperatureC === null && durationHours === null)
        ) {
          continue
        }

        steps.push({
          phaseNumber,
          sequenceNumber: steps.length + 1,
          targetTemperatureC,
          durationHours,
        })
      }

      const totalHours = parseNumber(totalsRow[columnPair.hoursCol])
      const totalDays = parseNumber(daysRow[columnPair.hoursCol])

      if (totalHours === null || totalDays === null) {
        throw new Error(
          `Missing total hours or days for ${columnPair.programCode} ${columnPair.targetColorGrade} (${variantCode})`,
        )
      }

      return {
        variantCode,
        variantLabel,
        programCode: columnPair.programCode,
        targetColorGrade: columnPair.targetColorGrade,
        totalHours,
        totalDays,
        productFamily: 'banana',
        steps,
      } satisfies RecipeProfile
    })
  })
}

function renderCatalogModule(catalog: RipeningCycleCatalog) {
  const objectLiteral = inspect(catalog, {
    depth: null,
    maxArrayLength: null,
    compact: false,
    breakLength: 80,
  })

  return `export type RipeningPhaseDefinition = {
  phaseNumber: number
  phaseName: string
  durationHours: number | null
  durationDays: number | null
  temperatureC: string | null
  reaction: string | null
  ambientHumidity: string | null
  ethylene: string | null
  oxygen: string | null
  carbonDioxide: string | null
  colorState: string | null
  doorsOpen: boolean | null
}

export type RipeningRecipeStep = {
  phaseNumber: number
  sequenceNumber: number
  targetTemperatureC: number | null
  durationHours: number | null
}

export type RipeningRecipeProfile = {
  variantCode: string
  variantLabel: string
  programCode: string
  targetColorGrade: string
  totalHours: number
  totalDays: number
  productFamily: string
  steps: RipeningRecipeStep[]
}

export type RipeningCycleCatalog = {
  sourceWorkbook: string
  extractedAt: string
  phaseDefinitions: RipeningPhaseDefinition[]
  recipeProfiles: RipeningRecipeProfile[]
}

export const ripeningCycleCatalog: RipeningCycleCatalog = ${objectLiteral}
`
}

async function main() {
  const workbookPath = process.argv[2] ?? defaultWorkbookPath
  const phaseRows = await readRows(workbookPath, 'Maduraciones')
  const recipeRows = await readRows(workbookPath, 'ciclos de maduracion')

  const catalog: RipeningCycleCatalog = {
    sourceWorkbook: path.basename(workbookPath),
    extractedAt: new Date().toISOString(),
    phaseDefinitions: extractPhaseDefinitions(phaseRows),
    recipeProfiles: extractRecipeProfiles(recipeRows),
  }

  await Bun.write(outputPath, renderCatalogModule(catalog))
  console.log(`Wrote ${outputPath}`)
}

void main()
