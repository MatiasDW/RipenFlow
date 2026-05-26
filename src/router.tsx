import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'

import { exportSimulationWorkbook } from '@/lib/export-simulation'
import {
  fetchPlanningState,
  persistChamberConfig,
  persistPlanningWorkbook,
  replacePlanningWorkbook,
} from '@/lib/planning-api'
import {
  findMissingColumnKeys,
  formatBytes,
  type ParsedWorkbook,
  parsePurchaseFile,
  purchaseFileLimits,
} from '@/lib/purchase-file'
import { listRipeningRecipes } from '@/lib/ripening-cycles'
import {
  buildChamberFill,
  buildSimulationMetrics,
  buildSimulationSummary,
  buildTimelineOrders,
  type ChamberFill,
  type TimelineOrder,
} from '@/lib/simulation-lab'

const expectedFields = ['required_date', 'quantity', 'product']

const defaultChamberCount = 4
const minChamberCount = 1
const maxChamberCount = 12

type UploadIssueModal = {
  title: string
  reasons: string[]
}

type GroupedBarViewer = {
  title: string
  subtitle: string
  sourceRowIndexes: number[]
}

type DailyFlowDay = {
  date: string
  weekday: string
  weekdayShort: string
  weekLabel: string
  totalInboundBoxes: number
  totalOutboundBoxes: number
  organicOutboundBoxes: number
  platanoOutboundBoxes: number
  paltaOutboundBoxes: number
  totalMovementBoxes: number
  totalBookedPallets: number
  availablePallets: number
}

type DailyFlowChamberRow = {
  name: string
  mode: ChamberMode
  productSummary: string[]
  inboundByDate: Record<string, number>
  outboundByDate: Record<string, number>
  inboundProductsByDate: Record<string, string[]>
  outboundProductsByDate: Record<string, string[]>
  activeProductsByDate: Record<string, string[]>
  purchaseOrdersByDate: Record<string, string[]>
  riskByDate: Record<string, string>
  hasIssue: boolean
  isUnavailable: boolean
  lateRiskOrders: number
  issueNote: string | null
  activeLineCount: number
}

type DailyFlowBoard = {
  days: DailyFlowDay[]
  chamberRows: DailyFlowChamberRow[]
}

type ChamberMode = 'ripening' | 'conservation' | 'occupied'

type CalendarViewMode = 'day' | 'week' | 'month'

type SchedulerOperationType = 'inbound' | 'outbound'

type SchedulerOperationEvent = {
  id: string
  date: string
  chamberName: string
  product: string
  productGroupLabel: string
  recipeLabel: string
  operationType: SchedulerOperationType
  quantityBoxes: number
  startMinute: number
  endMinute: number
  lane: number
  laneCount: number
  sourceRowIndexes: number[]
  purchaseOrders: string[]
  riskNote: string | null
}

type RecipeOverride = {
  programCode: string
  targetColorGrade: string
}

const SCHEDULER_DAY_START_HOUR = 0
const SCHEDULER_DAY_END_HOUR = 24
const SCHEDULER_HOUR_ROW_HEIGHT = 44

type PlanningEditorDraft = {
  sourceRowIndex: number | null
  required_date: string
  product: string
  quantity: string
  center: string
  purchase_order_ref: string
  provider: string
  ripener: string
  sku_family: string
  uom: string
  recipe_program_code: string
  recipe_target_color_grade: string
}

function formatRequiredFields(fieldNames: string[]) {
  return fieldNames.join(', ')
}

function normalizeSortValue(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function compareTextValues(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return normalizeSortValue(left).localeCompare(normalizeSortValue(right))
}

function formatCalendarDate(date: string | null | undefined) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return 'Fecha sin programar'
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsedDate)
}

function formatWeekdayLabel(date: string) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return ''
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
  }).format(parsedDate)
}

function formatWeekdayShortLabel(date: string) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return ''
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  return new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
  })
    .format(parsedDate)
    .replace('.', '')
    .toUpperCase()
}

function formatWeekLabel(date: string) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return ''
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  const thursday = new Date(parsedDate)
  thursday.setDate(parsedDate.getDate() + 3 - ((parsedDate.getDay() + 6) % 7))
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  firstThursday.setDate(
    firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7),
  )
  const weekNumber =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) /
        (7 * 24 * 60 * 60 * 1000),
    )

  return `SEM ${String(weekNumber).padStart(2, '0')}`
}

function getVisualWeekStart(date: string) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return ''
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  const sunday = new Date(parsedDate)
  sunday.setDate(parsedDate.getDate() - parsedDate.getDay())

  return sunday.toISOString().slice(0, 10)
}

