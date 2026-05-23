import type { ParsedSheet } from '@/lib/purchase-file'
import {
  getRecipeScenarioPenalty,
  listRipeningRecipes,
} from '@/lib/ripening-cycles'

const BOXES_PER_PALLET = 54
const PALLETS_PER_CONTAINER = 20
const PALLETS_PER_CHAMBER = 24
const DEFAULT_CHAMBER_COUNT = 4
const START_LOOKBACK_DAYS = 14
const CHAMBER_CLEANING_BUFFER_DAYS = 1

const fieldAliases = {
  requiredDate: [
    'required_date',
    'due_date',
    'target_date',
    'delivery_date',
    'fecha_requerida',
  ],
  quantity: ['quantity', 'qty', 'cantidad', 'boxes', 'cajas'],
  price: ['price', 'unit_price', 'precio', 'precio_unitario'],
  amount: ['amount', 'total', 'importe', 'monto'],
  product: [
    'product',
    'producto',
    'descripcion_sku',
    'descripcion',
    'sku',
    'item',
  ],
  center: ['center', 'centro', 'centro_codigo'],
  provider: ['provider', 'proveedor'],
  ripener: ['ripener', 'madurador'],
  recipeProgramCode: ['recipe_program_code'],
  recipeTargetColorGrade: ['recipe_target_color_grade'],
  purchaseOrderRef: [
    'purchase_order',
    'purchase_order_ref',
    'order_reference',
    'oc',
    'orden_compra',
    'orden_de_compra',
  ],
} as const

const requiredFieldAliases = {
  requiredDate: fieldAliases.requiredDate,
  quantity: fieldAliases.quantity,
  product: fieldAliases.product,
} as const

export type DemandOrder = {
  id: string
  sourceRowIndex: number
  product: string
  productGroupLabel: string
  center: string
  provider: string
  ripener: string
  purchaseOrderRef: string
  recipeProgramCode: string | null
  recipeTargetColorGrade: string | null
  recipeTotalHours: number | null
  recipeTotalDays: number | null
  requiredDate: string
  quantityBoxes: number
  pallets: number
  containers: number
  price: number
  amount: number
  startDate: string
  chamberName: string
  riskNote: string | null
  scenarioStatus: 'queued' | 'in_ripening' | 'ready' | 'late_risk'
}

export type SimulationSummary = {
  orders: DemandOrder[]
  chamberNames: string[]
  unavailableChamberNames: string[]
  conservationChamberNames: string[]
  chamberUsage: ChamberUsage[]
  totalBoxes: number
  totalPallets: number
  totalContainers: number
  totalRevenue: number
  dateRange: string[]
  missingFields: string[]
  assumptions: string[]
}

export type SimulationMetric = {
  label: string
  value: string
  hint: string
  tone: 'neutral' | 'positive' | 'warning'
}

export type ChamberFill = {
  name: string
  occupancy: number
  activeOrders: number
  lateRiskOrders: number
  issueNote: string | null
  status: 'healthy' | 'issue'
  hasIssue: boolean
  isUnavailable: boolean
  mode: 'ripening' | 'conservation' | 'occupied'
}

export type TimelineOrder = DemandOrder & {
  startIndex: number
  span: number
}

type ChamberSchedule = {
  name: string
  bookedPalletsByDay: Map<string, number>
  bookedProductGroupByDay: Map<string, string>
  bookedRecipeKeyByDay: Map<string, string>
}

type ChamberUsage = {
  name: string
  peakBookedPallets: number
  totalBookedPalletDays: number
  usedDays: number
  activated: boolean
}

type ChamberAllocation = {
  chamber: ChamberSchedule
  pallets: number
  gapDaysBeforePlacement: number
  activatesNewChamber: number
}

type ChamberScoreEntry = {
  chamber: ChamberSchedule
  score: ReturnType<typeof scoreChamberWindow>
}

function buildLatestBookedDate(chamber: ChamberSchedule, startDate: Date) {
  const startIso = toIsoDate(startDate)
  const bookedDays = [...chamber.bookedPalletsByDay.keys()]
    .filter((day) => day < startIso)
    .sort((left, right) => left.localeCompare(right))

  const latestBookedDay = bookedDays.at(-1)

  return latestBookedDay ? new Date(`${latestBookedDay}T00:00:00`) : null
}

function pickField(
  row: Record<string, string>,
  aliases: readonly string[],
  fallback = '',
) {
  for (const alias of aliases) {
    if (row[alias]) {
      return row[alias]
    }
  }

  return fallback
}

