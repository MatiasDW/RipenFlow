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
  product: string
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
  bookedProductGroupByDay: Map<string, string>
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
) {
  let peakOccupancy = 0
  let totalOccupancy = 0
  let mixedProductDays = 0
  const conflictingProductGroups = new Set<string>()

  for (const day of windowDays) {
    const bookedProductGroup = chamber.bookedProductGroupByDay.get(day)

    if (bookedProductGroup && bookedProductGroup !== productGroupKey) {
      mixedProductDays += 1
      conflictingProductGroups.add(bookedProductGroup)
    }

    const nextOccupancy = (chamber.bookedPalletsByDay.get(day) ?? 0) + pallets
    peakOccupancy = Math.max(peakOccupancy, nextOccupancy)
    totalOccupancy += nextOccupancy
  }

  return {
    peakOccupancy,
    totalOccupancy,
    mixedProductDays,
    conflictingProductGroups: [...conflictingProductGroups],
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
) {
  for (const day of windowDays) {
    chamber.bookedPalletsByDay.set(
      day,
      (chamber.bookedPalletsByDay.get(day) ?? 0) + pallets,
    )

    if (!chamber.bookedProductGroupByDay.has(day)) {
      chamber.bookedProductGroupByDay.set(day, productGroupKey)
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
      bookedProductGroupByDay: new Map<string, string>(),
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
        mixedProductDays: number
        conflictingProductGroups: string[]
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
              order.productGroupKey,
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
              mixedProductDays: score.mixedProductDays,
              conflictingProductGroups: score.conflictingProductGroups,
            }

            if (!bestPlan) {
              bestPlan = candidatePlan
              continue
            }

            const candidateScore =
              candidatePlan.mixedProductDays * 1_000_000_000 +
              candidatePlan.overflowPallets * 1_000_000 +
              candidatePlan.lookbackDays * 10_000 +
              candidatePlan.activatesNewChamber * 1_000 +
              candidatePlan.headroomAfterPlacement * 10 +
              candidatePlan.recipePenalty +
              candidatePlan.totalOccupancy
            const bestScore =
              bestPlan.mixedProductDays * 1_000_000_000 +
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
        mixedProductDays: 0,
        conflictingProductGroups: [],
      }

      reserveChamberWindow(
        finalPlan.chamber,
        finalPlan.windowDays,
        order.pallets,
        order.productGroupKey,
      )

      const scenarioStatus =
        finalPlan.mixedProductDays > 0 || finalPlan.overflowPallets > 0
          ? 'late_risk'
          : finalPlan.cycleDays >= 5 || finalPlan.lookbackDays > 0
            ? 'in_ripening'
            : 'ready'
      const riskNote =
        finalPlan.mixedProductDays > 0
          ? `${finalPlan.chamber.name} mezcla ${order.productGroupLabel} con ${finalPlan.conflictingProductGroups.join(', ')} durante ${finalPlan.mixedProductDays} dia(s). Cada camara debe madurar una sola familia de producto a la vez.`
          : finalPlan.overflowPallets > 0
            ? `${finalPlan.chamber.name} supera la capacidad nominal por ${finalPlan.overflowPallets} pallet(s) antes de ${toIsoDate(order.dueDate)}.`
            : finalPlan.lookbackDays > 0
              ? `Se adelanto ${finalPlan.lookbackDays} dia(s) para mantener ${finalPlan.chamber.name} dentro de capacidad antes de ${toIsoDate(order.dueDate)}.`
              : finalPlan.cycleDays >= 6
                ? `Requiere un ciclo de maduracion de ${finalPlan.cycleDays} dias antes de ${toIsoDate(order.dueDate)}.`
                : null

      return {
        id: order.id,
        product: order.product,
        center: order.center,
        provider: order.provider,
        ripener: order.ripener,
        purchaseOrderRef: order.purchaseOrderRef,
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
      'Quantity se interpreta como cajas.',
      `La conversion a pallet usa ${BOXES_PER_PALLET} cajas por pallet.`,
      `La conversion a contenedor usa ${PALLETS_PER_CONTAINER} pallets por contenedor.`,
      'Cada linea se contrasta con el catalogo de ciclos de maduracion antes de asignar camara.',
      'La receta se optimiza junto con la asignacion de camara priorizando fecha primero y minimizacion de camaras despues.',
      'La asignacion de camaras prefiere menos camaras activas salvo que eso aumente atraso o overflow.',
      'Cada camara solo puede madurar una familia de producto a la vez: platano o palta, sin mezcla en dias superpuestos.',
      'La ocupacion mostrada refleja la carga concurrente maxima, no la suma bruta de todos los pallets del archivo.',
    ],
  }
}

export function buildSimulationMetrics(
  summary: SimulationSummary,
  progress: number,
): SimulationMetric[] {
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
      value: `${activeChambers}/${summary.chamberNames.length}`,
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
            ? `La carga concurrente maxima llega a ${usage.peakBookedPallets}/${PALLETS_PER_CHAMBER} pallets en ${usage.usedDays} dia(s) activos.`
            : null) ??
          (isUnavailable
            ? 'Marcada como ocupada antes de esta corrida de planificacion.'
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