function formatMonthLabel(date: string) {
  const normalizedDate = normalizeSortValue(date)

  if (!normalizedDate) {
    return ''
  }

  const parsedDate = new Date(`${normalizedDate}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedDate
  }

  return new Intl.DateTimeFormat('es-CL', {
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function buildDailyFlowBoard(
  orders: TimelineOrder[],
  chambers: ChamberFill[],
  dateRange: string[],
): DailyFlowBoard {
  const ripeningCapacityPallets =
    chambers.filter((chamber) => chamber.mode === 'ripening').length * 24
  const days: DailyFlowDay[] = dateRange.map((date) => ({
    date,
    weekday: formatWeekdayLabel(date),
    weekdayShort: formatWeekdayShortLabel(date),
    weekLabel: formatWeekLabel(date),
    totalInboundBoxes: 0,
    totalOutboundBoxes: 0,
    organicOutboundBoxes: 0,
    platanoOutboundBoxes: 0,
    paltaOutboundBoxes: 0,
    totalMovementBoxes: 0,
    totalBookedPallets: 0,
    availablePallets: ripeningCapacityPallets,
  }))

  const dayIndex = new Map(days.map((day, index) => [day.date, index]))
  const chamberRows: DailyFlowChamberRow[] = chambers.map((chamber) => ({
    name: chamber.name,
    mode: chamber.mode,
    productSummary: [],
    inboundByDate: {},
    outboundByDate: {},
    inboundProductsByDate: {},
    outboundProductsByDate: {},
    activeProductsByDate: {},
    purchaseOrdersByDate: {},
    riskByDate: {},
    hasIssue: chamber.isUnavailable,
    isUnavailable: chamber.isUnavailable,
    lateRiskOrders: 0,
    issueNote: chamber.isUnavailable ? chamber.issueNote : null,
    activeLineCount: 0,
  }))
  const chamberIndex = new Map(chamberRows.map((row) => [row.name, row]))

  for (const order of orders) {
    const inboundDay = dayIndex.get(order.startDate)
    const outboundDay = dayIndex.get(order.requiredDate)
    const chamberRow = chamberIndex.get(order.chamberName)
    const start = new Date(`${order.startDate}T00:00:00`)
    const end = new Date(`${order.requiredDate}T00:00:00`)

    if (inboundDay !== undefined) {
      days[inboundDay].totalInboundBoxes += order.quantityBoxes
      days[inboundDay].totalMovementBoxes += order.quantityBoxes
    }

    if (outboundDay !== undefined) {
      days[outboundDay].totalOutboundBoxes += order.quantityBoxes
      days[outboundDay].totalMovementBoxes += order.quantityBoxes

      if (order.productGroupLabel === 'platano') {
        days[outboundDay].platanoOutboundBoxes += order.quantityBoxes
      } else if (order.productGroupLabel === 'palta') {
        days[outboundDay].paltaOutboundBoxes += order.quantityBoxes
      }

      if (normalizeSearchValue(order.product).includes('organic')) {
        days[outboundDay].organicOutboundBoxes += order.quantityBoxes
      }
    }

    if (chamberRow) {
      chamberRow.activeLineCount += 1
      if (!chamberRow.productSummary.includes(order.product)) {
        chamberRow.productSummary = [
          ...chamberRow.productSummary,
          order.product,
        ]
      }
      chamberRow.inboundByDate[order.startDate] =
        (chamberRow.inboundByDate[order.startDate] ?? 0) + order.quantityBoxes
      chamberRow.outboundByDate[order.requiredDate] =
        (chamberRow.outboundByDate[order.requiredDate] ?? 0) +
        order.quantityBoxes
      chamberRow.inboundProductsByDate[order.startDate] = [
        ...(chamberRow.inboundProductsByDate[order.startDate] ?? []),
        order.product,
      ]
      chamberRow.outboundProductsByDate[order.requiredDate] = [
        ...(chamberRow.outboundProductsByDate[order.requiredDate] ?? []),
        order.product,
      ]
      chamberRow.purchaseOrdersByDate[order.requiredDate] = [
        ...(chamberRow.purchaseOrdersByDate[order.requiredDate] ?? []),
        order.purchaseOrderRef || order.id,
      ]

      if (order.riskNote) {
        chamberRow.hasIssue = true
        chamberRow.issueNote ??= order.riskNote
        if (order.scenarioStatus === 'late_risk') {
          chamberRow.lateRiskOrders += 1
        }

        for (
          const cursor = new Date(start);
          cursor < end;
          cursor.setDate(cursor.getDate() + 1)
        ) {
          const day = cursor.toISOString().slice(0, 10)
          chamberRow.activeProductsByDate[day] = [
            ...(chamberRow.activeProductsByDate[day] ?? []),
            order.product,
          ]
          chamberRow.purchaseOrdersByDate[day] = [
            ...(chamberRow.purchaseOrdersByDate[day] ?? []),
            order.purchaseOrderRef || order.id,
          ]

          if (!chamberRow.riskByDate[day]) {
            chamberRow.riskByDate[day] = order.riskNote
          }
        }
      } else {
        for (
          const cursor = new Date(start);
          cursor < end;
          cursor.setDate(cursor.getDate() + 1)
        ) {
          const day = cursor.toISOString().slice(0, 10)
          chamberRow.activeProductsByDate[day] = [
            ...(chamberRow.activeProductsByDate[day] ?? []),
            order.product,
          ]
          chamberRow.purchaseOrdersByDate[day] = [
            ...(chamberRow.purchaseOrdersByDate[day] ?? []),
            order.purchaseOrderRef || order.id,
          ]
        }
      }
    }

    for (
      const cursor = new Date(start);
      cursor < end;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const day = cursor.toISOString().slice(0, 10)
      const index = dayIndex.get(day)

      if (index !== undefined) {
        days[index].totalBookedPallets += order.pallets
      }
    }
  }

  for (const day of days) {
    day.availablePallets = Math.max(
      ripeningCapacityPallets - day.totalBookedPallets,
      0,
    )
  }

  return {
    days,
    chamberRows,
  }
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase()
}

function buildFlowBoardChamberStatus(row: DailyFlowChamberRow) {
  if (row.mode === 'conservation') {
    return 'Conservacion'
  }

  if (row.hasIssue) {
    if (row.isUnavailable) {
      return 'Ocupada'
    }

    if (row.lateRiskOrders > 0) {
      return `${row.lateRiskOrders} alerta`
    }

    return 'Alerta'
  }

  if (row.activeLineCount === 0) {
    return 'Disponible'
  }

  return 'En plan'
}

function buildFlowBoardChamberStatusTone(row: DailyFlowChamberRow) {
  if (row.mode === 'conservation') {
    return 'idle'
  }

  if (row.hasIssue) {
    return 'issue'
  }

  if (row.activeLineCount === 0) {
    return 'idle'
  }

  return 'plan'
}

function buildRecipeSelectionValue(recipe: {
  programCode: string | null
  targetColorGrade: string | null
}) {
  if (!recipe.programCode || !recipe.targetColorGrade) {
    return ''
  }

  return `${recipe.programCode}::${recipe.targetColorGrade}`
}

function buildRecipeLabel(recipe: {
  recipeProgramCode: string | null
  recipeTargetColorGrade: string | null
  recipeTotalDays: number | null
}) {
  if (!recipe.recipeProgramCode || !recipe.recipeTargetColorGrade) {
    return 'Receta sin definir'
  }

  const cycleDays =
    typeof recipe.recipeTotalDays === 'number'
      ? ` · ${recipe.recipeTotalDays.toFixed(1)} dias`
      : ''

  return `${recipe.recipeProgramCode} ${recipe.recipeTargetColorGrade}${cycleDays}`
}

function formatTimeLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function buildSchedulerHourLabels() {
  return Array.from(
    { length: SCHEDULER_DAY_END_HOUR - SCHEDULER_DAY_START_HOUR + 1 },
    (_, index) => {
      const hour = SCHEDULER_DAY_START_HOUR + index
      const displayHour = hour === SCHEDULER_DAY_END_HOUR ? 0 : hour

      return `${String(displayHour).padStart(2, '0')}:00`
    },
  )
}

function getChamberSequenceIndex(chamberName: string) {
  const match = chamberName.match(/([A-Z])$/i)

  if (!match) {
    return 0
  }

  return Math.max(match[1].toUpperCase().charCodeAt(0) - 65, 0)
}

function buildSchedulerOperationWindow(
  chamberName: string,
  productGroupLabel: string,
  operationType: SchedulerOperationType,
) {
  const chamberOffset = (getChamberSequenceIndex(chamberName) % 3) * 30
  const productBase =
    productGroupLabel === 'palta'
      ? operationType === 'inbound'
        ? 12 * 60
        : 15 * 60
      : operationType === 'inbound'
        ? 8 * 60 + 30
        : 10 * 60

  const startMinute = productBase + chamberOffset
  const endMinute = Math.min(startMinute + 90, SCHEDULER_DAY_END_HOUR * 60)

  return { startMinute, endMinute }
}

function buildSchedulerOperationEvents(
  orders: TimelineOrder[],
  visibleDates: Set<string>,
) {
  const groupedEvents = new Map<string, SchedulerOperationEvent>()

  for (const order of orders) {
    const recipeLabel = buildRecipeLabel(order)
    const operations: Array<{
      date: string
      operationType: SchedulerOperationType
      quantityBoxes: number
    }> = [
      {
        date: order.startDate,
        operationType: 'inbound',
        quantityBoxes: order.quantityBoxes,
      },
      {
        date: order.requiredDate,
        operationType: 'outbound',
        quantityBoxes: order.quantityBoxes,
      },
    ]

    for (const operation of operations) {
      if (!visibleDates.has(operation.date)) {
        continue
      }

      const window = buildSchedulerOperationWindow(
        order.chamberName,
        order.productGroupLabel,
        operation.operationType,
      )
      const eventKey = [
        operation.date,
        operation.operationType,
        order.chamberName,
        order.product,
        recipeLabel,
      ].join('::')
      const existingEvent = groupedEvents.get(eventKey)

      if (existingEvent) {
        existingEvent.quantityBoxes += operation.quantityBoxes
        existingEvent.sourceRowIndexes = [
          ...new Set([...existingEvent.sourceRowIndexes, order.sourceRowIndex]),
        ]
        existingEvent.purchaseOrders = [
          ...new Set([
            ...existingEvent.purchaseOrders,
            order.purchaseOrderRef || order.id,
          ]),
        ]
        existingEvent.riskNote ??= order.riskNote
        continue
      }

      groupedEvents.set(eventKey, {
        id: eventKey,
        date: operation.date,
        chamberName: order.chamberName,
        product: order.product,
        productGroupLabel: order.productGroupLabel,
        recipeLabel,
        operationType: operation.operationType,
        quantityBoxes: operation.quantityBoxes,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        lane: 0,
        laneCount: 1,
        sourceRowIndexes: [order.sourceRowIndex],
        purchaseOrders: [order.purchaseOrderRef || order.id],
        riskNote: order.riskNote,
      })
    }
  }

  const groupedByDate = new Map<string, SchedulerOperationEvent[]>()

  for (const event of groupedEvents.values()) {
    const dayEvents = groupedByDate.get(event.date) ?? []
    dayEvents.push(event)
    groupedByDate.set(event.date, dayEvents)
  }

  for (const dayEvents of groupedByDate.values()) {
    dayEvents.sort((left, right) => {
      if (left.startMinute !== right.startMinute) {
        return left.startMinute - right.startMinute
      }

      if (left.endMinute !== right.endMinute) {
        return left.endMinute - right.endMinute
      }

      return left.product.localeCompare(right.product)
    })

    const laneEndMinutes: number[] = []

    for (const event of dayEvents) {
      let assignedLane = laneEndMinutes.findIndex(
        (laneEndMinute) => laneEndMinute <= event.startMinute,
      )

      if (assignedLane === -1) {
        assignedLane = laneEndMinutes.length
        laneEndMinutes.push(event.endMinute)
      } else {
        laneEndMinutes[assignedLane] = event.endMinute
      }

      event.lane = assignedLane
    }

    const laneCount = Math.max(laneEndMinutes.length, 1)

    for (const event of dayEvents) {
      event.laneCount = laneCount
    }
  }

  return groupedByDate
}

function buildPlanningEditorDraft(
  row?: Record<string, string>,
  sourceRowIndex: number | null = null,
): PlanningEditorDraft {
  return {
    sourceRowIndex,
    required_date: row?.required_date ?? '',
    product: row?.product ?? '',
    quantity: row?.quantity ?? '',
    center: row?.center ?? '',
    purchase_order_ref: row?.purchase_order_ref ?? row?.order_reference ?? '',
    provider: row?.provider ?? '',
    ripener: row?.ripener ?? '',
    sku_family: row?.sku_family ?? '',
    uom: row?.uom ?? '',
    recipe_program_code: row?.recipe_program_code ?? '',
    recipe_target_color_grade: row?.recipe_target_color_grade ?? '',
  }
}

function normalizeChamberMode(value: string | null | undefined): ChamberMode {
  if (value === 'conservation' || value === 'occupied') {
    return value
  }

  return 'ripening'
}

function addDaysToIsoDate(date: string, amount: number) {
  const parsedDate = new Date(`${date}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return null
  }

  parsedDate.setDate(parsedDate.getDate() + amount)

  return parsedDate.toISOString().slice(0, 10)
}

