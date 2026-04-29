import type { ParsedSheet } from '@/lib/purchase-file'
import {
  getRecipeScenarioPenalty,
  listRipeningRecipes,
} from '@/lib/ripening-cycles'

const BOXES_PER_PALLET = 54
const PALLETS_PER_CONTAINER = 20
const PALLETS_PER_CHAMBER = 24
const DEFAULT_CHAMBER_COUNT = 4
const START_LOOKBACK_DAYS = 6

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
} as const

const requiredFieldAliases = {
  requiredDate: fieldAliases.requiredDate,
  quantity: fieldAliases.quantity,
  product: fieldAliases.product,
} as const

export type DemandOrder = {
  id: string
  product: string
  center: string
  provider: string
  ripener: string
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
}

export type TimelineOrder = DemandOrder & {
  startIndex: number
  span: number
}

type ChamberSchedule = {
  name: string
  bookedPalletsByDay: Map<string, number>
}

type ChamberUsage = {
  name: string
  peakBookedPallets: number
  totalBookedPalletDays: number
  usedDays: number
  activated: boolean
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
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

function scoreChamberWindow(
  chamber: ChamberSchedule,
  windowDays: string[],
  pallets: number,
) {
  let peakOccupancy = 0
  let totalOccupancy = 0

  for (const day of windowDays) {
    const nextOccupancy = (chamber.bookedPalletsByDay.get(day) ?? 0) + pallets
    peakOccupancy = Math.max(peakOccupancy, nextOccupancy)
    totalOccupancy += nextOccupancy
  }

  return {
    peakOccupancy,
    totalOccupancy,
    overflowPallets: Math.max(peakOccupancy - PALLETS_PER_CHAMBER, 0),
    activatesNewChamber: chamber.bookedPalletsByDay.size === 0 ? 1 : 0,
    headroomAfterPlacement: Math.max(PALLETS_PER_CHAMBER - peakOccupancy, 0),
  }
}

function reserveChamberWindow(
  chamber: ChamberSchedule,
  windowDays: string[],
  pallets: number,
) {
  for (const day of windowDays) {
    chamber.bookedPalletsByDay.set(
      day,
      (chamber.bookedPalletsByDay.get(day) ?? 0) + pallets,
    )
  }
}

function getChamberName(index: number) {
  if (index < 26) {
    return `Chamber ${String.fromCharCode(65 + index)}`
  }

  return `Chamber ${index + 1}`
}

function buildChamberNames(chamberCount: number) {
  return Array.from({ length: Math.max(chamberCount, 1) }, (_, index) =>
    getChamberName(index),
  )
}

export function buildSimulationSummary(
  sheet: ParsedSheet,
  options?: {
    chamberCount?: number
    scenarioId?: string
    unavailableChambers?: string[]
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
  const availableChamberNames =
    unavailableChamberNames.length >= chamberNames.length
      ? chamberNames.slice(0, 1)
      : chamberNames.filter((name) => !unavailableChamberNames.includes(name))
  const chamberSchedules: ChamberSchedule[] = availableChamberNames.map(
    (name) => ({
      name,
      bookedPalletsByDay: new Map<string, number>(),
    }),
  )

  const orders = sheet.dataframe.rows
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
      const dueDate = parseDateValue(
        pickField(row, fieldAliases.requiredDate, ''),
        index + 2,
      )
      const pallets = Math.max(Math.ceil(quantityBoxes / BOXES_PER_PALLET), 1)
      const containers = Number((pallets / PALLETS_PER_CONTAINER).toFixed(2))
      return {
        id: `order-${index + 1}`,
        product,
        center,
        provider,
        ripener,
        dueDate,
        quantityBoxes,
        pallets,
        containers,
        price,
        amount,
        priorityWeight: getPriorityWeight(row.priority ?? ''),
        cycleDays: buildCycleDays(product, pallets, quantityBoxes),
        recipeProgramCode: null,
        recipeTargetColorGrade: null,
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
    .map((order) => {
      let bestPlan: {
        chamber: ChamberSchedule
        recipeProgramCode: string | null
        recipeTargetColorGrade: string | null
        recipeTotalHours: number | null
        recipeTotalDays: number | null
        startDate: Date
        windowDays: string[]
        overflowPallets: number
        lookbackDays: number
        totalOccupancy: number
        activatesNewChamber: number
        headroomAfterPlacement: number
        cycleDays: number
        recipePenalty: number
      } | null = null
      const candidateRecipes = listRipeningRecipes(order.product)
      const recipeCandidates =
        candidateRecipes.length > 0
          ? candidateRecipes
          : [
              {
                programCode: order.recipeProgramCode,
                targetColorGrade: order.recipeTargetColorGrade,
                totalHours: order.recipeTotalHours,
                totalDays: order.recipeTotalDays,
              },
            ]

      for (const recipe of recipeCandidates) {
        const recipeCycleDays =
          buildRecipeCycleDays(recipe.totalDays) ?? order.cycleDays
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

          for (const chamber of chamberSchedules) {
            const score = scoreChamberWindow(
              chamber,
              candidateWindow,
              order.pallets,
            )
            const candidatePlan = {
              chamber,
              recipeProgramCode: recipe.programCode ?? null,
              recipeTargetColorGrade: recipe.targetColorGrade ?? null,
              recipeTotalHours: recipe.totalHours ?? null,
              recipeTotalDays: recipe.totalDays ?? null,
              startDate: candidateStartDate,
              windowDays: candidateWindow,
              overflowPallets: score.overflowPallets,
              lookbackDays,
              totalOccupancy: score.totalOccupancy,
              activatesNewChamber: score.activatesNewChamber,
              headroomAfterPlacement: score.headroomAfterPlacement,
              cycleDays: recipeCycleDays,
              recipePenalty,
            }

            if (!bestPlan) {
              bestPlan = candidatePlan
              continue
            }

            const candidateScore =
              candidatePlan.overflowPallets * 1_000_000 +
              candidatePlan.lookbackDays * 10_000 +
              candidatePlan.activatesNewChamber * 1_000 +
              candidatePlan.headroomAfterPlacement * 10 +
              candidatePlan.recipePenalty +
              candidatePlan.totalOccupancy
            const bestScore =
              bestPlan.overflowPallets * 1_000_000 +
              bestPlan.lookbackDays * 10_000 +
              bestPlan.activatesNewChamber * 1_000 +
              bestPlan.headroomAfterPlacement * 10 +
              bestPlan.recipePenalty +
              bestPlan.totalOccupancy

            if (candidateScore < bestScore) {
              bestPlan = candidatePlan
            }
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
        chamber: chamberSchedules[0],
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
        totalOccupancy: order.pallets,
        activatesNewChamber: 0,
        headroomAfterPlacement: Math.max(
          PALLETS_PER_CHAMBER - order.pallets,
          0,
        ),
        cycleDays: order.cycleDays,
        recipePenalty: 0,
      }

      reserveChamberWindow(
        finalPlan.chamber,
        finalPlan.windowDays,
        order.pallets,
      )

      const scenarioStatus =
        finalPlan.overflowPallets > 0
          ? 'late_risk'
          : finalPlan.cycleDays >= 5 || finalPlan.lookbackDays > 0
            ? 'in_ripening'
            : 'ready'
      const riskNote =
        finalPlan.overflowPallets > 0
          ? `${finalPlan.chamber.name} exceeds nominal capacity by ${finalPlan.overflowPallets} pallet(s) before ${toIsoDate(order.dueDate)}.`
          : finalPlan.lookbackDays > 0
            ? `Pulled ${finalPlan.lookbackDays} day(s) earlier to keep ${finalPlan.chamber.name} within capacity before ${toIsoDate(order.dueDate)}.`
            : finalPlan.cycleDays >= 6
              ? `Requires a ${finalPlan.cycleDays}-day ripening cycle before ${toIsoDate(order.dueDate)}.`
              : null

      return {
        id: order.id,
        product: order.product,
        center: order.center,
        provider: order.provider,
        ripener: order.ripener,
        recipeProgramCode: finalPlan.recipeProgramCode,
        recipeTargetColorGrade: finalPlan.recipeTargetColorGrade,
        recipeTotalHours: finalPlan.recipeTotalHours,
        recipeTotalDays: finalPlan.recipeTotalDays,
        requiredDate: toIsoDate(order.dueDate),
        quantityBoxes: order.quantityBoxes,
        pallets: order.pallets,
        containers: order.containers,
        price: order.price,
        amount: order.amount,
        startDate: toIsoDate(finalPlan.startDate),
        chamberName: finalPlan.chamber.name,
        riskNote,
        scenarioStatus,
      } satisfies DemandOrder
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
    const schedule = chamberSchedules.find((entry) => entry.name === name)
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
    chamberUsage,
    totalBoxes,
    totalPallets,
    totalContainers,
    totalRevenue,
    dateRange,
    missingFields,
    assumptions: [
      'Quantity is interpreted as boxes.',
      `Pallet conversion uses ${BOXES_PER_PALLET} boxes per pallet.`,
      `Container conversion uses ${PALLETS_PER_CONTAINER} pallets per container.`,
      'Each order line is tested against the seeded ripening cycle catalog before chamber assignment.',
      'Recipe choice is optimized together with chamber assignment using due-date protection first and chamber minimization second.',
      'Chamber assignment now prefers fewer active chambers unless that would increase lateness or overflow.',
      'Displayed chamber occupancy reflects peak concurrent pallet load, not the raw sum of all pallets across the entire file.',
    ],
  }
}

export function buildSimulationMetrics(
  summary: SimulationSummary,
  progress: number,
): SimulationMetric[] {
  const filledContainers = Math.round(summary.totalContainers * progress)
  const allocatedPallets = Math.round(summary.totalPallets * progress)
  const fulfilledBoxes = Math.round(
    summary.totalBoxes * Math.min(progress * 1.08, 1),
  )
  const lateRiskOrders = summary.orders.filter(
    (order) => order.scenarioStatus === 'late_risk',
  ).length
  const economicExposure = summary.totalRevenue * (1 - progress) * 0.18

  return [
    {
      label: 'Containers filling',
      value: `${filledContainers}/${summary.totalContainers}`,
      hint: 'Visible chamber load as the scenario progresses.',
      tone:
        filledContainers >= summary.totalContainers ? 'positive' : 'neutral',
    },
    {
      label: 'Pallets staged',
      value: `${allocatedPallets}/${summary.totalPallets}`,
      hint: 'Pallet requirement derived from uploaded demand.',
      tone: 'positive',
    },
    {
      label: 'Boxes assigned',
      value: `${fulfilledBoxes}/${summary.totalBoxes}`,
      hint: 'Demand allocation progressing against uploaded orders.',
      tone: fulfilledBoxes >= summary.totalBoxes ? 'positive' : 'neutral',
    },
    {
      label: 'Economic exposure',
      value: formatCurrency(economicExposure),
      hint: `${lateRiskOrders} order(s) still show due-date risk.`,
      tone: economicExposure <= 0 ? 'positive' : 'warning',
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
    }
  >()

  for (const order of summary.orders) {
    const previous = grouped.get(order.chamberName) ?? {
      orders: 0,
      lateRiskOrders: 0,
      issueNote: null,
    }

    grouped.set(order.chamberName, {
      orders: previous.orders + 1,
      lateRiskOrders:
        previous.lateRiskOrders +
        (order.scenarioStatus === 'late_risk' ? 1 : 0),
      issueNote: previous.issueNote ?? order.riskNote,
    })
  }

  return summary.chamberNames
    .map((name) => {
      const isUnavailable = summary.unavailableChamberNames.includes(name)
      const usage = summary.chamberUsage.find((entry) => entry.name === name)
      const data = grouped.get(name) ?? {
        orders: 0,
        lateRiskOrders: 0,
        issueNote: null,
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
          (usage?.activated
            ? `Peak concurrent load reaches ${usage.peakBookedPallets}/${PALLETS_PER_CHAMBER} pallets across ${usage.usedDays} active day(s).`
            : null) ??
          (isUnavailable
            ? 'Marked as already occupied before this planning run.'
            : null),
        status,
        hasIssue: isUnavailable || data.lateRiskOrders > 0,
        isUnavailable,
      }
    })
    .filter(
      (chamber) => chamber.activeOrders > 0 || chamber.isUnavailable,
    ) satisfies ChamberFill[]
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
        ) + 1,
        1,
      ),
    }
  })
}
