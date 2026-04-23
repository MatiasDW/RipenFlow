import type { ParsedSheet } from '@/lib/purchase-file'

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
  product: ['product', 'producto', 'sku', 'item'],
} as const

const simulationStages = [
  {
    id: 'ingest',
    label: 'Demand intake',
    note: 'Validating customer file and checking required fields.',
  },
  {
    id: 'allocate',
    label: 'Lot allocation',
    note: 'Mapping demand against available lots and ripening recipes.',
  },
  {
    id: 'schedule',
    label: 'Chamber scheduling',
    note: 'Sequencing ripening chambers and estimating ready dates.',
  },
  {
    id: 'dispatch',
    label: 'Dispatch check',
    note: 'Reviewing late risk, surplus and economic exposure.',
  },
] as const

export type DemandOrder = {
  id: string
  product: string
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
}

export type TimelineOrder = DemandOrder & {
  startIndex: number
  span: number
}

type ChamberSchedule = {
  name: string
  bookedPalletsByDay: Map<string, number>
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

function buildCycleDays(product: string, pallets: number, quantityBoxes: number) {
  let cycleDays = 3
  const normalizedProduct = product.toLowerCase()

  if (normalizedProduct.includes('organic')) {
    cycleDays += 1
  }

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
  return Array.from(
    { length: Math.max(chamberCount, 1) },
    (_, index) => getChamberName(index),
  )
}

export function buildSimulationSummary(
  sheet: ParsedSheet,
  options?: {
    chamberCount?: number
  },
): SimulationSummary {
  const missingFields = Object.entries(fieldAliases)
    .filter(
      ([, aliases]) =>
        !aliases.some((alias) => sheet.dataframe.columnKeys.includes(alias)),
    )
    .map(([field]) => field)

  const chamberNames = buildChamberNames(
    options?.chamberCount ?? DEFAULT_CHAMBER_COUNT,
  )
  const chamberSchedules: ChamberSchedule[] = chamberNames.map((name) => ({
    name,
    bookedPalletsByDay: new Map<string, number>(),
  }))

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
      const product = pickField(row, fieldAliases.product, 'banana').toLowerCase()
      const dueDate = parseDateValue(
        pickField(row, fieldAliases.requiredDate, ''),
        index + 2,
      )
      const pallets = Math.max(Math.ceil(quantityBoxes / BOXES_PER_PALLET), 1)
      const containers = Math.max(
        Math.ceil(pallets / PALLETS_PER_CONTAINER),
        1,
      )

      return {
        id: `order-${index + 1}`,
        product,
        dueDate,
        quantityBoxes,
        pallets,
        containers,
        price,
        amount,
        priorityWeight: getPriorityWeight(row.priority ?? ''),
        cycleDays: buildCycleDays(product, pallets, quantityBoxes),
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
      const preferredStartDate = addDays(order.dueDate, -order.cycleDays)
      let bestPlan:
        | {
            chamber: ChamberSchedule
            startDate: Date
            windowDays: string[]
            overflowPallets: number
            lookbackDays: number
            totalOccupancy: number
          }
        | null = null

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
            startDate: candidateStartDate,
            windowDays: candidateWindow,
            overflowPallets: score.overflowPallets,
            lookbackDays,
            totalOccupancy: score.totalOccupancy,
          }

          if (!bestPlan) {
            bestPlan = candidatePlan
            continue
          }

          const candidateScore =
            candidatePlan.overflowPallets * 1000 +
            candidatePlan.lookbackDays * 40 +
            candidatePlan.totalOccupancy
          const bestScore =
            bestPlan.overflowPallets * 1000 +
            bestPlan.lookbackDays * 40 +
            bestPlan.totalOccupancy

          if (candidateScore < bestScore) {
            bestPlan = candidatePlan
          }
        }

        if (bestPlan && bestPlan.overflowPallets === 0) {
          break
        }
      }

      const finalPlan = bestPlan ?? {
        chamber: chamberSchedules[0],
        startDate: preferredStartDate,
        windowDays: buildScheduleWindow(
          preferredStartDate,
          addDays(order.dueDate, -1),
        ),
        overflowPallets: 0,
        lookbackDays: 0,
        totalOccupancy: order.pallets,
      }

      reserveChamberWindow(
        finalPlan.chamber,
        finalPlan.windowDays,
        order.pallets,
      )

      const scenarioStatus =
        finalPlan.overflowPallets > 0
          ? 'late_risk'
          : order.cycleDays >= 5 || finalPlan.lookbackDays > 0
            ? 'in_ripening'
            : 'ready'
      const riskNote =
        finalPlan.overflowPallets > 0
          ? `${finalPlan.chamber.name} exceeds nominal capacity by ${finalPlan.overflowPallets} pallet(s) before ${toIsoDate(order.dueDate)}.`
          : finalPlan.lookbackDays > 0
            ? `Pulled ${finalPlan.lookbackDays} day(s) earlier to keep ${finalPlan.chamber.name} within capacity before ${toIsoDate(order.dueDate)}.`
            : order.cycleDays >= 6
              ? `Requires a ${order.cycleDays}-day ripening cycle before ${toIsoDate(order.dueDate)}.`
              : null

      return {
        id: order.id,
        product: order.product,
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
  const totalContainers = orders.reduce(
    (sum: number, order: DemandOrder) => sum + order.containers,
    0,
  )
  const totalRevenue = orders.reduce(
    (sum: number, order: DemandOrder) => sum + order.amount,
    0,
  )

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
      pallets: number
      orders: number
      lateRiskOrders: number
      issueNote: string | null
    }
  >()

  for (const order of summary.orders) {
    const previous = grouped.get(order.chamberName) ?? {
      pallets: 0,
      orders: 0,
      lateRiskOrders: 0,
      issueNote: null,
    }

    grouped.set(order.chamberName, {
      pallets: previous.pallets + order.pallets,
      orders: previous.orders + 1,
      lateRiskOrders:
        previous.lateRiskOrders +
        (order.scenarioStatus === 'late_risk' ? 1 : 0),
      issueNote: previous.issueNote ?? order.riskNote,
    })
  }

  return summary.chamberNames.map((name) => {
    const data = grouped.get(name) ?? {
      pallets: 0,
      orders: 0,
      lateRiskOrders: 0,
      issueNote: null,
    }
    const occupancy = Math.min(
      Math.round((data.pallets / PALLETS_PER_CHAMBER) * 100 * progress),
      100,
    )

    return {
      name,
      occupancy,
      activeOrders: data.orders,
      lateRiskOrders: data.lateRiskOrders,
      issueNote: data.issueNote,
      status: data.lateRiskOrders > 0 ? 'issue' : 'healthy',
      hasIssue: data.lateRiskOrders > 0,
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
        ) + 1,
        1,
      ),
    }
  })
}

export function getSimulationStageState(progress: number) {
  const totalStages = simulationStages.length
  const scaledProgress = progress * totalStages

  return simulationStages.map((stage, index) => {
    const stageProgress = Math.min(Math.max(scaledProgress - index, 0), 1)

    return {
      ...stage,
      progress: stageProgress,
      status:
        stageProgress >= 1 ? 'done' : stageProgress > 0 ? 'active' : 'pending',
    } as const
  })
}