function buildUploadIssueModal(message: string): UploadIssueModal {
  const reasons = [message]

  if (message.includes('Solo se permiten archivos')) {
    return {
      title: 'Tipo de archivo no soportado',
      reasons: [
        'El archivo cargado no corresponde a un formato soportado.',
        'Usa `.csv`, `.xls` o `.xlsx`.',
      ],
    }
  }

  if (message.includes('No sheet contains all required columns')) {
    return {
      title: 'Faltan columnas requeridas',
      reasons: [
        'Ninguna hoja contiene los campos minimos esperados por la simulacion.',
        'Aceptamos un archivo normalizado con required_date, quantity y product, o una matriz de planificacion con columnas base y columnas por fecha.',
        message,
      ],
    }
  }

  if (
    message.includes('supera el limite') ||
    message.includes('limite operativo') ||
    message.includes('no contiene hojas')
  ) {
    return {
      title: 'El archivo no cumple los limites de carga',
      reasons,
    }
  }

  return {
    title: 'No pudimos procesar este archivo',
    reasons,
  }
}

function mergeWorkbookWarnings(workbook: ParsedWorkbook) {
  const warnings = [...workbook.warnings]

  for (const sheet of workbook.sheets) {
    const missingFields = findMissingColumnKeys(
      sheet.dataframe.columnKeys,
      expectedFields,
    )

    if (missingFields.length > 0) {
      warnings.push(
        `La hoja "${sheet.name}" no contiene las columnas esperadas: ${formatRequiredFields(missingFields)}.`,
      )
    }
  }

  return warnings
}

function getPreferredSheetIndex(workbook: ParsedWorkbook) {
  return workbook.sheets.findIndex(
    (sheet) =>
      findMissingColumnKeys(sheet.dataframe.columnKeys, expectedFields)
        .length === 0,
  )
}

function RootLayout() {
  return (
    <div className="shell">
      <main>
        <Outlet />
      </main>

      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </div>
  )
}

