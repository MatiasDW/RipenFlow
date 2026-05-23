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

type FlowBoardSelection = {
  chamberName: string
  startDate: string
  endDate: string
}

type TimelineBarGroup = {
  id: string
  chamberName: string
  product: string
  recipeLabel: string
  startIndex: number
  endIndex: number
  lane: number
  quantityBoxes: number
  pallets: number
  sourceRowIndexes: number[]
  requiredDates: string[]
  riskNote: string | null
  scenarioStatus: TimelineOrder['scenarioStatus']
  deliveryCount: number
}

type DailyFlowBoard = {
  days: DailyFlowDay[]
  chamberRows: DailyFlowChamberRow[]
}

type ChamberMode = 'ripening' | 'conservation' | 'occupied'

type RecipeOverride = {
  programCode: string
  targetColorGrade: string
}

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

function summarizeFlowBoardValues(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function buildFlowBoardCellTitle(
  chamberRow: DailyFlowChamberRow,
  date: string,
  inbound: number,
  outbound: number,
) {
  const activeProducts = summarizeFlowBoardValues(
    chamberRow.activeProductsByDate[date] ?? [],
  )
  const outboundProducts = summarizeFlowBoardValues(
    chamberRow.outboundProductsByDate[date] ?? [],
  )
  const purchaseOrders = summarizeFlowBoardValues(
    chamberRow.purchaseOrdersByDate[date] ?? [],
  )

  const parts = [
    chamberRow.name,
    formatCalendarDate(date),
    activeProducts.length > 0
      ? `Producto: ${activeProducts.join(', ')}`
      : 'Sin producto activo',
    inbound > 0 ? `Ingreso: ${inbound}` : '',
    outbound > 0 ? `Salida: ${outbound}` : '',
    outboundProducts.length > 0 ? `Sale: ${outboundProducts.join(', ')}` : '',
    purchaseOrders.length > 0 ? `OC: ${purchaseOrders.join(', ')}` : '',
  ]

  return parts.filter(Boolean).join('\n')
}

function buildFlowSelectionSummary(
  chamberRow: DailyFlowChamberRow | undefined,
  selection: FlowBoardSelection | null,
  dateRange: string[],
) {
  if (!selection || !chamberRow) {
    return null
  }

  const startIndex = dateRange.indexOf(selection.startDate)
  const endIndex = dateRange.indexOf(selection.endDate)

  if (startIndex === -1 || endIndex === -1) {
    return null
  }

  const [fromIndex, toIndex] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
  const selectedDates = dateRange.slice(fromIndex, toIndex + 1)
  const products = new Set<string>()
  const purchaseOrders = new Set<string>()
  let inboundTotal = 0
  let outboundTotal = 0

  for (const date of selectedDates) {
    inboundTotal += chamberRow.inboundByDate[date] ?? 0
    outboundTotal += chamberRow.outboundByDate[date] ?? 0

    for (const product of chamberRow.activeProductsByDate[date] ?? []) {
      if (product) {
        products.add(product)
      }
    }

    for (const purchaseOrder of chamberRow.purchaseOrdersByDate[date] ?? []) {
      if (purchaseOrder) {
        purchaseOrders.add(purchaseOrder)
      }
    }
  }

  return {
    chamberName: chamberRow.name,
    fromDate: selectedDates[0],
    toDate: selectedDates.at(-1) ?? selectedDates[0],
    inboundTotal,
    outboundTotal,
    products: [...products],
    purchaseOrders: [...purchaseOrders],
    dayCount: selectedDates.length,
  }
}

function isDateInsideFlowSelection(
  selection: FlowBoardSelection,
  date: string,
) {
  const [fromDate, toDate] =
    compareTextValues(selection.startDate, selection.endDate) <= 0
      ? [selection.startDate, selection.endDate]
      : [selection.endDate, selection.startDate]

  return (
    compareTextValues(fromDate, date) <= 0 &&
    compareTextValues(toDate, date) >= 0
  )
}

function buildTimelineBarGroups(orders: TimelineOrder[]) {
  const groupedByChamber = new Map<string, TimelineBarGroup[]>()

  const sortedOrders = [...orders].sort(
    (left, right) =>
      compareTextValues(left.chamberName, right.chamberName) ||
      left.startIndex - right.startIndex ||
      compareTextValues(left.product, right.product),
  )

  for (const order of sortedOrders) {
    const chamberGroups = groupedByChamber.get(order.chamberName) ?? []
    const recipeLabel = buildRecipeLabel(order)
    const endIndex = order.startIndex + order.span - 1
    const previousGroup = chamberGroups.at(-1)

    if (
      previousGroup &&
      previousGroup.product === order.product &&
      previousGroup.recipeLabel === recipeLabel &&
      previousGroup.scenarioStatus === order.scenarioStatus &&
      order.startIndex <= previousGroup.endIndex + 1
    ) {
      previousGroup.endIndex = Math.max(previousGroup.endIndex, endIndex)
      previousGroup.quantityBoxes += order.quantityBoxes
      previousGroup.pallets += order.pallets
      previousGroup.sourceRowIndexes = [
        ...new Set([...previousGroup.sourceRowIndexes, order.sourceRowIndex]),
      ]
      previousGroup.requiredDates = [
        ...new Set([...previousGroup.requiredDates, order.requiredDate]),
      ].sort(compareTextValues)
      previousGroup.deliveryCount = previousGroup.requiredDates.length
      previousGroup.riskNote = previousGroup.riskNote ?? order.riskNote
      continue
    }

    chamberGroups.push({
      id: `${order.chamberName}-${order.product}-${order.startIndex}-${order.requiredDate}-${order.sourceRowIndex}`,
      chamberName: order.chamberName,
      product: order.product,
      recipeLabel,
      startIndex: order.startIndex,
      endIndex,
      lane: 0,
      quantityBoxes: order.quantityBoxes,
      pallets: order.pallets,
      sourceRowIndexes: [order.sourceRowIndex],
      requiredDates: [order.requiredDate],
      riskNote: order.riskNote,
      scenarioStatus: order.scenarioStatus,
      deliveryCount: 1,
    })

    groupedByChamber.set(order.chamberName, chamberGroups)
  }

  for (const chamberGroups of groupedByChamber.values()) {
    const laneEndIndexes: number[] = []

    for (const group of chamberGroups) {
      let assignedLane = laneEndIndexes.findIndex(
        (laneEndIndex) => laneEndIndex < group.startIndex,
      )

      if (assignedLane === -1) {
        assignedLane = laneEndIndexes.length
        laneEndIndexes.push(group.endIndex)
      } else {
        laneEndIndexes[assignedLane] = group.endIndex
      }

      group.lane = assignedLane
    }
  }

  return groupedByChamber
}

function buildGroupedBarViewerPayload(
  group: TimelineBarGroup,
  chamberName: string,
  activeSheet: ParsedWorkbook['sheets'][number] | null,
) {
  return {
    title: group.product,
    subtitle: `${chamberName} · ${group.deliveryCount} entrega(s)`,
    sourceRowIndexes: group.sourceRowIndexes.filter((sourceRowIndex) =>
      Boolean(activeSheet?.dataframe.rows[sourceRowIndex]),
    ),
  }
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

function compareIsoDateStrings(left: string, right: string) {
  return left.localeCompare(right)
}

function isDateWithinOrderWindow(
  order: Pick<TimelineOrder, 'startDate' | 'requiredDate'>,
  date: string,
) {
  return (
    compareIsoDateStrings(order.startDate, date) <= 0 &&
    compareIsoDateStrings(order.requiredDate, date) >= 0
  )
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
  const flowSelectionSuppressClickRef = useRef(false)
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
  const [groupedBarViewer, setGroupedBarViewer] =
    useState<GroupedBarViewer | null>(null)
  const [flowSelectionDraft, setFlowSelectionDraft] =
    useState<FlowBoardSelection | null>(null)
  const [flowSelection, setFlowSelection] = useState<FlowBoardSelection | null>(
    null,
  )
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
  const productFilterOptions = [
    ...new Set(timelineOrders.map((order) => order.product).filter(Boolean)),
  ].sort(compareTextValues)
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
      calendarProductFilter === 'all' || order.product === calendarProductFilter

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
  const dailyFlowBoard = simulationSummary
    ? buildDailyFlowBoard(
        filteredTimelineOrders,
        chamberFill,
        simulationSummary.dateRange,
      )
    : null
  const ripeningChamberRows =
    dailyFlowBoard?.chamberRows.filter((row) => row.mode !== 'conservation') ??
    []
  const conservationChamberRows =
    dailyFlowBoard?.chamberRows.filter((row) => row.mode === 'conservation') ??
    []
  const groupedTimelineBars = buildTimelineBarGroups(filteredTimelineOrders)
  const chamberModeSummary = {
    ripening: ripeningChamberRows.length,
    conservation: conservationChamberRows.length,
    alerts: ripeningChamberRows.filter((row) => row.hasIssue).length,
  }
  const activeFlowSelection = flowSelectionDraft ?? flowSelection
  const selectedFlowSummary = buildFlowSelectionSummary(
    dailyFlowBoard?.chamberRows.find(
      (row) => row.name === activeFlowSelection?.chamberName,
    ),
    activeFlowSelection,
    simulationSummary?.dateRange ?? [],
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

  useEffect(() => {
    function handleWindowPointerUp() {
      setFlowSelectionDraft((current) => {
        if (!current) {
          return current
        }

        if (current.startDate !== current.endDate) {
          setFlowSelection(current)
        }

        return null
      })
    }

    window.addEventListener('mouseup', handleWindowPointerUp)

    return () => {
      window.removeEventListener('mouseup', handleWindowPointerUp)
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

  function handleEditPlanningLine(order: TimelineOrder) {
    const row = activeSheet?.dataframe.rows[order.sourceRowIndex]

    setPlanningEditorDraft(buildPlanningEditorDraft(row, order.sourceRowIndex))
  }

  async function handleOpenFlowBoardCell(chamberName: string, date: string) {
    if (filteredTimelineOrders.length === 0) {
      return
    }

    const matchingOrders = filteredTimelineOrders.filter(
      (order) =>
        order.chamberName === chamberName &&
        isDateWithinOrderWindow(order, date),
    )
    const sourceRowIndexes = [
      ...new Set(matchingOrders.map((order) => order.sourceRowIndex)),
    ].sort((left, right) => left - right)

    if (sourceRowIndexes.length === 0) {
      handleCreatePlanningLineForDate(date)
      return
    }

    if (sourceRowIndexes.length === 1) {
      const matchingOrder = matchingOrders.find(
        (order) => order.sourceRowIndex === sourceRowIndexes[0],
      )

      if (matchingOrder) {
        await handleEditPlanningLine(matchingOrder)
        return
      }
    }

    setGroupedBarViewer({
      title:
        [
          ...new Set(
            matchingOrders.map((order) => order.product).filter(Boolean),
          ),
        ].length === 1
          ? (matchingOrders[0]?.product ?? chamberName)
          : `${[...new Set(matchingOrders.map((order) => order.product).filter(Boolean))].length} productos activos`,
      subtitle: `${chamberName} · ${formatCalendarDate(date)}`,
      sourceRowIndexes,
    })
  }

  function handleFlowCellPointerDown(chamberName: string, date: string) {
    flowSelectionSuppressClickRef.current = false
    setFlowSelectionDraft({
      chamberName,
      startDate: date,
      endDate: date,
    })
    setFlowSelection(null)
  }

  function handleFlowCellPointerEnter(chamberName: string, date: string) {
    setFlowSelectionDraft((current) => {
      if (!current || current.chamberName !== chamberName) {
        return current
      }

      if (current.endDate !== date) {
        flowSelectionSuppressClickRef.current = true
      }

      return {
        ...current,
        endDate: date,
      }
    })
  }

  function handleFlowCellPointerUp() {
    if (!flowSelectionDraft) {
      return
    }

    const nextSelection = flowSelectionDraft
    setFlowSelectionDraft(null)

    if (nextSelection.startDate !== nextSelection.endDate) {
      setFlowSelection(nextSelection)
      return
    }

    setFlowSelection(null)
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
            <section className="subpanel calendar-panel timeline-board-panel">
              <div className="timeline-board-header">
                <div className="timeline-board-copy">
                  <span className="timeline-board-kicker">
                    Timeline de camaras
                  </span>
                  <h3>Ocupacion de camaras en el tiempo</h3>
                  <p>
                    Vista operativa para seguir entradas, salidas y entregas
                    listas sin perder foco en las camaras.
                  </p>
                </div>

                <div className="timeline-board-summary">
                  <article className="timeline-board-summary-card">
                    <span className="section-label">Maduracion</span>
                    <strong>{chamberModeSummary.ripening}</strong>
                    <span>
                      {chamberModeSummary.ripening === 1
                        ? 'camara activa'
                        : 'camaras activas'}
                    </span>
                  </article>
                  <article className="timeline-board-summary-card">
                    <span className="section-label">Conservacion</span>
                    <strong>{chamberModeSummary.conservation}</strong>
                    <span>
                      {chamberModeSummary.conservation === 1
                        ? 'camara reservada'
                        : 'camaras reservadas'}
                    </span>
                  </article>
                  <article className="timeline-board-summary-card">
                    <span className="section-label">Alertas</span>
                    <strong>{chamberModeSummary.alerts}</strong>
                    <span>
                      {chamberModeSummary.alerts === 1
                        ? 'camara con alerta'
                        : 'camaras con alerta'}
                    </span>
                  </article>
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

                <label className="filter-field">
                  <span>Producto</span>
                  <select
                    className="filter-select"
                    value={calendarProductFilter}
                    onChange={(event) =>
                      setCalendarProductFilter(event.target.value)
                    }
                  >
                    <option value="all">Todos los productos</option>
                    {productFilterOptions.map((product) => (
                      <option key={product} value={product}>
                        {product}
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

              {selectedFlowSummary ? (
                <div className="flow-selection-banner">
                  <div>
                    <span className="section-label">Seleccion activa</span>
                    <strong>
                      {selectedFlowSummary.chamberName} ·{' '}
                      {formatCalendarDate(selectedFlowSummary.fromDate)}
                      {selectedFlowSummary.fromDate !==
                      selectedFlowSummary.toDate
                        ? ` a ${formatCalendarDate(selectedFlowSummary.toDate)}`
                        : ''}
                    </strong>
                  </div>
                  <div className="flow-selection-metrics">
                    <span>Ingreso: {selectedFlowSummary.inboundTotal}</span>
                    <span>Salida: {selectedFlowSummary.outboundTotal}</span>
                    <span>
                      Producto:{' '}
                      {selectedFlowSummary.products.length > 0
                        ? selectedFlowSummary.products.join(', ')
                        : 'Sin producto'}
                    </span>
                    <span>
                      OC:{' '}
                      {selectedFlowSummary.purchaseOrders.length > 0
                        ? selectedFlowSummary.purchaseOrders.join(', ')
                        : 'Sin OC'}
                    </span>
                  </div>
                  <button
                    className="ghost-link"
                    type="button"
                    onClick={() => setFlowSelection(null)}
                  >
                    Limpiar
                  </button>
                </div>
              ) : null}

              <div className="calendar-shell timeline-board-shell">
                <div className="calendar-scroll timeline-board-scroll">
                  <div className="calendar-body timeline-board-body">
                    <div className="timeline-date-row">
                      <div className="timeline-side-label timeline-side-label-header">
                        <span className="section-label">Semana</span>
                        <strong>
                          {dailyFlowBoard.days[0]?.weekLabel ?? 'Sin semana'}
                        </strong>
                      </div>

                      <div
                        className="timeline-date-strip"
                        style={{
                          gridTemplateColumns: `repeat(${dailyFlowBoard.days.length}, minmax(118px, 1fr))`,
                        }}
                      >
                        {dailyFlowBoard.days.map((day) => (
                          <div
                            key={`timeline-date-${day.date}`}
                            className="timeline-date-chip"
                          >
                            <strong>{day.date.slice(5)}</strong>
                            <span>{day.weekdayShort}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {[
                      {
                        label: 'Entrega',
                        tone: 'out',
                        values: dailyFlowBoard.days.map(
                          (day) => day.totalOutboundBoxes,
                        ),
                      },
                      {
                        label: 'Ingreso',
                        tone: 'in',
                        values: dailyFlowBoard.days.map(
                          (day) => day.totalInboundBoxes,
                        ),
                      },
                      {
                        label: 'Disponible',
                        tone: 'neutral',
                        values: dailyFlowBoard.days.map(
                          (day) => day.availablePallets,
                        ),
                      },
                    ].map((row) => (
                      <div key={row.label} className="timeline-summary-row">
                        <div className="timeline-side-label">
                          <span className="section-label">{row.label}</span>
                        </div>
                        <div
                          className="timeline-summary-strip"
                          style={{
                            gridTemplateColumns: `repeat(${dailyFlowBoard.days.length}, minmax(118px, 1fr))`,
                          }}
                        >
                          {row.values.map((value, index) => (
                            <div
                              key={`${row.label}-${dailyFlowBoard.days[index]?.date ?? index}`}
                              className={`timeline-summary-chip is-${row.tone}`}
                            >
                              {value > 0 ? value : '—'}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {[
                      {
                        title: 'Maduracion',
                        rows: ripeningChamberRows,
                      },
                      {
                        title: 'Conservacion',
                        rows: conservationChamberRows,
                      },
                    ]
                      .filter((section) => section.rows.length > 0)
                      .map((section) => (
                        <section
                          key={section.title}
                          className="timeline-section-block"
                        >
                          <div className="timeline-section-heading">
                            <span className="section-label">
                              {section.title}
                            </span>
                          </div>

                          <div className="timeline-row-list">
                            {section.rows.map((chamberRow) => {
                              const chamberGroups =
                                groupedTimelineBars.get(chamberRow.name) ?? []
                              const laneCount = Math.max(
                                1,
                                ...chamberGroups.map((group) => group.lane + 1),
                              )

                              return (
                                <div
                                  key={chamberRow.name}
                                  className="timeline-chamber-row"
                                >
                                  <div className="timeline-chamber-card">
                                    <div className="timeline-chamber-card-head">
                                      <div>
                                        <strong>{chamberRow.name}</strong>
                                        <span>
                                          {chamberRow.productSummary.length > 0
                                            ? chamberRow.productSummary
                                                .slice(0, 2)
                                                .join(' · ')
                                            : chamberRow.mode === 'conservation'
                                              ? 'Producto listo o saldo'
                                              : 'Sin producto activo'}
                                        </span>
                                      </div>
                                      <span
                                        className={`flow-board-status-pill is-${buildFlowBoardChamberStatusTone(
                                          chamberRow,
                                        )}`}
                                        title={
                                          chamberRow.issueNote &&
                                          chamberRow.hasIssue
                                            ? chamberRow.issueNote
                                            : undefined
                                        }
                                      >
                                        {buildFlowBoardChamberStatus(
                                          chamberRow,
                                        )}
                                      </span>
                                    </div>

                                    {chamberRow.issueNote &&
                                    chamberRow.hasIssue ? (
                                      <p className="timeline-chamber-warning">
                                        {chamberRow.issueNote}
                                      </p>
                                    ) : null}
                                  </div>

                                  <div
                                    className="timeline-track-grid"
                                    style={{
                                      gridTemplateColumns: `repeat(${dailyFlowBoard.days.length}, minmax(118px, 1fr))`,
                                      gridTemplateRows: `repeat(${laneCount}, minmax(72px, auto))`,
                                    }}
                                  >
                                    {dailyFlowBoard.days.map((day) => {
                                      const inbound =
                                        chamberRow.inboundByDate[day.date] ?? 0
                                      const outbound =
                                        chamberRow.outboundByDate[day.date] ?? 0
                                      const riskNote =
                                        chamberRow.riskByDate[day.date] ?? null

                                      return (
                                        <button
                                          key={`${chamberRow.name}-${day.date}`}
                                          type="button"
                                          className={[
                                            'timeline-track-slot',
                                            riskNote ? 'has-risk' : '',
                                            activeFlowSelection?.chamberName ===
                                              chamberRow.name &&
                                            activeFlowSelection &&
                                            isDateInsideFlowSelection(
                                              activeFlowSelection,
                                              day.date,
                                            )
                                              ? 'is-selected'
                                              : '',
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                          style={{
                                            gridColumn: `${dailyFlowBoard.days.indexOf(day) + 1}`,
                                            gridRow: `1 / span ${laneCount}`,
                                          }}
                                          title={buildFlowBoardCellTitle(
                                            chamberRow,
                                            day.date,
                                            inbound,
                                            outbound,
                                          )}
                                          onMouseDown={() =>
                                            handleFlowCellPointerDown(
                                              chamberRow.name,
                                              day.date,
                                            )
                                          }
                                          onMouseEnter={(event) => {
                                            if (event.buttons === 1) {
                                              handleFlowCellPointerEnter(
                                                chamberRow.name,
                                                day.date,
                                              )
                                            }
                                          }}
                                          onMouseUp={handleFlowCellPointerUp}
                                          onClick={() => {
                                            if (
                                              flowSelectionSuppressClickRef.current
                                            ) {
                                              flowSelectionSuppressClickRef.current = false
                                              return
                                            }

                                            void handleOpenFlowBoardCell(
                                              chamberRow.name,
                                              day.date,
                                            )
                                          }}
                                        >
                                          <span className="timeline-slot-plus">
                                            +
                                          </span>
                                          {inbound > 0 ? (
                                            <span className="timeline-cell-chip is-in">
                                              <span>↑</span>
                                              <strong>{inbound}</strong>
                                            </span>
                                          ) : null}
                                          {outbound > 0 ? (
                                            <span className="timeline-cell-chip is-out">
                                              <span>↓</span>
                                              <strong>{outbound}</strong>
                                            </span>
                                          ) : null}
                                          {riskNote ? (
                                            <span
                                              className="timeline-cell-risk"
                                              data-risk={riskNote}
                                            >
                                              !
                                            </span>
                                          ) : null}
                                        </button>
                                      )
                                    })}

                                    {chamberGroups.map((group) => {
                                      const span =
                                        group.endIndex - group.startIndex + 1
                                      const uniqueProducts = [
                                        ...new Set(
                                          group.sourceRowIndexes
                                            .map(
                                              (sourceRowIndex) =>
                                                activeSheet?.dataframe.rows[
                                                  sourceRowIndex
                                                ]?.product,
                                            )
                                            .filter(Boolean),
                                        ),
                                      ]
                                      const titleLines = [
                                        group.product,
                                        group.recipeLabel,
                                        `Entrega(s): ${group.requiredDates
                                          .map((date) =>
                                            formatCalendarDate(date),
                                          )
                                          .join(', ')}`,
                                        uniqueProducts.length > 0
                                          ? `Productos: ${uniqueProducts.join(', ')}`
                                          : '',
                                        group.riskNote
                                          ? `Alerta: ${group.riskNote}`
                                          : '',
                                      ].filter(Boolean)

                                      return (
                                        <button
                                          key={group.id}
                                          type="button"
                                          className={[
                                            'order-bar',
                                            'timeline-order-bar',
                                            group.scenarioStatus === 'late_risk'
                                              ? 'is-risk'
                                              : 'is-ready',
                                            group.sourceRowIndexes.length > 1
                                              ? 'is-grouped'
                                              : '',
                                          ]
                                            .filter(Boolean)
                                            .join(' ')}
                                          style={{
                                            gridColumn: `${group.startIndex + 1} / span ${span}`,
                                            gridRow: `${group.lane + 1}`,
                                          }}
                                          title={titleLines.join('\n')}
                                          onClick={() => {
                                            if (
                                              group.sourceRowIndexes.length > 1
                                            ) {
                                              setGroupedBarViewer(
                                                buildGroupedBarViewerPayload(
                                                  group,
                                                  chamberRow.name,
                                                  activeSheet,
                                                ),
                                              )
                                              return
                                            }

                                            const sourceRowIndex =
                                              group.sourceRowIndexes[0]
                                            const matchingOrder =
                                              filteredTimelineOrders.find(
                                                (order) =>
                                                  order.sourceRowIndex ===
                                                  sourceRowIndex,
                                              )

                                            if (matchingOrder) {
                                              handleEditPlanningLine(
                                                matchingOrder,
                                              )
                                            }
                                          }}
                                        >
                                          <div className="order-bar-copy">
                                            <strong>{group.product}</strong>
                                            <span className="order-bar-window">
                                              {formatCalendarDate(
                                                dailyFlowBoard.days[
                                                  group.startIndex
                                                ]?.date,
                                              )}{' '}
                                              a{' '}
                                              {formatCalendarDate(
                                                dailyFlowBoard.days[
                                                  group.endIndex
                                                ]?.date,
                                              )}
                                            </span>
                                          </div>

                                          <div className="order-bar-meta">
                                            <span className="order-bar-recipe">
                                              {group.recipeLabel}
                                            </span>
                                            <span className="order-bar-secondary">
                                              {group.deliveryCount === 1
                                                ? `Listo ${formatCalendarDate(
                                                    group.requiredDates[0],
                                                  )}`
                                                : `Hasta ${formatCalendarDate(
                                                    group.requiredDates.at(-1),
                                                  )} · ${
                                                    group.deliveryCount
                                                  } entregas`}
                                            </span>
                                          </div>

                                          <div className="order-bar-milestones">
                                            {group.requiredDates.map(
                                              (
                                                requiredDate,
                                                milestoneIndex,
                                              ) => {
                                                const deliveryIndex = Math.min(
                                                  group.endIndex,
                                                  Math.max(
                                                    group.startIndex,
                                                    dailyFlowBoard.days.findIndex(
                                                      (day) =>
                                                        day.date ===
                                                        requiredDate,
                                                    ),
                                                  ),
                                                )
                                                const milestoneLeft = `${
                                                  ((deliveryIndex -
                                                    group.startIndex +
                                                    1) /
                                                    span) *
                                                  100
                                                }%`

                                                return (
                                                  <div
                                                    key={`${group.id}-${requiredDate}`}
                                                    className={`order-bar-milestone ${
                                                      milestoneIndex ===
                                                      group.requiredDates
                                                        .length -
                                                        1
                                                        ? 'is-final'
                                                        : ''
                                                    }`}
                                                    style={{
                                                      left: milestoneLeft,
                                                    }}
                                                  >
                                                    <span className="order-bar-milestone-chip">
                                                      Listo{' '}
                                                      {formatCalendarDate(
                                                        requiredDate,
                                                      )}
                                                    </span>
                                                  </div>
                                                )
                                              },
                                            )}
                                          </div>

                                          {group.riskNote ? (
                                            <span className="order-bar-cutoff bar-warning">
                                              Alerta
                                            </span>
                                          ) : null}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </section>
                      ))}
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