function parseNumericValue(rawValue: string, fallback: number) {
  const normalized = rawValue.replaceAll(/\s/g, '').replace(',', '.')
  const parsedValue = Number(normalized)

  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function parseDateValue(rawValue: string, fallbackOffset: number) {
  const latinDateMatch = rawValue
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)

  if (latinDateMatch) {
    const [, day, month, year] = latinDateMatch
    const parsedDate = new Date(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`,
    )

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate
    }
  }

  const parsedDate = new Date(rawValue)

  if (Number.isNaN(parsedDate.getTime())) {
    const date = new Date()
    date.setDate(date.getDate() + fallbackOffset)

    return date
  }

  return parsedDate
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, amount: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + amount)

  return nextDate
}

function differenceInDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

function getPriorityWeight(priority: string) {
  const normalizedPriority = priority.trim().toLowerCase()

  if (normalizedPriority === 'high') {
    return 3
  }

  if (normalizedPriority === 'medium') {
    return 2
  }

  return 1
}

function buildCycleDays(
  product: string,
  pallets: number,
  quantityBoxes: number,
) {
  let cycleDays = 3
  const normalizedProduct = product.toLowerCase()

  if (normalizedProduct.includes('export')) {
    cycleDays += 1
  }

  if (normalizedProduct.includes('premium')) {
    cycleDays += 1
  }

  if (pallets >= 20 || quantityBoxes >= 1080) {
    cycleDays += 1
  }

  if (pallets >= 28 || quantityBoxes >= 1620) {
    cycleDays += 1
  }

  return Math.min(cycleDays, 7)
}

function buildRecipeCycleDays(totalDays: number | null) {
  if (totalDays === null) {
    return null
  }

  return Math.max(Math.ceil(totalDays), 1)
}

function buildScheduleWindow(startDate: Date, endDate: Date) {
  const windowDays: string[] = []
  const cursor = new Date(startDate)

  while (cursor <= endDate) {
    windowDays.push(toIsoDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return windowDays
}

function normalizeProductGroupKey(product: string) {
  return product
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

function inferChamberProductGroup(product: string) {
  const normalizedProduct = normalizeProductGroupKey(product)

  if (
    normalizedProduct.includes('platano') ||
    normalizedProduct.includes('banana') ||
    normalizedProduct.includes('banano') ||
    normalizedProduct.includes('cavendish')
  ) {
    return {
      key: 'platano',
      label: 'platano',
    }
  }

  if (
    normalizedProduct.includes('palta') ||
    normalizedProduct.includes('avocado') ||
    normalizedProduct.includes('aguacate')
  ) {
    return {
      key: 'palta',
      label: 'palta',
    }
  }

  return {
    key: normalizedProduct || 'producto-generico',
    label: product.trim() || 'producto generico',
  }
}

function scoreChamberWindow(
  chamber: ChamberSchedule,
  windowDays: string[],
  pallets: number,
  productGroupKey: string,
  recipeKey: string,
  startDate: Date,
) {
  let peakOccupancy = 0
  let totalOccupancy = 0
  let mixedProductDays = 0
  let recipeConflictDays = 0
  let maxAdditionalPallets = PALLETS_PER_CHAMBER
  const conflictingProductGroups = new Set<string>()
  const conflictingRecipes = new Set<string>()
  const conflictingProductDays = new Set<string>()
  const conflictingRecipeDays = new Set<string>()
  const latestBookedDate = buildLatestBookedDate(chamber, startDate)

  for (const day of windowDays) {
    const bookedPallets = chamber.bookedPalletsByDay.get(day) ?? 0
    const bookedProductGroup = chamber.bookedProductGroupByDay.get(day)
    const bookedRecipeKey = chamber.bookedRecipeKeyByDay.get(day)

    if (bookedProductGroup && bookedProductGroup !== productGroupKey) {
      mixedProductDays += 1
      conflictingProductGroups.add(bookedProductGroup)
      conflictingProductDays.add(day)
    }

    if (
      bookedRecipeKey &&
      bookedRecipeKey !== recipeKey &&
      bookedPallets > 0 &&
      bookedProductGroup === productGroupKey
    ) {
      recipeConflictDays += 1
      conflictingRecipes.add(bookedRecipeKey)
      conflictingRecipeDays.add(day)
    }

    const nextOccupancy = bookedPallets + pallets
    peakOccupancy = Math.max(peakOccupancy, nextOccupancy)
    totalOccupancy += nextOccupancy
    maxAdditionalPallets = Math.min(
      maxAdditionalPallets,
      Math.max(PALLETS_PER_CHAMBER - bookedPallets, 0),
    )
  }

  return {
    peakOccupancy,
    totalOccupancy,
    mixedProductDays,
    recipeConflictDays,
    gapDaysBeforePlacement: latestBookedDate
      ? Math.max(
          differenceInDays(addDays(latestBookedDate, 1), startDate) -
            CHAMBER_CLEANING_BUFFER_DAYS,
          0,
        )
      : 0,
    conflictingProductGroups: [...conflictingProductGroups],
    conflictingProductDays: [...conflictingProductDays],
    conflictingRecipes: [...conflictingRecipes],
    conflictingRecipeDays: [...conflictingRecipeDays],
    maxAdditionalPallets,
    overflowPallets: Math.max(peakOccupancy - PALLETS_PER_CHAMBER, 0),
    activatesNewChamber: chamber.bookedPalletsByDay.size === 0 ? 1 : 0,
    headroomAfterPlacement: Math.max(PALLETS_PER_CHAMBER - peakOccupancy, 0),
  }
}

function reserveChamberWindow(
  chamber: ChamberSchedule,
  windowDays: string[],
  pallets: number,
  productGroupKey: string,
  recipeKey: string,
) {
  for (const day of windowDays) {
    chamber.bookedPalletsByDay.set(
      day,
      (chamber.bookedPalletsByDay.get(day) ?? 0) + pallets,
    )

    if (!chamber.bookedProductGroupByDay.has(day)) {
      chamber.bookedProductGroupByDay.set(day, productGroupKey)
    }

    if (!chamber.bookedRecipeKeyByDay.has(day)) {
      chamber.bookedRecipeKeyByDay.set(day, recipeKey)
    }
  }
}

function getChamberName(index: number) {
  if (index < 26) {
    return `Camara ${String.fromCharCode(65 + index)}`
  }

  return `Camara ${index + 1}`
}

function buildChamberNames(chamberCount: number) {
  return Array.from({ length: Math.max(chamberCount, 1) }, (_, index) =>
    getChamberName(index),
  )
}

function createChamberSchedule(name: string): ChamberSchedule {
  return {
    name,
    bookedPalletsByDay: new Map<string, number>(),
    bookedProductGroupByDay: new Map<string, string>(),
    bookedRecipeKeyByDay: new Map<string, string>(),
  }
}

function splitBoxesByPallets(totalBoxes: number, allocations: number[]) {
  let assignedBoxes = 0

  return allocations.map((allocatedPallets, index) => {
    if (index === allocations.length - 1) {
      return Math.max(totalBoxes - assignedBoxes, 0)
    }

    const allocatedBoxes = Math.round(allocatedPallets * BOXES_PER_PALLET)
    assignedBoxes += allocatedBoxes

    return allocatedBoxes
  })
}

function formatNameList(values: string[]) {
  if (values.length === 0) {
    return ''
  }

  if (values.length === 1) {
    return values[0]
  }

  if (values.length === 2) {
    return `${values[0]} y ${values[1]}`
  }

  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`
}

function formatDateRanges(days: string[]) {
  if (days.length === 0) {
    return ''
  }

  const sortedDays = [...new Set(days)].sort((left, right) =>
    left.localeCompare(right),
  )
  const ranges: Array<{ start: string; end: string }> = []
  let rangeStart = sortedDays[0]
  let previousDay = sortedDays[0]

  for (const day of sortedDays.slice(1)) {
    const expectedNextDay = toIsoDate(
      addDays(new Date(`${previousDay}T00:00:00`), 1),
    )

    if (day === expectedNextDay) {
      previousDay = day
      continue
    }

    ranges.push({ start: rangeStart, end: previousDay })
    rangeStart = day
    previousDay = day
  }

  ranges.push({ start: rangeStart, end: previousDay })

  return ranges
    .map(({ start, end }) => (start === end ? start : `${start} al ${end}`))
    .join(', ')
}

function buildOverflowRiskNote(args: {
  product: string
  windowStart: string
  windowEnd: string
  requestedPallets: number
  overflowPallets: number
  blockedByProduct: ChamberScoreEntry[]
  blockedByRecipe: ChamberScoreEntry[]
}) {
  const notes = [
    `Faltan ${args.overflowPallets} pallet(s) por ubicar entre ${args.windowStart} y ${args.windowEnd} para ${args.product}.`,
  ]

  if (args.blockedByProduct.length > 0) {
    notes.push(
      `Bloqueo por producto: ${args.blockedByProduct
        .map(({ chamber, score }) => {
          const productGroups = formatNameList(
            [...new Set(score.conflictingProductGroups)].map(
              (group) => group || 'otro producto',
            ),
          )
          const blockedDays = formatDateRanges(score.conflictingProductDays)

          return `${chamber.name} con ${productGroups}${blockedDays ? ` en ${blockedDays}` : ''}`
        })
        .join('; ')}.`,
    )
  }

  if (args.blockedByRecipe.length > 0) {
    notes.push(
      `Bloqueo por receta: ${args.blockedByRecipe
        .map(({ chamber, score }) => {
          const recipes = formatNameList([...new Set(score.conflictingRecipes)])
          const blockedDays = formatDateRanges(score.conflictingRecipeDays)

          return `${chamber.name} con ${recipes}${blockedDays ? ` en ${blockedDays}` : ''}`
        })
        .join('; ')}.`,
    )
  }

  return notes.join(' ')
}

function compareChamberScores(
  left: ChamberScoreEntry,
  right: ChamberScoreEntry,
  remainingPallets: number,
) {
  const leftFitsRemaining = left.score.maxAdditionalPallets >= remainingPallets
  const rightFitsRemaining =
    right.score.maxAdditionalPallets >= remainingPallets

  return (
    Number(rightFitsRemaining) - Number(leftFitsRemaining) ||
    left.score.activatesNewChamber - right.score.activatesNewChamber ||
    right.score.maxAdditionalPallets - left.score.maxAdditionalPallets ||
    left.score.gapDaysBeforePlacement - right.score.gapDaysBeforePlacement
  )
}

export function buildSimulationSummary(
  sheet: ParsedSheet,
  options?: {
    chamberCount?: number
    scenarioId?: string
    unavailableChambers?: string[]
    conservationChambers?: string[]
    recipeOverrides?: Record<
      string,
      {
        programCode: string
        targetColorGrade: string
      }
    >
  },
): SimulationSummary {
  const missingFields = Object.entries(requiredFieldAliases)
    .filter(
      ([, aliases]) =>
        !aliases.some((alias) => sheet.dataframe.columnKeys.includes(alias)),
    )
    .map(([field]) => field)

  const chamberNames = buildChamberNames(
    options?.chamberCount ?? DEFAULT_CHAMBER_COUNT,
  )
  const unavailableChamberNames = chamberNames.filter((name) =>
    (options?.unavailableChambers ?? []).includes(name),
  )
  const conservationChamberNames = chamberNames.filter((name) =>
    (options?.conservationChambers ?? []).includes(name),
  )
  const availableChamberNames =
    unavailableChamberNames.length + conservationChamberNames.length >=
    chamberNames.length
      ? chamberNames.slice(0, 1)
      : chamberNames.filter(
          (name) =>
            !unavailableChamberNames.includes(name) &&
            !conservationChamberNames.includes(name),
        )
  const chamberSchedules: ChamberSchedule[] = availableChamberNames.map(
    createChamberSchedule,
  )

  const plannedOrders = sheet.dataframe.rows
    .map((row, index) => {
      const quantityBoxes = Math.max(
        parseNumericValue(pickField(row, fieldAliases.quantity, '0'), 0),
        0,
      )
      const price = Math.max(
        parseNumericValue(pickField(row, fieldAliases.price, '0'), 0),
        0,
      )
      const amount = Math.max(
        parseNumericValue(
          pickField(row, fieldAliases.amount, String(quantityBoxes * price)),
          quantityBoxes * price,
        ),
        0,
      )
      const product = pickField(row, fieldAliases.product, 'banana')
      const center = pickField(row, fieldAliases.center, 'Unassigned center')
      const provider = pickField(row, fieldAliases.provider, '')
      const ripener = pickField(row, fieldAliases.ripener, '')
      const recipeProgramCode = pickField(
        row,
        fieldAliases.recipeProgramCode,
        '',
      )
      const recipeTargetColorGrade = pickField(
        row,
        fieldAliases.recipeTargetColorGrade,
        '',
      )
      const purchaseOrderRef = pickField(row, fieldAliases.purchaseOrderRef, '')
      const dueDate = parseDateValue(
        pickField(row, fieldAliases.requiredDate, ''),
        index + 2,
      )
      const productGroup = inferChamberProductGroup(product)
      const pallets = Math.max(Math.ceil(quantityBoxes / BOXES_PER_PALLET), 1)
      const containers = Number((pallets / PALLETS_PER_CONTAINER).toFixed(2))
      return {
        id: `order-${index + 1}`,
        sourceRowIndex: index,
        product,
        productGroupKey: productGroup.key,
        productGroupLabel: productGroup.label,
        center,
        provider,
        ripener,
        purchaseOrderRef,
        dueDate,
        quantityBoxes,
        pallets,
        containers,
        price,
        amount,
        priorityWeight: getPriorityWeight(row.priority ?? ''),
        cycleDays: buildCycleDays(product, pallets, quantityBoxes),
        recipeProgramCode: recipeProgramCode || null,
        recipeTargetColorGrade: recipeTargetColorGrade || null,
        recipeTotalHours: null,
        recipeTotalDays: null,
      }
    })
    .sort((left, right) => {
      const dueDateDelta = left.dueDate.getTime() - right.dueDate.getTime()

      if (dueDateDelta !== 0) {
        return dueDateDelta
      }

      const priorityDelta = right.priorityWeight - left.priorityWeight

      if (priorityDelta !== 0) {
        return priorityDelta
      }

      return right.pallets - left.pallets
    })
    .flatMap((order) => {
      let bestPlan: {
        allocations: ChamberAllocation[]
        recipeProgramCode: string | null
        recipeTargetColorGrade: string | null
        recipeTotalHours: number | null
        recipeTotalDays: number | null
        startDate: Date
        windowDays: string[]
        overflowPallets: number
        lookbackDays: number
        activatesNewChamber: number
        chamberCountUsed: number
        totalGapDays: number
        cycleDays: number
        recipePenalty: number
        mixedProductDays: number
        recipeConflictDays: number
        conflictingProductGroups: string[]
        conflictingRecipes: string[]
      } | null = null
      const recipeOverride = order.recipeProgramCode
        ? {
            programCode: order.recipeProgramCode,
            targetColorGrade: order.recipeTargetColorGrade ?? '',
          }
        : options?.recipeOverrides?.[order.product]
      const candidateRecipes = listRipeningRecipes(order.product)
      const filteredRecipes =
        recipeOverride && candidateRecipes.length > 0
          ? candidateRecipes.filter(
              (recipe) =>
                recipe.programCode === recipeOverride.programCode &&
                recipe.targetColorGrade === recipeOverride.targetColorGrade,
            )
          : candidateRecipes
      const recipeCandidates =
        filteredRecipes.length > 0
          ? filteredRecipes
          : [
              {
                programCode:
                  recipeOverride?.programCode ?? order.recipeProgramCode,
                targetColorGrade:
                  recipeOverride?.targetColorGrade ??
                  order.recipeTargetColorGrade,
                totalHours: order.recipeTotalHours,
                totalDays: order.recipeTotalDays,
              },
            ]

      for (const recipe of recipeCandidates) {
        const recipeCycleDays =
          buildRecipeCycleDays(recipe.totalDays) ?? order.cycleDays
        const recipeKey = `${recipe.programCode ?? 'auto'}::${recipe.targetColorGrade ?? 'auto'}`
        const recipePenalty =
          recipe.programCode && recipe.targetColorGrade
            ? getRecipeScenarioPenalty(
                {
                  programCode: recipe.programCode,
                  targetColorGrade: recipe.targetColorGrade,
                },
                options?.scenarioId,
              )
            : 0
        const preferredStartDate = addDays(order.dueDate, -recipeCycleDays)

        for (
          let lookbackDays = 0;
          lookbackDays <= START_LOOKBACK_DAYS;
          lookbackDays += 1
        ) {
          const candidateStartDate = addDays(preferredStartDate, -lookbackDays)
          const candidateWindow = buildScheduleWindow(
            candidateStartDate,
            addDays(order.dueDate, -1),
          )

          const chamberOptions = chamberSchedules
            .map((chamber) => {
              const score = scoreChamberWindow(
                chamber,
                candidateWindow,
                0,
                order.productGroupKey,
                recipeKey,
                candidateStartDate,
              )

              return {
                chamber,
                score,
              }
            })
            .filter(
              ({ score }) =>
                score.mixedProductDays === 0 && score.recipeConflictDays === 0,
            )

          let remainingPallets = order.pallets
          const allocations: ChamberAllocation[] = []
          let activatesNewChambers = 0
          let totalGapDays = 0

          const unassignedOptions = [...chamberOptions]

          while (remainingPallets > 0 && unassignedOptions.length > 0) {
            unassignedOptions.sort((left, right) =>
              compareChamberScores(left, right, remainingPallets),
            )

            const nextOption = unassignedOptions.shift()

            if (!nextOption) {
              break
            }

            const { chamber, score } = nextOption

            if (remainingPallets <= 0) {
              break
            }

            if (score.maxAdditionalPallets <= 0) {
              continue
            }

            const allocatedPallets = Math.min(
              remainingPallets,
              score.maxAdditionalPallets,
            )

            allocations.push({
              chamber,
              pallets: allocatedPallets,
              gapDaysBeforePlacement: score.gapDaysBeforePlacement,
              activatesNewChamber: score.activatesNewChamber,
            })

            activatesNewChambers += score.activatesNewChamber
            totalGapDays += score.gapDaysBeforePlacement
            remainingPallets -= allocatedPallets
          }

          const overflowPallets = remainingPallets

          if (overflowPallets > 0) {
            const fallbackAllocation =
              allocations.at(-1) ??
              (chamberOptions[0]
                ? {
                    chamber: chamberOptions[0].chamber,
                    pallets: 0,
                    gapDaysBeforePlacement:
                      chamberOptions[0].score.gapDaysBeforePlacement,
                    activatesNewChamber:
                      chamberOptions[0].score.activatesNewChamber,
                  }
                : {
                    chamber: chamberSchedules[0],
                    pallets: 0,
                    gapDaysBeforePlacement: 0,
                    activatesNewChamber: 0,
                  })

            if (allocations.length === 0) {
              allocations.push(fallbackAllocation)
              activatesNewChambers += fallbackAllocation.activatesNewChamber
              totalGapDays += fallbackAllocation.gapDaysBeforePlacement
            }

            fallbackAllocation.pallets += overflowPallets
            remainingPallets = 0
          }

          const candidatePlan = {
            allocations,
            recipeProgramCode: recipe.programCode ?? null,
            recipeTargetColorGrade: recipe.targetColorGrade ?? null,
            recipeTotalHours: recipe.totalHours ?? null,
            recipeTotalDays: recipe.totalDays ?? null,
            startDate: candidateStartDate,
            windowDays: candidateWindow,
            overflowPallets,
            lookbackDays,
            activatesNewChamber: activatesNewChambers,
            chamberCountUsed: allocations.length,
            totalGapDays,
            cycleDays: recipeCycleDays,
            recipePenalty,
            mixedProductDays: 0,
            recipeConflictDays: 0,
            conflictingProductGroups: [],
            conflictingRecipes: [],
          }

          if (!bestPlan) {
            bestPlan = candidatePlan
            continue
          }

          const candidateScore =
            candidatePlan.mixedProductDays * 1_000_000_000_000 +
            candidatePlan.recipeConflictDays * 100_000_000_000 +
            candidatePlan.overflowPallets * 1_000_000 +
            candidatePlan.activatesNewChamber * 500_000 +
            candidatePlan.chamberCountUsed * 100_000 +
            candidatePlan.totalGapDays * 10_000 +
            candidatePlan.lookbackDays * 1_000 +
            candidatePlan.recipePenalty
          const bestScore =
            bestPlan.mixedProductDays * 1_000_000_000_000 +
            bestPlan.recipeConflictDays * 100_000_000_000 +
            bestPlan.overflowPallets * 1_000_000 +
            bestPlan.activatesNewChamber * 500_000 +
            bestPlan.chamberCountUsed * 100_000 +
            bestPlan.totalGapDays * 10_000 +
            bestPlan.lookbackDays * 1_000 +
            bestPlan.recipePenalty

          if (candidateScore < bestScore) {
            bestPlan = candidatePlan
          }

          if (
            bestPlan &&
            bestPlan.overflowPallets === 0 &&
            lookbackDays === 0
          ) {
            break
          }
        }
      }

      const finalPlan = bestPlan ?? {
        allocations: [
          {
            chamber: chamberSchedules[0],
            pallets: order.pallets,
            gapDaysBeforePlacement: 0,
            activatesNewChamber: 0,
          },
        ],
        recipeProgramCode: order.recipeProgramCode,
        recipeTargetColorGrade: order.recipeTargetColorGrade,
        recipeTotalHours: order.recipeTotalHours,
        recipeTotalDays: order.recipeTotalDays,
        startDate: addDays(order.dueDate, -order.cycleDays),
        windowDays: buildScheduleWindow(
          addDays(order.dueDate, -order.cycleDays),
          addDays(order.dueDate, -1),
        ),
        overflowPallets: 0,
        lookbackDays: 0,
        activatesNewChamber: 0,
        chamberCountUsed: 1,
        totalGapDays: 0,
        cycleDays: order.cycleDays,
        recipePenalty: 0,
        mixedProductDays: 0,
        recipeConflictDays: 0,
        conflictingProductGroups: [],
        conflictingRecipes: [],
      }

      const recipeKey = `${finalPlan.recipeProgramCode ?? 'auto'}::${finalPlan.recipeTargetColorGrade ?? 'auto'}`

      for (const allocation of finalPlan.allocations) {
        reserveChamberWindow(
          allocation.chamber,
          finalPlan.windowDays,
          allocation.pallets,
          order.productGroupKey,
          recipeKey,
        )
      }

      const scenarioStatus =
        finalPlan.mixedProductDays > 0 ||
        finalPlan.recipeConflictDays > 0 ||
        finalPlan.overflowPallets > 0
          ? 'late_risk'
          : finalPlan.cycleDays >= 5 || finalPlan.lookbackDays > 0
            ? 'in_ripening'
            : 'ready'
      const riskNote =
        finalPlan.mixedProductDays > 0
          ? `${finalPlan.allocations[0]?.chamber.name ?? 'Camara'} mezcla ${order.productGroupLabel} con ${finalPlan.conflictingProductGroups.join(', ')} durante ${finalPlan.mixedProductDays} dia(s). Cada camara debe madurar una sola familia de producto a la vez.`
          : finalPlan.recipeConflictDays > 0
            ? `${finalPlan.allocations[0]?.chamber.name ?? 'Camara'} superpone recetas distintas durante ${finalPlan.recipeConflictDays} dia(s): ${finalPlan.conflictingRecipes.join(', ')}.`
            : finalPlan.overflowPallets > 0
              ? `No alcanza la capacidad diaria disponible para ${order.product} antes de ${toIsoDate(order.dueDate)}. Faltan ${finalPlan.overflowPallets} pallet(s) por ubicar.`
              : finalPlan.lookbackDays > 0
                ? `Se adelanto ${finalPlan.lookbackDays} dia(s) para mantener la capacidad antes de ${toIsoDate(order.dueDate)}.`
                : finalPlan.cycleDays >= 6
                  ? `Requiere un ciclo de maduracion de ${finalPlan.cycleDays} dias antes de ${toIsoDate(order.dueDate)}.`
                  : null

      const segmentBoxes = splitBoxesByPallets(
        order.quantityBoxes,
        finalPlan.allocations.map((allocation) => allocation.pallets),
      )

      return finalPlan.allocations.map((allocation, allocationIndex) => ({
        id: `${order.id}-${allocationIndex + 1}`,
        sourceRowIndex: order.sourceRowIndex,
        product: order.product,
        productGroupLabel: order.productGroupLabel,
        center: order.center,
        provider: order.provider,
        ripener: order.ripener,
        purchaseOrderRef: order.purchaseOrderRef,
        recipeProgramCode: finalPlan.recipeProgramCode,
        recipeTargetColorGrade: finalPlan.recipeTargetColorGrade,
        recipeTotalHours: finalPlan.recipeTotalHours,
        recipeTotalDays: finalPlan.recipeTotalDays,
        requiredDate: toIsoDate(order.dueDate),
        quantityBoxes: segmentBoxes[allocationIndex] ?? 0,
        pallets: allocation.pallets,
        containers: Number(
          (allocation.pallets / PALLETS_PER_CONTAINER).toFixed(2),
        ),
        price: order.price,
        amount:
          order.quantityBoxes > 0
            ? Number(
                (
                  order.amount *
                  ((segmentBoxes[allocationIndex] ?? 0) / order.quantityBoxes)
                ).toFixed(2),
              )
            : 0,
        startDate: toIsoDate(finalPlan.startDate),
        chamberName: allocation.chamber.name,
        riskNote,
        scenarioStatus,
      })) satisfies DemandOrder[]
    })

  const compactableOrders = [...plannedOrders]
    .reduce((grouped, order) => {
      const existingOrder = grouped.get(order.sourceRowIndex)

      if (!existingOrder) {
        grouped.set(order.sourceRowIndex, {
          ...order,
        })

        return grouped
      }

      existingOrder.quantityBoxes += order.quantityBoxes
      existingOrder.pallets += order.pallets
      existingOrder.containers = Number(
        (existingOrder.pallets / PALLETS_PER_CONTAINER).toFixed(2),
      )
      existingOrder.amount = Number(
        (existingOrder.amount + order.amount).toFixed(2),
      )

      return grouped
    }, new Map<number, DemandOrder>())
    .values()

  const compactionSchedules: ChamberSchedule[] = availableChamberNames.map(
    createChamberSchedule,
  )

  const orders = [...compactableOrders]
    .sort((left, right) => {
      const startDelta =
        new Date(left.startDate).getTime() - new Date(right.startDate).getTime()

      if (startDelta !== 0) {
        return startDelta
      }

      const dueDelta =
        new Date(left.requiredDate).getTime() -
        new Date(right.requiredDate).getTime()

      if (dueDelta !== 0) {
        return dueDelta
      }

      return right.pallets - left.pallets
    })
    .flatMap((order) => {
      const recipeKey = `${order.recipeProgramCode ?? 'auto'}::${order.recipeTargetColorGrade ?? 'auto'}`
      const startDate = new Date(`${order.startDate}T00:00:00`)
      const dueDate = new Date(`${order.requiredDate}T00:00:00`)
      const productGroup = inferChamberProductGroup(order.product)
      const windowDays = buildScheduleWindow(startDate, addDays(dueDate, -1))
      const chamberScores: ChamberScoreEntry[] = compactionSchedules.map(
        (chamber) => {
          const score = scoreChamberWindow(
            chamber,
            windowDays,
            0,
            productGroup.key,
            recipeKey,
            startDate,
          )

          return {
            chamber,
            score,
          }
        },
      )
      const blockedByProduct = chamberScores.filter(
        ({ score }) => score.mixedProductDays > 0,
      )
      const blockedByRecipe = chamberScores.filter(
        ({ score }) =>
          score.mixedProductDays === 0 && score.recipeConflictDays > 0,
      )
      const chamberOptions = chamberScores.filter(
        ({ score }) =>
          score.mixedProductDays === 0 && score.recipeConflictDays === 0,
      )

      let remainingPallets = order.pallets
      const allocations: ChamberAllocation[] = []

      const unassignedOptions = [...chamberOptions]

      while (remainingPallets > 0 && unassignedOptions.length > 0) {
        unassignedOptions.sort((left, right) =>
          compareChamberScores(left, right, remainingPallets),
        )

        const nextOption = unassignedOptions.shift()

        if (!nextOption) {
          break
        }

        const { chamber, score } = nextOption

        if (remainingPallets <= 0) {
          break
        }

        if (score.maxAdditionalPallets <= 0) {
          continue
        }

        const allocatedPallets = Math.min(
          remainingPallets,
          score.maxAdditionalPallets,
        )

        allocations.push({
          chamber,
          pallets: allocatedPallets,
          gapDaysBeforePlacement: score.gapDaysBeforePlacement,
          activatesNewChamber: score.activatesNewChamber,
        })

        remainingPallets -= allocatedPallets
      }

      const overflowPallets = remainingPallets

      if (overflowPallets > 0) {
        const fallbackAllocation =
          allocations.at(-1) ??
          (chamberOptions[0]
            ? {
                chamber: chamberOptions[0].chamber,
                pallets: 0,
                gapDaysBeforePlacement:
                  chamberOptions[0].score.gapDaysBeforePlacement,
                activatesNewChamber:
                  chamberOptions[0].score.activatesNewChamber,
              }
            : {
                chamber: compactionSchedules[0],
                pallets: 0,
                gapDaysBeforePlacement: 0,
                activatesNewChamber: 0,
              })

        if (allocations.length === 0) {
          allocations.push(fallbackAllocation)
        }

        fallbackAllocation.pallets += overflowPallets
      }

      for (const allocation of allocations) {
        reserveChamberWindow(
          allocation.chamber,
          windowDays,
          allocation.pallets,
          productGroup.key,
          recipeKey,
        )
      }

      const cycleDays =
        buildRecipeCycleDays(order.recipeTotalDays) ??
        Math.max(
          differenceInDays(
            new Date(`${order.startDate}T00:00:00`),
            new Date(`${order.requiredDate}T00:00:00`),
          ),
          1,
        )
      const scenarioStatus =
        overflowPallets > 0
          ? 'late_risk'
          : cycleDays >= 5
            ? 'in_ripening'
            : 'ready'
      const riskNote =
        overflowPallets > 0
          ? buildOverflowRiskNote({
              product: order.product,
              windowStart: order.startDate,
              windowEnd: toIsoDate(addDays(dueDate, -1)),
              requestedPallets: order.pallets,
              overflowPallets,
              blockedByProduct,
              blockedByRecipe,
            })
          : null
      const segmentBoxes = splitBoxesByPallets(
        order.quantityBoxes,
        allocations.map((allocation) => allocation.pallets),
      )

      return allocations.map((allocation, allocationIndex) => ({
        ...order,
        id: `${order.id}-compact-${allocationIndex + 1}`,
        chamberName: allocation.chamber.name,
        quantityBoxes: segmentBoxes[allocationIndex] ?? 0,
        pallets: allocation.pallets,
        containers: Number(
          (allocation.pallets / PALLETS_PER_CONTAINER).toFixed(2),
        ),
        amount:
          order.quantityBoxes > 0
            ? Number(
                (
                  order.amount *
                  ((segmentBoxes[allocationIndex] ?? 0) / order.quantityBoxes)
                ).toFixed(2),
              )
            : 0,
        scenarioStatus,
        riskNote,
      })) satisfies DemandOrder[]
    })

  const totalBoxes = orders.reduce(
    (sum: number, order: DemandOrder) => sum + order.quantityBoxes,
    0,
  )
  const totalPallets = orders.reduce(
    (sum: number, order: DemandOrder) => sum + order.pallets,
    0,
  )
  const totalContainers = Math.ceil(totalPallets / PALLETS_PER_CONTAINER)
  const totalRevenue = orders.reduce(
    (sum: number, order: DemandOrder) => sum + order.amount,
    0,
  )
  const chamberUsage = chamberNames.map((name) => {
    const schedule = compactionSchedules.find((entry) => entry.name === name)
    const bookedValues = schedule
      ? [...schedule.bookedPalletsByDay.values()]
      : []

    return {
      name,
      peakBookedPallets:
        bookedValues.length > 0 ? Math.max(...bookedValues) : 0,
      totalBookedPalletDays: bookedValues.reduce(
        (sum, bookedPallets) => sum + bookedPallets,
        0,
      ),
      usedDays: bookedValues.filter((bookedPallets) => bookedPallets > 0)
        .length,
      activated: bookedValues.length > 0,
    } satisfies ChamberUsage
  })

  const rangeStart = orders
    .map((order: DemandOrder) => new Date(order.startDate))
    .sort((left: Date, right: Date) => left.getTime() - right.getTime())[0]
  const rangeEnd = orders
    .map((order: DemandOrder) => new Date(order.requiredDate))
    .sort((left: Date, right: Date) => left.getTime() - right.getTime())
    .at(-1)

  const dateRange: string[] = []

  if (rangeStart && rangeEnd) {
    const cursor = new Date(rangeStart)

    while (cursor <= rangeEnd) {
      dateRange.push(toIsoDate(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return {
    orders,
    chamberNames,
    unavailableChamberNames,
    conservationChamberNames,
    chamberUsage,
    totalBoxes,
    totalPallets,
    totalContainers,
    totalRevenue,
    dateRange,
    missingFields,
    assumptions: [
      'Quantity se interpreta como cajas.',
      `La conversion a pallet usa ${BOXES_PER_PALLET} cajas por pallet.`,
      `La conversion a contenedor usa ${PALLETS_PER_CONTAINER} pallets por contenedor.`,
      'Cada linea se contrasta con el catalogo de ciclos de maduracion antes de asignar camara.',
      'La receta se optimiza junto con la asignacion de camara priorizando fecha primero y minimizacion de camaras despues.',
      'La asignacion de camaras ahora prioriza continuidad operativa: encadenar ciclos con menos huecos antes de abrir una camara nueva.',
      `Se considera ${CHAMBER_CLEANING_BUFFER_DAYS} dia disponible entre ciclos como margen operativo aceptable para limpieza de camara.`,
      'Si la demanda no cabe dentro de las camaras configuradas, el plan mantiene el limite de camaras y marca el conflicto como riesgo operativo.',
      'Cada camara puede consolidar varias lineas dentro del mismo ciclo si comparten familia de producto, receta y caben en capacidad.',
      'Cada camara solo puede madurar una familia de producto a la vez: platano o palta, sin mezcla en dias superpuestos.',
      'La ocupacion mostrada refleja la carga concurrente maxima, no la suma bruta de todos los pallets del archivo.',
    ],
  }
}

export function buildSimulationMetrics(
  summary: SimulationSummary,
  progress: number,
): SimulationMetric[] {
  const ripeningChamberCount = summary.chamberNames.filter(
    (name) =>
      !summary.unavailableChamberNames.includes(name) &&
      !summary.conservationChamberNames.includes(name),
  ).length
  const activeChambers = summary.chamberUsage.filter(
    (chamber) => chamber.activated,
  ).length
  const allocatedPallets = Math.round(summary.totalPallets * progress)
  const fulfilledBoxes = Math.round(
    summary.totalBoxes * Math.min(progress * 1.08, 1),
  )

  return [
    {
      label: 'Contenedores estimados',
      value: `${summary.totalContainers}`,
      hint: 'Equivalencia logistica total derivada del volumen cargado.',
      tone: 'neutral',
    },
    {
      label: 'Pallets preparados',
      value: `${allocatedPallets}/${summary.totalPallets}`,
      hint: 'Requerimiento de pallets derivado del archivo cargado.',
      tone: 'positive',
    },
    {
      label: 'Cajas asignadas',
      value: `${fulfilledBoxes}/${summary.totalBoxes}`,
      hint: 'Asignacion de demanda avanzando sobre el archivo cargado.',
      tone: fulfilledBoxes >= summary.totalBoxes ? 'positive' : 'neutral',
    },
    {
      label: 'Camaras activas',
      value: `${activeChambers}/${ripeningChamberCount}`,
      hint: 'Cantidad real de camaras que el plan esta usando en el calendario.',
      tone: 'positive',
    },
  ]
}

export function buildChamberFill(summary: SimulationSummary, progress: number) {
  const grouped = new Map<
    string,
    {
      orders: number
      lateRiskOrders: number
      issueNote: string | null
      riskGroups: Set<string>
    }
  >()

  for (const order of summary.orders) {
    const previous = grouped.get(order.chamberName) ?? {
      orders: 0,
      lateRiskOrders: 0,
      issueNote: null,
      riskGroups: new Set<string>(),
    }

    if (order.scenarioStatus === 'late_risk') {
      previous.riskGroups.add(order.riskNote ?? order.id)
    }

    grouped.set(order.chamberName, {
      orders: previous.orders + 1,
      lateRiskOrders: previous.riskGroups.size,
      issueNote: previous.issueNote ?? order.riskNote,
      riskGroups: previous.riskGroups,
    })
  }

  return summary.chamberNames.map((name) => {
    const isUnavailable = summary.unavailableChamberNames.includes(name)
    const isConservation = summary.conservationChamberNames.includes(name)
    const usage = summary.chamberUsage.find((entry) => entry.name === name)
    const data = grouped.get(name) ?? {
      orders: 0,
      lateRiskOrders: 0,
      issueNote: null,
      riskGroups: new Set<string>(),
    }
    const occupancy = isUnavailable
      ? 100
      : Math.min(
          Math.round(
            ((usage?.peakBookedPallets ?? 0) / PALLETS_PER_CHAMBER) *
              100 *
              progress,
          ),
          100,
        )

    const status: ChamberFill['status'] =
      isUnavailable || data.lateRiskOrders > 0 ? 'issue' : 'healthy'

    return {
      name,
      occupancy,
      activeOrders: data.orders,
      lateRiskOrders: data.lateRiskOrders,
      issueNote:
        data.issueNote ??
        (isConservation
          ? 'Reservada como camara de conservacion para producto ya maduro.'
          : null) ??
        (usage?.activated
          ? `La carga concurrente mantiene ${name} ocupada durante ${usage.usedDays} dia(s) activos.`
          : null) ??
        (isUnavailable
          ? 'Marcada como ocupada antes de esta corrida de planificacion.'
          : null),
      status,
      hasIssue: isUnavailable || data.lateRiskOrders > 0,
      isUnavailable,
      mode: isUnavailable
        ? 'occupied'
        : isConservation
          ? 'conservation'
          : 'ripening',
    }
  }) satisfies ChamberFill[]
}

export function buildTimelineOrders(
  summary: SimulationSummary,
): TimelineOrder[] {
  return summary.orders.map((order) => {
    const startIndex = summary.dateRange.indexOf(order.startDate)

    return {
      ...order,
      startIndex: Math.max(startIndex, 0),
      span: Math.max(
        differenceInDays(
          new Date(order.startDate),
          new Date(order.requiredDate),
        ),
        1,
      ),
    }
  })
}