function HomePage() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const readRequestRef = useRef(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(
    null,
  )
  const [latestImportedFileName, setLatestImportedFileName] = useState<
    string | null
  >(null)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [uploadIssue, setUploadIssue] = useState<UploadIssueModal | null>(null)
  const [isPlanningOpen, setIsPlanningOpen] = useState(true)
  const [calendarSearch, setCalendarSearch] = useState('')
  const [calendarProductFilter, setCalendarProductFilter] = useState('all')
  const [selectedChamberNames, setSelectedChamberNames] = useState<string[]>([])
  const [calendarViewMode, setCalendarViewMode] =
    useState<CalendarViewMode>('week')
  const [calendarAnchorDate, setCalendarAnchorDate] = useState('')
  const [groupedBarViewer, setGroupedBarViewer] =
    useState<GroupedBarViewer | null>(null)
  const [recipeOverrides, setRecipeOverrides] = useState<
    Record<string, RecipeOverride>
  >({})
  const [planningEditorDraft, setPlanningEditorDraft] =
    useState<PlanningEditorDraft | null>(null)
  const [isSavingPlanningEdit, setIsSavingPlanningEdit] = useState(false)
  const [hasJustReprocessedPlan, setHasJustReprocessedPlan] = useState(false)
  const [hasJustSavedChambers, setHasJustSavedChambers] = useState(false)
  const [isCalendarHelpOpen, setIsCalendarHelpOpen] = useState(false)
  const [chamberCount, setChamberCount] = useState(defaultChamberCount)
  const [chamberCountInput, setChamberCountInput] = useState(
    String(defaultChamberCount),
  )
  const [chamberModes, setChamberModes] = useState<Record<string, ChamberMode>>(
    {},
  )
  const [chamberModesDraft, setChamberModesDraft] = useState<
    Record<string, ChamberMode>
  >({})

  const activeSheet = parsedWorkbook?.sheets[activeSheetIndex] ?? null
  const simulationSummary = activeSheet
    ? buildSimulationSummary(activeSheet, {
        chamberCount,
        scenarioId: 'balanced',
        unavailableChambers: Object.entries(chamberModes)
          .filter(([, mode]) => mode === 'occupied')
          .map(([name]) => name),
        conservationChambers: Object.entries(chamberModes)
          .filter(([, mode]) => mode === 'conservation')
          .map(([name]) => name),
        recipeOverrides,
      })
    : null
  const selectedFileName =
    latestImportedFileName ??
    parsedWorkbook?.fileName ??
    'Ningun archivo seleccionado'
  const timelineOrders = simulationSummary
    ? buildTimelineOrders(simulationSummary)
    : []
  const chamberFill = simulationSummary
    ? buildChamberFill(simulationSummary, 1)
    : []
  const purchaseOrderFilterOptions = [
    ...new Set(
      timelineOrders.map((order) => order.purchaseOrderRef).filter(Boolean),
    ),
  ].sort(compareTextValues)
  const recipePanelProducts = [
    ...new Set(timelineOrders.map((order) => order.product).filter(Boolean)),
  ].sort(compareTextValues)
  const currentRecipesByProduct = Object.fromEntries(
    timelineOrders.map((order) => [
      order.product,
      {
        recipeProgramCode: order.recipeProgramCode,
        recipeTargetColorGrade: order.recipeTargetColorGrade,
        recipeTotalDays: order.recipeTotalDays,
      },
    ]),
  )
  const normalizedCalendarSearch = normalizeSearchValue(calendarSearch)
  const filteredTimelineOrders = timelineOrders.filter((order) => {
    const matchesProduct =
      calendarProductFilter === 'all' ||
      order.productGroupLabel === calendarProductFilter

    if (!matchesProduct) {
      return false
    }

    if (!normalizedCalendarSearch) {
      return true
    }

    return [
      order.purchaseOrderRef,
      order.product,
      order.center,
      order.provider,
      order.ripener,
      order.chamberName,
      order.requiredDate,
      order.id,
    ]
      .map((value) => normalizeSearchValue(value))
      .some((value) => value.includes(normalizedCalendarSearch))
  })
  const displayedTimelineOrders =
    selectedChamberNames.length > 0
      ? filteredTimelineOrders.filter((order) =>
          selectedChamberNames.includes(order.chamberName),
        )
      : filteredTimelineOrders
  const planningEditorRecipeOptions = listRipeningRecipes(
    planningEditorDraft?.product ?? '',
  )
  const planningEditorSourceRowIndex =
    planningEditorDraft?.sourceRowIndex ?? null
  const planningEditorCurrentOrders =
    simulationSummary && planningEditorSourceRowIndex !== null
      ? simulationSummary.orders.filter(
          (order) => order.sourceRowIndex === planningEditorSourceRowIndex,
        )
      : []
  const planningEditorCurrentStartDate =
    planningEditorCurrentOrders.length > 0
      ? ([...planningEditorCurrentOrders]
          .sort((left, right) =>
            compareTextValues(left.startDate, right.startDate),
          )
          .at(0)?.startDate ?? null)
      : null
  const planningEditorCurrentRequiredDate =
    planningEditorCurrentOrders.length > 0
      ? ([...planningEditorCurrentOrders]
          .sort((left, right) =>
            compareTextValues(left.requiredDate, right.requiredDate),
          )
          .at(-1)?.requiredDate ?? null)
      : null
  const planningEditorCurrentChambers = [
    ...new Set(planningEditorCurrentOrders.map((order) => order.chamberName)),
  ].sort(compareTextValues)
  const planningEditorSelectedRecipe =
    planningEditorDraft?.recipe_program_code &&
    planningEditorDraft.recipe_target_color_grade
      ? (planningEditorRecipeOptions.find(
          (recipe) =>
            recipe.programCode === planningEditorDraft.recipe_program_code &&
            recipe.targetColorGrade ===
              planningEditorDraft.recipe_target_color_grade,
        ) ?? null)
      : null
  const planningEditorPreviewCycleDays =
    planningEditorSelectedRecipe?.totalDays ??
    planningEditorCurrentOrders[0]?.recipeTotalDays ??
    null
  const planningEditorPreviewRequiredDate =
    planningEditorDraft?.required_date ||
    planningEditorCurrentRequiredDate ||
    null
  const planningEditorPreviewStartDate =
    planningEditorPreviewRequiredDate &&
    typeof planningEditorPreviewCycleDays === 'number'
      ? addDaysToIsoDate(
          planningEditorPreviewRequiredDate,
          -Math.max(Math.ceil(planningEditorPreviewCycleDays), 1),
        )
      : null
  const simulationMetrics = simulationSummary
    ? buildSimulationMetrics(simulationSummary, 1)
    : []
  const sidebarFlowBoard = simulationSummary
    ? buildDailyFlowBoard(
        filteredTimelineOrders,
        chamberFill,
        simulationSummary.dateRange,
      )
    : null
  const dailyFlowBoard = simulationSummary
    ? buildDailyFlowBoard(
        displayedTimelineOrders,
        chamberFill,
        simulationSummary.dateRange,
      )
    : null
  const sidebarChamberRows = sidebarFlowBoard?.chamberRows ?? []
  const chamberFillByName = new Map(
    chamberFill.map((entry) => [entry.name, entry]),
  )
  const productCalendarRows = [
    {
      key: 'platano',
      label: 'PLATANO',
      availabilityLabel: 'Banana',
    },
    {
      key: 'palta',
      label: 'PALTA',
      availabilityLabel: 'Avocado',
    },
  ].map((productRow) => ({
    ...productRow,
    days:
      dailyFlowBoard?.days.map((day) => {
        const inbound = displayedTimelineOrders
          .filter(
            (order) =>
              order.productGroupLabel === productRow.key &&
              order.startDate === day.date,
          )
          .reduce((total, order) => total + order.quantityBoxes, 0)
        const outbound = displayedTimelineOrders
          .filter(
            (order) =>
              order.productGroupLabel === productRow.key &&
              order.requiredDate === day.date,
          )
          .reduce((total, order) => total + order.quantityBoxes, 0)

        return {
          date: day.date,
          inbound,
          outbound,
        }
      }) ?? [],
  }))
  const productAvailabilityByDay = productCalendarRows.map((productRow) => {
    let runningAvailable = 0

    return {
      ...productRow,
      days: productRow.days.map((day) => {
        runningAvailable += day.inbound - day.outbound

        return {
          date: day.date,
          available: Math.max(runningAvailable, 0),
        }
      }),
    }
  })
  const allVisibleDays = dailyFlowBoard?.days ?? []
  const resolvedCalendarAnchorDate =
    allVisibleDays.find((day) => day.date === calendarAnchorDate)?.date ??
    allVisibleDays[0]?.date ??
    ''
  const resolvedCalendarAnchorDay = allVisibleDays.find(
    (day) => day.date === resolvedCalendarAnchorDate,
  )
  const visibleCalendarDays = allVisibleDays.filter((day) => {
    if (!resolvedCalendarAnchorDate || !resolvedCalendarAnchorDay) {
      return true
    }

    if (calendarViewMode === 'day') {
      return day.date === resolvedCalendarAnchorDate
    }

    if (calendarViewMode === 'week') {
      const anchorWeekStart = getVisualWeekStart(resolvedCalendarAnchorDate)
      const dayWeekStart = getVisualWeekStart(day.date)

      return anchorWeekStart !== '' && dayWeekStart === anchorWeekStart
    }

    return day.date.slice(0, 7) === resolvedCalendarAnchorDate.slice(0, 7)
  })
  const visibleCalendarDates = new Set(
    visibleCalendarDays.map((day) => day.date),
  )
  const visibleDateCount = visibleCalendarDays.length
  const visibleDateRangeLabel =
    calendarViewMode === 'day'
      ? formatCalendarDate(resolvedCalendarAnchorDate)
      : calendarViewMode === 'week'
        ? visibleCalendarDays.length > 0
          ? `${formatCalendarDate(visibleCalendarDays[0]?.date)} - ${formatCalendarDate(visibleCalendarDays.at(-1)?.date)}`
          : ''
        : formatMonthLabel(resolvedCalendarAnchorDate)
  const visibleProductCalendarRows = productCalendarRows.map((productRow) => ({
    ...productRow,
    days: productRow.days.filter((day) => visibleCalendarDates.has(day.date)),
  }))
  const visibleProductAvailabilityByDay = productAvailabilityByDay.map(
    (productRow) => ({
      ...productRow,
      days: productRow.days.filter((day) => visibleCalendarDates.has(day.date)),
    }),
  )
  const schedulerHourLabels = buildSchedulerHourLabels()
  const schedulerOperationEventsByDate = buildSchedulerOperationEvents(
    displayedTimelineOrders,
    visibleCalendarDates,
  )
  const workbookWarnings = parsedWorkbook?.warnings ?? []
  const hasLoadedWorkbook = parsedWorkbook !== null
  const normalizedChamberCount = Math.min(
    Math.max(
      Number.parseInt(chamberCountInput.replaceAll(/[^0-9]/g, ''), 10) ||
        defaultChamberCount,
      minChamberCount,
    ),
    maxChamberCount,
  )
  const previewChamberNames = Array.from(
    { length: normalizedChamberCount },
    (_, index) => `Camara ${String.fromCharCode(65 + index)}`,
  )
  const hasPendingChamberCount =
    normalizedChamberCount !== chamberCount ||
    chamberCountInput !== String(chamberCount)
  const normalizedChamberModesDraft = Object.fromEntries(
    previewChamberNames.map((name) => [
      name,
      normalizeChamberMode(chamberModesDraft[name]),
    ]),
  ) as Record<string, ChamberMode>
  const normalizedChamberModes = Object.fromEntries(
    previewChamberNames.map((name) => [
      name,
      normalizeChamberMode(chamberModes[name]),
    ]),
  ) as Record<string, ChamberMode>
  const hasPendingChamberModes =
    JSON.stringify(normalizedChamberModesDraft) !==
    JSON.stringify(normalizedChamberModes)
  const hasAnyRipeningChamber = previewChamberNames.some(
    (name) => normalizedChamberModesDraft[name] === 'ripening',
  )

  useEffect(() => {
    if (!allVisibleDays.length) {
      if (calendarAnchorDate) {
        setCalendarAnchorDate('')
      }
      return
    }

    if (!allVisibleDays.some((day) => day.date === calendarAnchorDate)) {
      setCalendarAnchorDate(allVisibleDays[0]?.date ?? '')
    }
  }, [allVisibleDays, calendarAnchorDate])

  useEffect(() => {
    const availableChamberNames = new Set(
      sidebarChamberRows.map((row) => row.name),
    )

    setSelectedChamberNames((current) =>
      current.filter((name) => availableChamberNames.has(name)),
    )
  }, [sidebarChamberRows])

  const hasPendingChamberConfig =
    hasPendingChamberCount || hasPendingChamberModes

  const applyPlanningState = useEffectEvent(
    (planningState: Awaited<ReturnType<typeof fetchPlanningState>>) => {
      const nextWorkbook = planningState.workbook
      const preferredSheetIndex = nextWorkbook
        ? Math.max(getPreferredSheetIndex(nextWorkbook), 0)
        : 0
      const nextChamberCount = Math.min(
        Math.max(planningState.chamberConfig.chamberCount, minChamberCount),
        maxChamberCount,
      )
      const nextModes = Object.fromEntries(
        Array.from({ length: nextChamberCount }, (_, index) => {
          const chamberName = `Camara ${String.fromCharCode(65 + index)}`

          return [
            chamberName,
            normalizeChamberMode(
              planningState.chamberConfig.modes[chamberName],
            ),
          ]
        }),
      ) as Record<string, ChamberMode>

      setParsedWorkbook(nextWorkbook)
      setActiveSheetIndex(preferredSheetIndex)
      setLatestImportedFileName(
        planningState.latestImport?.sourceFileName ?? null,
      )
      setChamberCount(nextChamberCount)
      setChamberCountInput(String(nextChamberCount))
      setChamberModes(nextModes)
      setChamberModesDraft(nextModes)
      setRecipeOverrides({})
      setIsPlanningOpen(nextWorkbook === null)
    },
  )

  useEffect(() => {
    let isCancelled = false

    async function loadPlanningState() {
      try {
        const planningState = await fetchPlanningState()

        if (isCancelled) {
          return
        }

        applyPlanningState(planningState)
      } catch (error) {
        console.error('Failed to load persisted planning state', error)
      }
    }

    void loadPlanningState()

    return () => {
      isCancelled = true
    }
  }, [])

  async function handleFileSelection(file: File | null) {
    if (!file) {
      return
    }

    const requestId = readRequestRef.current + 1
    readRequestRef.current = requestId
    setIsReadingFile(true)
    setErrorMessage(null)
    setUploadIssue(null)

    try {
      const nextWorkbook = await parsePurchaseFile(file)
      const hasSupportedSheet = getPreferredSheetIndex(nextWorkbook) !== -1

      if (!hasSupportedSheet) {
        throw new Error(
          `Ninguna hoja contiene todas las columnas requeridas: ${formatRequiredFields(expectedFields)}.`,
        )
      }

      if (readRequestRef.current !== requestId) {
        return
      }

      const workbookWithWarnings = {
        ...nextWorkbook,
        warnings: mergeWorkbookWarnings(nextWorkbook),
      }
      const persistedState = await persistPlanningWorkbook(workbookWithWarnings)

      startTransition(() => {
        applyPlanningState(persistedState)
        setIsPlanningOpen(false)
      })
    } catch (error) {
      if (readRequestRef.current !== requestId) {
        return
      }

      const message =
        error instanceof Error
          ? error.message
          : 'No pudimos leer el archivo seleccionado.'

      setParsedWorkbook(null)
      setErrorMessage(message)
      setUploadIssue(buildUploadIssueModal(message))
    } finally {
      if (readRequestRef.current === requestId) {
        setIsReadingFile(false)
      }
    }
  }

  async function handleSaveChamberCount() {
    const nextChamberCount = normalizedChamberCount
    const nextChamberModes = normalizedChamberModesDraft

    const planningState = await persistChamberConfig({
      chamberCount: nextChamberCount,
      modes: nextChamberModes,
    })

    startTransition(() => {
      applyPlanningState(planningState)
      setHasJustSavedChambers(true)
    })

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setHasJustSavedChambers(false)
      }, 1400)
    }
  }

  function handleChangeChamberMode(chamberName: string, nextMode: ChamberMode) {
    setChamberModesDraft((current) => ({
      ...current,
      [chamberName]: nextMode,
    }))
  }

  async function persistEditedWorkbookRows(
    rows: Array<Record<string, string>>,
  ) {
    if (!parsedWorkbook) {
      return
    }

    const nextWorkbook: ParsedWorkbook = {
      ...parsedWorkbook,
      warnings: [],
      sheets: parsedWorkbook.sheets.map((sheet, index) => {
        if (index !== activeSheetIndex) {
          return sheet
        }

        return {
          ...sheet,
          dataframe: {
            ...sheet.dataframe,
            rows,
            sampleRows: rows.slice(0, 3),
            totalRows: rows.length,
          },
          previewRows: rows.slice(0, 10).map((row, rowIndex) => ({
            rowNumber: rowIndex + 2,
            cells: sheet.dataframe.columnKeys.map((key) => row[key] ?? ''),
          })),
          totalRows: rows.length,
        }
      }),
    }

    setIsSavingPlanningEdit(true)

    try {
      const persistedState = await replacePlanningWorkbook(nextWorkbook)
      startTransition(() => {
        applyPlanningState(persistedState)
        setPlanningEditorDraft(null)
        setHasJustReprocessedPlan(true)
      })

      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          setHasJustReprocessedPlan(false)
        }, 2200)
      }
    } finally {
      setIsSavingPlanningEdit(false)
    }
  }

  function handleCreatePlanningLine() {
    setPlanningEditorDraft(buildPlanningEditorDraft())
  }

  function handleCreatePlanningLineForDate(requiredDate: string) {
    setPlanningEditorDraft(
      buildPlanningEditorDraft({
        required_date: requiredDate,
      }),
    )
  }

  function handleToggleChamberSelection(chamberName: string) {
    setSelectedChamberNames((current) =>
      current.includes(chamberName)
        ? current.filter((name) => name !== chamberName)
        : [...current, chamberName].sort(compareTextValues),
    )
  }

  function handleEditPlanningLine(order: TimelineOrder) {
    const row = activeSheet?.dataframe.rows[order.sourceRowIndex]

    setPlanningEditorDraft(buildPlanningEditorDraft(row, order.sourceRowIndex))
  }

  async function handleSavePlanningLine() {
    if (!activeSheet || !planningEditorDraft) {
      return
    }

    const trimmedProduct = planningEditorDraft.product.trim()
    const trimmedDate = planningEditorDraft.required_date.trim()
    const trimmedQuantity = planningEditorDraft.quantity.trim()

    if (!trimmedProduct || !trimmedDate || !trimmedQuantity) {
      return
    }

    const nextRow: Record<string, string> = {
      required_date: trimmedDate,
      product: trimmedProduct,
      quantity: trimmedQuantity,
      center: planningEditorDraft.center.trim(),
      purchase_order_ref: planningEditorDraft.purchase_order_ref.trim(),
      provider: planningEditorDraft.provider.trim(),
      ripener: planningEditorDraft.ripener.trim(),
      sku_family: planningEditorDraft.sku_family.trim(),
      uom: planningEditorDraft.uom.trim(),
      recipe_program_code: planningEditorDraft.recipe_program_code.trim(),
      recipe_target_color_grade:
        planningEditorDraft.recipe_target_color_grade.trim(),
      source_sheet: activeSheet.name,
    }
    const nextRows = [...activeSheet.dataframe.rows]

    if (
      planningEditorDraft.sourceRowIndex !== null &&
      nextRows[planningEditorDraft.sourceRowIndex]
    ) {
      nextRows[planningEditorDraft.sourceRowIndex] = {
        ...nextRows[planningEditorDraft.sourceRowIndex],
        ...nextRow,
      }
    } else {
      nextRows.push(nextRow)
    }

    await persistEditedWorkbookRows(nextRows)
  }

  async function handleDeletePlanningLine() {
    if (
      !activeSheet ||
      !planningEditorDraft ||
      planningEditorDraft.sourceRowIndex === null
    ) {
      return
    }

    const nextRows = activeSheet.dataframe.rows.filter(
      (_, index) => index !== planningEditorDraft.sourceRowIndex,
    )

    await persistEditedWorkbookRows(nextRows)
  }

  return (
    <div className="workspace">
      <section className="panel workspace-header-panel">
        <div className="workspace-header-copy">
          <h1>RipenFlow</h1>
          <span>Timeline de camaras</span>
        </div>

        <div className="workspace-header-actions">
          {simulationSummary ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                if (!activeSheet) {
                  return
                }

                exportSimulationWorkbook({
                  activeSheet,
                  chamberFill,
                  fileName: selectedFileName,
                  metrics: simulationMetrics,
                  scenarioDetail: 'Planificacion base',
                  scenarioLabel: 'Planificacion base',
                  summary: simulationSummary,
                  timelineOrders,
                })
              }}
            >
              Descargar resultados
            </button>
          ) : null}

          <button
            aria-label={
              hasLoadedWorkbook
                ? 'Abrir ajustes y cargar nueva orden'
                : 'Abrir carga de orden'
            }
            className="menu-icon-button"
            type="button"
            onClick={() => setIsPlanningOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </section>

      {isPlanningOpen ? (
        <div className="planner-drawer-backdrop">
          <button
            aria-label="Cerrar panel de planificacion"
            className="modal-dismiss-layer"
            type="button"
            onClick={() => setIsPlanningOpen(false)}
          />

          <section
            className="planner-drawer"
            aria-label="Panel de planificacion"
          >
            <div className="modal-header">
              <div>
                <p className="section-label">Planificacion</p>
                <h2>Nueva orden y ajustes</h2>
              </div>
              <button
                className="ghost-link"
                type="button"
                onClick={() => setIsPlanningOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div className="planner-stack">
              <section className="uploader-card planner-card">
                <input
                  ref={inputRef}
                  id={inputId}
                  className="file-input"
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null
                    event.currentTarget.value = ''
                    void handleFileSelection(nextFile)
                  }}
                />

                <div className="limits-list">
                  <span>`.csv`, `.xls`, `.xlsx`</span>
                </div>

                <div className="upload-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isReadingFile}
                    onClick={() => inputRef.current?.click()}
                  >
                    {isReadingFile
                      ? 'Leyendo archivo...'
                      : 'Seleccionar orden de compra'}
                  </button>
                </div>

                <div
                  className={
                    hasLoadedWorkbook
                      ? 'upload-file-card is-loaded'
                      : 'upload-file-card'
                  }
                >
                  <strong>
                    {hasLoadedWorkbook
                      ? 'Orden cargada y lista'
                      : 'Ninguna orden cargada'}
                  </strong>
                </div>

                {errorMessage ? (
                  <div className="alert alert-error">{errorMessage}</div>
                ) : null}
              </section>

              {workbookWarnings.length > 0 ? (
                <div className="alert alert-warning">
                  <ul className="warning-list">
                    {workbookWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {simulationSummary ? (
                <>
                  <section className="subpanel planning-controls-panel">
                    <div className="subpanel-head">
                      <div>
                        <h3>Camaras disponibles</h3>
                        <p className="planning-view-description">
                          Define si cada camara se usa para maduracion,
                          conservacion o queda ocupada por fuera del plan.
                        </p>
                      </div>
                    </div>

                    <div className="chamber-config-bar">
                      <div className="chamber-config-controls">
                        <label className="chamber-count-field">
                          <span>Camaras</span>
                          <input
                            className="chamber-count-input"
                            type="number"
                            min={minChamberCount}
                            max={maxChamberCount}
                            step={1}
                            value={chamberCountInput}
                            onChange={(event) =>
                              setChamberCountInput(event.target.value)
                            }
                          />
                        </label>

                        <button
                          className="secondary-button"
                          type="button"
                          disabled={
                            !hasPendingChamberConfig || !hasAnyRipeningChamber
                          }
                          onClick={handleSaveChamberCount}
                        >
                          Guardar
                        </button>
                        {hasJustSavedChambers ? (
                          <span className="save-confirmation">Guardado</span>
                        ) : null}
                        {!hasAnyRipeningChamber ? (
                          <span className="save-confirmation">
                            Deja al menos una camara en maduracion.
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="chamber-mode-grid">
                      {previewChamberNames.map((chamberName) => (
                        <label key={chamberName} className="chamber-mode-card">
                          <strong>{chamberName}</strong>
                          <select
                            className="filter-select"
                            value={normalizedChamberModesDraft[chamberName]}
                            onChange={(event) =>
                              handleChangeChamberMode(
                                chamberName,
                                normalizeChamberMode(event.target.value),
                              )
                            }
                          >
                            <option value="ripening">Maduracion</option>
                            <option value="conservation">Conservacion</option>
                            <option value="occupied">Ocupada</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  </section>

                  {recipePanelProducts.length > 0 ? (
                    <section className="subpanel recipe-panel">
                      <div className="subpanel-head">
                        <div>
                          <h3>Recetas por producto</h3>
                        </div>
                      </div>

                      <div className="recipe-grid">
                        {recipePanelProducts.map((product) => {
                          const recipeOptions = listRipeningRecipes(product)
                          const currentRecipe = currentRecipesByProduct[product]
                          const selectedValue =
                            buildRecipeSelectionValue({
                              programCode:
                                recipeOverrides[product]?.programCode ??
                                currentRecipe?.recipeProgramCode ??
                                null,
                              targetColorGrade:
                                recipeOverrides[product]?.targetColorGrade ??
                                currentRecipe?.recipeTargetColorGrade ??
                                null,
                            }) || ''

                          return (
                            <label key={product} className="recipe-card">
                              <span className="recipe-product">{product}</span>
                              <select
                                className="filter-select"
                                value={selectedValue}
                                onChange={(event) => {
                                  const nextValue = event.target.value

                                  setRecipeOverrides((current) => {
                                    if (!nextValue) {
                                      const nextOverrides = { ...current }
                                      delete nextOverrides[product]

                                      return nextOverrides
                                    }

                                    const [programCode, targetColorGrade] =
                                      nextValue.split('::')

                                    return {
                                      ...current,
                                      [product]: {
                                        programCode,
                                        targetColorGrade,
                                      },
                                    }
                                  })
                                }}
                              >
                                <option value="">Seleccion automatica</option>
                                {recipeOptions.map((recipe) => (
                                  <option
                                    key={`${product}-${recipe.programCode}-${recipe.targetColorGrade}`}
                                    value={`${recipe.programCode}::${recipe.targetColorGrade}`}
                                  >
                                    {recipe.programCode}{' '}
                                    {recipe.targetColorGrade} ·{' '}
                                    {recipe.totalDays} dias
                                  </option>
                                ))}
                              </select>
                              <span className="recipe-current">
                                {selectedValue
                                  ? `Activa: ${buildRecipeLabel({
                                      recipeProgramCode:
                                        recipeOverrides[product]?.programCode ??
                                        currentRecipe?.recipeProgramCode ??
                                        null,
                                      recipeTargetColorGrade:
                                        recipeOverrides[product]
                                          ?.targetColorGrade ??
                                        currentRecipe?.recipeTargetColorGrade ??
                                        null,
                                      recipeTotalDays:
                                        currentRecipe?.recipeTotalDays ?? null,
                                    })}`
                                  : 'Activa: seleccion automatica'}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {uploadIssue ? (
        <div className="modal-backdrop">
          <button
            aria-label="Cerrar ayuda de carga"
            className="modal-dismiss-layer"
            type="button"
            onClick={() => setUploadIssue(null)}
          />
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-issue-title"
          >
            <div className="modal-header">
              <div>
                <p className="section-label">Ayuda de carga</p>
                <h2 id="upload-issue-title">{uploadIssue.title}</h2>
              </div>
              <button
                className="ghost-link"
                type="button"
                onClick={() => setUploadIssue(null)}
              >
                Cerrar
              </button>
            </div>

            <div className="modal-grid">
              <article className="modal-card">
                <p className="section-label">Que esperamos</p>
                <ul className="bullet-list">
                  <li>Tipo de archivo: `.csv`, `.xls` o `.xlsx`.</li>
                  <li>
                    Campos minimos normalizados:{' '}
                    {formatRequiredFields(expectedFields)}.
                  </li>
                  <li>
                    Tambien aceptamos una matriz de planificacion con
                    `Proveedor`, `Madurador`, `Centro`, `SKU Familia`,
                    `Descripcion SKU` y una o mas columnas de fecha.
                  </li>
                  <li>
                    Tamano maximo:{' '}
                    {formatBytes(purchaseFileLimits.maxFileSizeBytes)}.
                  </li>
                  <li>
                    Maximo de hojas: {purchaseFileLimits.maxSheets}. Maximo de
                    filas por hoja: {purchaseFileLimits.maxRowsPerSheet}.
                  </li>
                </ul>
              </article>

              <article className="modal-card">
                <p className="section-label">Por que fallo este archivo</p>
                <ul className="bullet-list">
                  {uploadIssue.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </article>
            </div>

            <article className="modal-card modal-card-wide">
              <p className="section-label">Ejemplo de encabezado esperado</p>
              <pre className="code-preview modal-code-preview">
                <code>
                  {`required_date,quantity,product
2026-04-22,864,Cavendish Premium 18kg`}
                </code>
              </pre>
            </article>
          </section>
        </div>
      ) : null}

      {simulationSummary ? (
        <section className="simulation-panel">
          {dailyFlowBoard ? (
            <section className="subpanel scheduler-panel">
              <div className="scheduler-topbar">
                <div className="scheduler-topbar-copy">
                  <h3>Calendar</h3>
                </div>

                <div className="scheduler-topbar-actions">
                  {simulationSummary ? (
                    <button
                      className="ghost-link scheduler-download-link"
                      type="button"
                      onClick={() => {
                        if (!activeSheet) {
                          return
                        }

                        exportSimulationWorkbook({
                          activeSheet,
                          chamberFill,
                          fileName: selectedFileName,
                          metrics: simulationMetrics,
                          scenarioDetail: 'Planificacion base',
                          scenarioLabel: 'Planificacion base',
                          summary: simulationSummary,
                          timelineOrders,
                        })
                      }}
                    >
                      Export
                    </button>
                  ) : null}

                  <div className="scheduler-view-switch">
                    <button
                      type="button"
                      className={[
                        'scheduler-view-pill',
                        calendarViewMode === 'day' ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setCalendarViewMode('day')}
                    >
                      DAY
                    </button>
                    <button
                      type="button"
                      className={[
                        'scheduler-view-pill',
                        calendarViewMode === 'week' ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setCalendarViewMode('week')}
                    >
                      WEEK
                    </button>
                    <button
                      type="button"
                      className={[
                        'scheduler-view-pill',
                        calendarViewMode === 'month' ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setCalendarViewMode('month')}
                    >
                      MONTH
                    </button>
                  </div>

                  <button
                    className="primary-button scheduler-new-order"
                    type="button"
                    onClick={() => setIsPlanningOpen(true)}
                  >
                    + New order
                  </button>
                </div>
              </div>

              <div className="calendar-toolbar">
                <label className="filter-field">
                  <span>Orden de compra o producto</span>
                  <input
                    className="filter-input"
                    type="text"
                    value={calendarSearch}
                    placeholder="Buscar producto, centro, proveedor o linea"
                    onChange={(event) => setCalendarSearch(event.target.value)}
                  />
                </label>

                <label className="filter-field">
                  <span>Ordenes cargadas</span>
                  <select
                    className="filter-select"
                    value={
                      purchaseOrderFilterOptions.includes(calendarSearch)
                        ? calendarSearch
                        : ''
                    }
                    onChange={(event) => setCalendarSearch(event.target.value)}
                  >
                    <option value="">Todas las ordenes</option>
                    {purchaseOrderFilterOptions.map((purchaseOrderRef) => (
                      <option key={purchaseOrderRef} value={purchaseOrderRef}>
                        {purchaseOrderRef}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="secondary-button calendar-add"
                  type="button"
                  onClick={handleCreatePlanningLine}
                >
                  Agregar linea
                </button>

                <button
                  aria-label="Mostrar ayuda del calendario"
                  className="ghost-link calendar-help-trigger"
                  type="button"
                  onClick={() => setIsCalendarHelpOpen((current) => !current)}
                >
                  ?
                </button>

                <button
                  className="ghost-link calendar-clear"
                  type="button"
                  onClick={() => {
                    setCalendarSearch('')
                    setCalendarProductFilter('all')
                    setSelectedChamberNames([])
                  }}
                >
                  Limpiar filtros
                </button>
              </div>

              {isCalendarHelpOpen ? (
                <div className="calendar-help-popover">
                  <strong>Ayuda rapida</strong>
                  <span>Click en una celda para editar lo activo ese dia.</span>
                  <span>
                    Si no hay nada en esa fecha, la celda abre una linea nueva.
                  </span>
                </div>
              ) : null}

              {hasJustReprocessedPlan ? (
                <p className="calendar-feedback">
                  Plan recalculado con la receta y los datos actualizados.
                </p>
              ) : null}

              <div className="scheduler-layout">
                <aside className="scheduler-sidebar">
                  <div className="scheduler-sidebar-product-filter">
                    <span className="scheduler-sidebar-title">Producto</span>
                    <div className="scheduler-product-pills">
                      <button
                        type="button"
                        className={[
                          'scheduler-product-pill',
                          calendarProductFilter === 'all' ? 'is-active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setCalendarProductFilter('all')}
                      >
                        Ambos
                      </button>
                      <button
                        type="button"
                        className={[
                          'scheduler-product-pill',
                          calendarProductFilter === 'platano'
                            ? 'is-active'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setCalendarProductFilter('platano')}
                      >
                        Platano
                      </button>
                      <button
                        type="button"
                        className={[
                          'scheduler-product-pill',
                          calendarProductFilter === 'palta' ? 'is-active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setCalendarProductFilter('palta')}
                      >
                        Palta
                      </button>
                    </div>
                  </div>

                  <p className="scheduler-sidebar-title">Chamber status</p>
                  <div className="scheduler-sidebar-list">
                    {sidebarChamberRows.map((chamberRow) => {
                      const chamberSummary = chamberFillByName.get(
                        chamberRow.name,
                      )
                      const chamberTone =
                        buildFlowBoardChamberStatusTone(chamberRow)
                      const isChamberSelected =
                        selectedChamberNames.length === 0 ||
                        selectedChamberNames.includes(chamberRow.name)
                      const chamberDetails = [
                        chamberRow.name,
                        chamberRow.productSummary.length > 0
                          ? chamberRow.productSummary.join(' · ')
                          : chamberRow.mode === 'conservation'
                            ? 'Conservacion'
                            : 'Sin producto',
                        `${chamberSummary?.occupancy ?? 0}% Capacity`,
                        buildFlowBoardChamberStatus(chamberRow),
                        isChamberSelected
                          ? 'Filtro activo'
                          : 'Click para incluir esta camara',
                      ]
                        .filter(Boolean)
                        .join('\n')

                      return (
                        <button
                          key={`sidebar-${chamberRow.name}`}
                          type="button"
                          className={[
                            'scheduler-chamber-card',
                            isChamberSelected ? 'is-active' : 'is-muted',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() =>
                            handleToggleChamberSelection(chamberRow.name)
                          }
                          title={chamberDetails}
                          aria-label={chamberDetails.replaceAll('\n', ', ')}
                        >
                          <div className="scheduler-chamber-card-head">
                            <strong>{chamberRow.name}</strong>
                            <span
                              className={`scheduler-status-dot is-${chamberTone}`}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </aside>

                <div className="scheduler-main">
                  <div className="scheduler-main-scroll">
                    <div className="scheduler-range-banner">
                      <span className="section-label">Vista activa</span>
                      <strong>{visibleDateRangeLabel || 'Sin rango'}</strong>
                    </div>
                    <div
                      className="scheduler-day-header"
                      style={{
                        gridTemplateColumns: `repeat(${visibleDateCount}, minmax(130px, 1fr))`,
                      }}
                    >
                      {visibleCalendarDays.map((day) => (
                        <button
                          key={`scheduler-day-${day.date}`}
                          type="button"
                          className={[
                            'scheduler-day-head',
                            day.date === resolvedCalendarAnchorDate
                              ? 'is-active'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setCalendarAnchorDate(day.date)}
                        >
                          <span>{day.weekdayShort}</span>
                          <strong>{day.date.slice(5)}</strong>
                        </button>
                      ))}
                    </div>

                    <div className="scheduler-summary-table">
                      {visibleProductCalendarRows.map((productRow) => (
                        <div
                          key={productRow.key}
                          className="scheduler-summary-row"
                        >
                          <div className="scheduler-summary-label">
                            {productRow.label}
                          </div>
                          <div
                            className="scheduler-summary-values"
                            style={{
                              gridTemplateColumns: `repeat(${visibleDateCount}, minmax(130px, 1fr))`,
                            }}
                          >
                            {productRow.days.map((day) => (
                              <div
                                key={`${productRow.key}-${day.date}`}
                                className="scheduler-summary-cell"
                              >
                                <span className="scheduler-summary-in">
                                  {day.inbound > 0 ? `+${day.inbound}` : '+0'}
                                </span>
                                <span className="scheduler-summary-out">
                                  {day.outbound > 0 ? `-${day.outbound}` : '-0'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="scheduler-calendar-shell">
                      <div className="scheduler-time-rail">
                        {schedulerHourLabels.map((hourLabel) => (
                          <div
                            key={`scheduler-hour-${hourLabel}`}
                            className="scheduler-time-slot"
                          >
                            {hourLabel}
                          </div>
                        ))}
                      </div>

                      <div
                        className="scheduler-calendar-grid"
                        style={{
                          gridTemplateColumns: `repeat(${visibleDateCount}, minmax(150px, 1fr))`,
                        }}
                      >
                        {visibleCalendarDays.map((day) => {
                          const dayEvents =
                            schedulerOperationEventsByDate.get(day.date) ?? []

                          return (
                            <div
                              key={`calendar-day-${day.date}`}
                              className="scheduler-calendar-column"
                              style={{
                                height:
                                  (SCHEDULER_DAY_END_HOUR -
                                    SCHEDULER_DAY_START_HOUR) *
                                  SCHEDULER_HOUR_ROW_HEIGHT,
                              }}
                            >
                              <button
                                type="button"
                                className="scheduler-calendar-hitarea"
                                onClick={() =>
                                  handleCreatePlanningLineForDate(day.date)
                                }
                                aria-label={`Agregar linea para ${formatCalendarDate(day.date)}`}
                              />
                              {schedulerHourLabels
                                .slice(0, -1)
                                .map((hourLabel) => (
                                  <div
                                    key={`${day.date}-${hourLabel}`}
                                    className="scheduler-calendar-hour-line"
                                  />
                                ))}

                              {dayEvents.map((event) => {
                                const top =
                                  ((event.startMinute -
                                    SCHEDULER_DAY_START_HOUR * 60) /
                                    60) *
                                  SCHEDULER_HOUR_ROW_HEIGHT
                                const height =
                                  ((event.endMinute - event.startMinute) / 60) *
                                  SCHEDULER_HOUR_ROW_HEIGHT
                                const laneWidth = 100 / event.laneCount
                                const leftOffset = event.lane * laneWidth
                                const tone = event.riskNote
                                  ? 'is-risk'
                                  : event.operationType === 'outbound'
                                    ? 'is-out'
                                    : event.productGroupLabel === 'palta'
                                      ? 'is-green'
                                      : 'is-blue'

                                return (
                                  <button
                                    key={event.id}
                                    type="button"
                                    className={[
                                      'scheduler-calendar-event',
                                      tone,
                                      event.sourceRowIndexes.length > 1
                                        ? 'is-grouped'
                                        : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    style={{
                                      top,
                                      height,
                                      left: `calc(${leftOffset}% + 6px)`,
                                      width: `calc(${laneWidth}% - 12px)`,
                                    }}
                                    title={[
                                      `${event.operationType === 'inbound' ? 'Ingreso' : 'Salida'} · ${event.chamberName}`,
                                      `${formatTimeLabel(event.startMinute)} - ${formatTimeLabel(event.endMinute)}`,
                                      event.product,
                                      `Cantidad: ${event.quantityBoxes} cajas`,
                                      event.purchaseOrders.length > 0
                                        ? `OC: ${event.purchaseOrders.join(', ')}`
                                        : '',
                                      event.riskNote ?? '',
                                    ]
                                      .filter(Boolean)
                                      .join('\n')}
                                    onClick={(clickEvent) => {
                                      clickEvent.stopPropagation()

                                      if (event.sourceRowIndexes.length > 1) {
                                        setGroupedBarViewer({
                                          title: `${event.product} · ${event.operationType === 'inbound' ? 'Ingreso' : 'Salida'}`,
                                          subtitle: `${event.chamberName} · ${formatCalendarDate(event.date)} · ${formatTimeLabel(event.startMinute)}`,
                                          sourceRowIndexes:
                                            event.sourceRowIndexes,
                                        })
                                        return
                                      }

                                      const sourceRowIndex =
                                        event.sourceRowIndexes[0]
                                      const matchingOrder =
                                        filteredTimelineOrders.find(
                                          (order) =>
                                            order.sourceRowIndex ===
                                            sourceRowIndex,
                                        )

                                      if (matchingOrder) {
                                        handleEditPlanningLine(matchingOrder)
                                      }
                                    }}
                                  >
                                    <span className="scheduler-calendar-event-badge">
                                      {event.operationType === 'inbound'
                                        ? '+'
                                        : '-'}
                                      {event.quantityBoxes}
                                    </span>
                                    <div className="scheduler-calendar-event-copy">
                                      <span className="scheduler-calendar-event-time">
                                        {formatTimeLabel(event.startMinute)} -{' '}
                                        {formatTimeLabel(event.endMinute)}
                                      </span>
                                      <strong>{event.product}</strong>
                                      <span>{event.chamberName}</span>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="scheduler-available-row">
                      <div className="scheduler-available-label">
                        AVAILABLE:
                      </div>
                      <div
                        className="scheduler-available-values"
                        style={{
                          gridTemplateColumns: `repeat(${visibleDateCount}, minmax(130px, 1fr))`,
                        }}
                      >
                        {visibleCalendarDays.map((day, dayIndex) => (
                          <div
                            key={`available-${day.date}`}
                            className="scheduler-available-cell"
                          >
                            {visibleProductAvailabilityByDay.map(
                              (productRow) => (
                                <span
                                  key={`${productRow.key}-${day.date}`}
                                  className="scheduler-available-item"
                                >
                                  {productRow.availabilityLabel}:{' '}
                                  {productRow.days[dayIndex]?.available ?? 0}u
                                </span>
                              ),
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
        </section>
      ) : (
        <section className="panel empty-simulation">
          <h2>Sube una orden para ver el plan</h2>
        </section>
      )}

      {planningEditorDraft && !groupedBarViewer ? (
        <div className="modal-backdrop">
          <button
            aria-label="Cerrar editor de linea"
            className="modal-dismiss-layer"
            type="button"
            onClick={() => {
              if (!isSavingPlanningEdit) {
                setPlanningEditorDraft(null)
              }
            }}
          />
          <section className="modal-panel planning-editor-modal">
            <div className="modal-header">
              <div className="planning-editor-heading">
                <h2>
                  {planningEditorDraft.sourceRowIndex === null
                    ? 'Agregar linea'
                    : 'Editar linea'}
                </h2>
                <p>
                  Ajusta producto, receta y datos operativos para esta linea.
                </p>
              </div>
              <button
                className="ghost-link"
                type="button"
                disabled={isSavingPlanningEdit}
                onClick={() => setPlanningEditorDraft(null)}
              >
                Cerrar
              </button>
            </div>

            <div className="planning-editor-grid">
              <label className="filter-field">
                <span>Fecha requerida</span>
                <input
                  className="filter-input"
                  type="date"
                  value={planningEditorDraft.required_date}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, required_date: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>Cantidad</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.quantity}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, quantity: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field planning-editor-wide">
                <span>Producto</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.product}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, product: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field planning-editor-wide">
                <span>Receta</span>
                <select
                  className="filter-select"
                  value={buildRecipeSelectionValue({
                    programCode:
                      planningEditorDraft.recipe_program_code || null,
                    targetColorGrade:
                      planningEditorDraft.recipe_target_color_grade || null,
                  })}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) => {
                      if (!current) {
                        return current
                      }

                      if (!event.target.value) {
                        return {
                          ...current,
                          recipe_program_code: '',
                          recipe_target_color_grade: '',
                        }
                      }

                      const [programCode, targetColorGrade] =
                        event.target.value.split('::')

                      return {
                        ...current,
                        recipe_program_code: programCode ?? '',
                        recipe_target_color_grade: targetColorGrade ?? '',
                      }
                    })
                  }
                >
                  <option value="">Seleccion automatica</option>
                  {planningEditorRecipeOptions.map((recipe) => (
                    <option
                      key={`editor-recipe-${recipe.programCode}-${recipe.targetColorGrade}`}
                      value={`${recipe.programCode}::${recipe.targetColorGrade}`}
                    >
                      {recipe.programCode} {recipe.targetColorGrade} ·{' '}
                      {recipe.totalDays} dias
                    </option>
                  ))}
                </select>
              </label>

              <section className="planning-editor-preview planning-editor-wide">
                <div>
                  <span className="section-label">Plan actual</span>
                  <strong>
                    {planningEditorCurrentChambers.length > 0
                      ? planningEditorCurrentChambers.join(', ')
                      : 'Sin camara asignada aun'}
                  </strong>
                  <p>
                    {planningEditorCurrentStartDate &&
                    planningEditorCurrentRequiredDate
                      ? `${formatCalendarDate(
                          planningEditorCurrentStartDate,
                        )} a ${formatCalendarDate(
                          addDaysToIsoDate(
                            planningEditorCurrentRequiredDate,
                            -1,
                          ) ?? planningEditorCurrentRequiredDate,
                        )}`
                      : 'La ventana actual se definira al guardar.'}
                  </p>
                </div>

                <div>
                  <span className="section-label">Con esta receta</span>
                  <strong>
                    {buildRecipeLabel({
                      recipeProgramCode:
                        planningEditorDraft.recipe_program_code || null,
                      recipeTargetColorGrade:
                        planningEditorDraft.recipe_target_color_grade || null,
                      recipeTotalDays:
                        typeof planningEditorPreviewCycleDays === 'number'
                          ? planningEditorPreviewCycleDays
                          : null,
                    })}
                  </strong>
                  <p>
                    {planningEditorPreviewStartDate &&
                    planningEditorPreviewRequiredDate
                      ? `Inicio estimado ${formatCalendarDate(
                          planningEditorPreviewStartDate,
                        )} · entrega ${formatCalendarDate(
                          planningEditorPreviewRequiredDate,
                        )}`
                      : 'Al guardar, el algoritmo recalcula la ventana y reasigna las camaras.'}
                  </p>
                </div>
              </section>

              <label className="filter-field">
                <span>Centro</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.center}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, center: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>Orden de compra</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.purchase_order_ref}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? {
                            ...current,
                            purchase_order_ref: event.target.value,
                          }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>Proveedor</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.provider}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, provider: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>Madurador</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.ripener}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, ripener: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>SKU familia</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.sku_family}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, sku_family: event.target.value }
                        : current,
                    )
                  }
                />
              </label>

              <label className="filter-field">
                <span>Unidad</span>
                <input
                  className="filter-input"
                  type="text"
                  value={planningEditorDraft.uom}
                  onChange={(event) =>
                    setPlanningEditorDraft((current) =>
                      current
                        ? { ...current, uom: event.target.value }
                        : current,
                    )
                  }
                />
              </label>
            </div>

            <div className="planning-editor-actions">
              {planningEditorDraft.sourceRowIndex !== null ? (
                <button
                  className="ghost-link danger-link"
                  type="button"
                  disabled={isSavingPlanningEdit}
                  onClick={() => void handleDeletePlanningLine()}
                >
                  Borrar linea
                </button>
              ) : (
                <span />
              )}

              <div className="planning-editor-actions-right">
                <button
                  className="ghost-link"
                  type="button"
                  disabled={isSavingPlanningEdit}
                  onClick={() => setPlanningEditorDraft(null)}
                >
                  Cancelar
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isSavingPlanningEdit}
                  onClick={() => void handleSavePlanningLine()}
                >
                  {isSavingPlanningEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {groupedBarViewer ? (
        <div className="modal-backdrop">
          <button
            aria-label="Cerrar detalle de barra agrupada"
            className="modal-dismiss-layer"
            type="button"
            onClick={() => setGroupedBarViewer(null)}
          />
          <section className="modal-panel planning-editor-modal grouped-bar-modal">
            <div className="modal-header">
              <div className="planning-editor-heading">
                <p className="section-label">{groupedBarViewer.subtitle}</p>
                <h2>{groupedBarViewer.title}</h2>
              </div>
              <button
                className="ghost-link"
                type="button"
                onClick={() => {
                  setGroupedBarViewer(null)
                  setPlanningEditorDraft(null)
                }}
              >
                Cerrar
              </button>
            </div>

            <div className="grouped-bar-list">
              {groupedBarViewer.sourceRowIndexes.map((sourceRowIndex) => {
                const row = activeSheet?.dataframe.rows[sourceRowIndex]

                if (!row) {
                  return null
                }

                return (
                  <button
                    key={`${groupedBarViewer.subtitle}-${sourceRowIndex}`}
                    className="grouped-bar-line"
                    type="button"
                    onClick={() => {
                      setGroupedBarViewer(null)
                      setPlanningEditorDraft(
                        buildPlanningEditorDraft(row, sourceRowIndex),
                      )
                    }}
                  >
                    <div className="grouped-bar-line-copy">
                      <strong className="grouped-bar-line-title">
                        {row.product ?? 'Linea sin producto'}
                      </strong>
                      <span className="grouped-bar-line-meta">
                        {formatCalendarDate(row.required_date)} ·{' '}
                        {row.center?.trim() || 'Centro sin asignar'}
                      </span>
                    </div>
                    <span className="grouped-bar-line-action">Editar</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
