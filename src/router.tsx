import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import {
  type PointerEvent,
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { exportSimulationWorkbook } from '@/lib/export-simulation'
import {
  findMissingColumnKeys,
  formatBytes,
  type ParsedWorkbook,
  parsePurchaseFile,
  purchaseFileLimits,
} from '@/lib/purchase-file'
import {
  buildChamberFill,
  buildSimulationMetrics,
  buildSimulationSummary,
  buildTimelineOrders,
  type ChamberFill,
  type TimelineOrder,
} from '@/lib/simulation-lab'

const expectedFields = ['required_date', 'quantity', 'product']

const scenarioOptions = [
  {
    id: 'balanced',
    label: 'Plan balanceado',
    detail: 'Equilibra cumplimiento de fechas y uso eficiente de camaras.',
  },
  {
    id: 'margin',
    label: 'Proteccion de margen',
    detail: 'Reduce perdida de valor y evita maduracion innecesaria.',
  },
  {
    id: 'service',
    label: 'Prioridad servicio',
    detail: 'Prioriza cumplimiento aunque suba el costo operativo.',
  },
] as const

const chamberSettingsStorageKey = 'ripenflow:chamber-count'
const unavailableChambersStorageKey = 'ripenflow:unavailable-chambers'
const defaultChamberCount = 4
const minChamberCount = 1
const maxChamberCount = 12
const visibleRiskGroupLimit = 3

type UploadIssueModal = {
  title: string
  reasons: string[]
}

type RiskGroup = {
  id: string
  chamberName: string
  riskNote: string
  products: string[]
  centers: string[]
  orderCount: number
  earliestRequiredDate: string
  latestRequiredDate: string
}

type ChamberTimelineBar = TimelineOrder & {
  laneIndex: number
  centerCount: number
  centers: string[]
  lineCount: number
  totalBoxes: number
  totalPallets: number
}

type ChamberCalendarRow = {
  chamber: ChamberFill
  bars: ChamberTimelineBar[]
  laneCount: number
  visibleProductSummary: string
}

type HoveredCalendarBar = {
  bar: ChamberTimelineBar
  x: number
  y: number
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`
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

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase()
}

function buildVisibleProductSummary(orders: TimelineOrder[]) {
  const products = [
    ...new Set(orders.map((order) => order.product).filter(Boolean)),
  ]

  if (products.length === 0) {
    return 'Sin productos visibles'
  }

  if (products.length === 1) {
    return products[0]
  }

  if (products.length === 2) {
    return `${products[0]} + ${products[1]}`
  }

  return `${products[0]} +${products.length - 1} more`
}

function buildCalendarBarSummary(bar: ChamberTimelineBar) {
  if (bar.centerCount <= 1) {
    return `${bar.centers[0] ?? 'Centro sin asignar'} · ${bar.totalBoxes} cajas`
  }

  const visibleCenters = bar.centers.slice(0, 2)
  const hiddenCenters = bar.centerCount - visibleCenters.length

  return `${visibleCenters.join(', ')}${hiddenCenters > 0 ? ` +${hiddenCenters}` : ''} · ${bar.totalBoxes} cajas`
}

function buildChamberCalendarRows(
  orders: TimelineOrder[],
  chambers: ChamberFill[],
) {
  const ordersByChamber = new Map<string, TimelineOrder[]>()

  for (const order of orders) {
    const chamberOrders = ordersByChamber.get(order.chamberName) ?? []
    chamberOrders.push(order)
    ordersByChamber.set(order.chamberName, chamberOrders)
  }

  return chambers
    .map((chamber) => {
      const chamberOrders = [...(ordersByChamber.get(chamber.name) ?? [])]
      const groupedBars = new Map<string, ChamberTimelineBar>()

      for (const order of chamberOrders) {
        const groupId = [
          order.chamberName,
          order.product,
          order.purchaseOrderRef,
          order.startIndex,
          order.span,
          order.requiredDate,
          order.scenarioStatus,
        ].join('::')
        const existing = groupedBars.get(groupId)

        if (!existing) {
          groupedBars.set(groupId, {
            ...order,
            laneIndex: 0,
            centerCount: order.center ? 1 : 0,
            centers: order.center ? [order.center] : [],
            lineCount: 1,
            totalBoxes: order.quantityBoxes,
            totalPallets: order.pallets,
          })
          continue
        }

        existing.lineCount += 1
        existing.totalBoxes += order.quantityBoxes
        existing.totalPallets += order.pallets

        if (order.center && !existing.centers.includes(order.center)) {
          existing.centers.push(order.center)
          existing.centerCount = existing.centers.length
        }
      }

      const chamberBars = [...groupedBars.values()].sort(
        (left, right) =>
          left.startIndex - right.startIndex ||
          compareTextValues(left.requiredDate, right.requiredDate) ||
          compareTextValues(left.product, right.product) ||
          right.totalPallets - left.totalPallets,
      )
      const laneEndIndexes: number[] = []
      const bars = chamberBars.map((bar) => {
        const orderEndIndex = bar.startIndex + bar.span - 1
        let laneIndex = laneEndIndexes.findIndex(
          (lastEndIndex) => bar.startIndex > lastEndIndex,
        )

        if (laneIndex === -1) {
          laneIndex = laneEndIndexes.length
          laneEndIndexes.push(orderEndIndex)
        } else {
          laneEndIndexes[laneIndex] = orderEndIndex
        }

        return {
          ...bar,
          laneIndex,
        } satisfies ChamberTimelineBar
      })

      return {
        chamber,
        bars,
        laneCount: Math.max(laneEndIndexes.length, 1),
        visibleProductSummary: buildVisibleProductSummary(chamberOrders),
      } satisfies ChamberCalendarRow
    })
    .filter((row) => row.bars.length > 0 || row.chamber.isUnavailable)
}

function buildRiskGroups(orders: TimelineOrder[]) {
  const grouped = new Map<string, RiskGroup>()

  for (const order of orders) {
    if (order.scenarioStatus !== 'late_risk' || !order.riskNote) {
      continue
    }

    const groupId = `${order.chamberName}::${order.riskNote}`
    const existing = grouped.get(groupId)

    if (!existing) {
      grouped.set(groupId, {
        id: groupId,
        chamberName: order.chamberName,
        riskNote: order.riskNote,
        products: [order.product],
        centers: [order.center],
        orderCount: 1,
        earliestRequiredDate: order.requiredDate,
        latestRequiredDate: order.requiredDate,
      })
      continue
    }

    if (!existing.products.includes(order.product)) {
      existing.products.push(order.product)
    }

    if (!existing.centers.includes(order.center)) {
      existing.centers.push(order.center)
    }

    existing.orderCount += 1
    existing.earliestRequiredDate =
      order.requiredDate < existing.earliestRequiredDate
        ? order.requiredDate
        : existing.earliestRequiredDate
    existing.latestRequiredDate =
      order.requiredDate > existing.latestRequiredDate
        ? order.requiredDate
        : existing.latestRequiredDate
  }

  return [...grouped.values()].sort((left, right) =>
    left.earliestRequiredDate.localeCompare(right.earliestRequiredDate),
  )
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
  const shellRef = useRef<HTMLDivElement | null>(null)

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const shell = shellRef.current

    if (!shell) {
      return
    }

    const bounds = shell.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100

    shell.style.setProperty('--cursor-x', `${x}%`)
    shell.style.setProperty('--cursor-y', `${y}%`)
  }

  function handlePointerLeave() {
    const shell = shellRef.current

    if (!shell) {
      return
    }

    shell.style.setProperty('--cursor-x', '50%')
    shell.style.setProperty('--cursor-y', '18%')
  }

  return (
    <div
      ref={shellRef}
      className="shell"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
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
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [activeScenario, setActiveScenario] = useState('balanced')
  const [uploadIssue, setUploadIssue] = useState<UploadIssueModal | null>(null)
  const [simulationProgress, setSimulationProgress] = useState(0)
  const [simulationRunId, setSimulationRunId] = useState(0)
  const [showAllRisks, setShowAllRisks] = useState(false)
  const [calendarSearch, setCalendarSearch] = useState('')
  const [calendarProductFilter, setCalendarProductFilter] = useState('all')
  const [hoveredCalendarBar, setHoveredCalendarBar] =
    useState<HoveredCalendarBar | null>(null)
  const [chamberCount, setChamberCount] = useState(defaultChamberCount)
  const [chamberCountInput, setChamberCountInput] = useState(
    String(defaultChamberCount),
  )
  const [unavailableChambers, setUnavailableChambers] = useState<string[]>([])
  const [unavailableChambersDraft, setUnavailableChambersDraft] = useState<
    string[]
  >([])

  const activeSheet = parsedWorkbook?.sheets[activeSheetIndex] ?? null
  const simulationSummary = activeSheet
    ? buildSimulationSummary(activeSheet, {
        chamberCount,
        scenarioId: activeScenario,
        unavailableChambers,
      })
    : null
  const selectedFileName =
    parsedWorkbook?.fileName ?? 'Ningun archivo seleccionado'
  const timelineOrders = simulationSummary
    ? buildTimelineOrders(simulationSummary)
    : []
  const chamberFill = simulationSummary
    ? buildChamberFill(simulationSummary, simulationProgress)
    : []
  const productFilterOptions = [
    ...new Set(timelineOrders.map((order) => order.product).filter(Boolean)),
  ].sort(compareTextValues)
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
  const chamberCalendarRows = buildChamberCalendarRows(
    filteredTimelineOrders,
    chamberFill,
  )
  const simulationMetrics = simulationSummary
    ? buildSimulationMetrics(simulationSummary, simulationProgress)
    : []
  const riskGroups = buildRiskGroups(filteredTimelineOrders)
  const visibleRiskGroups = showAllRisks
    ? riskGroups
    : riskGroups.slice(0, visibleRiskGroupLimit)
  const affectedChamberCount = new Set(
    riskGroups.map((riskGroup) => riskGroup.chamberName),
  ).size
  const activeScenarioOption =
    scenarioOptions.find((scenario) => scenario.id === activeScenario) ??
    scenarioOptions[0]
  const workbookWarnings = parsedWorkbook?.warnings ?? []
  const detectedOrderCount = activeSheet?.dataframe.totalRows ?? 0
  const hasLoadedWorkbook = parsedWorkbook !== null
  const dataframePreview =
    activeSheet?.dataframe.sampleRows.map((row, index) => ({
      _row_number: index + 2,
      ...row,
    })) ?? []
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
  const normalizedUnavailableChambers = previewChamberNames.filter((name) =>
    unavailableChambersDraft.includes(name),
  )
  const hasPendingUnavailableChambers =
    normalizedUnavailableChambers.join('|') !== unavailableChambers.join('|')
  const hasPendingChamberConfig =
    hasPendingChamberCount || hasPendingUnavailableChambers

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedValue = window.localStorage.getItem(chamberSettingsStorageKey)
    const parsedValue = storedValue ? Number.parseInt(storedValue, 10) : NaN
    const nextChamberCount = Number.isFinite(parsedValue)
      ? Math.min(Math.max(parsedValue, minChamberCount), maxChamberCount)
      : defaultChamberCount

    setChamberCount(nextChamberCount)
    setChamberCountInput(String(nextChamberCount))

    const storedUnavailable = window.localStorage.getItem(
      unavailableChambersStorageKey,
    )
    const nextUnavailableChambers = storedUnavailable
      ? storedUnavailable
          .split('|')
          .filter((value) =>
            Array.from(
              { length: nextChamberCount },
              (_, index) => `Camara ${String.fromCharCode(65 + index)}`,
            ).includes(value),
          )
      : []

    setUnavailableChambers(nextUnavailableChambers)
    setUnavailableChambersDraft(nextUnavailableChambers)
  }, [])

  useEffect(() => {
    if (!activeSheet) {
      setSimulationProgress(0)
      return
    }

    const velocityByScenario =
      activeScenario === 'service'
        ? 0.028
        : activeScenario === 'margin'
          ? 0.02
          : 0.024
    const currentRunId = simulationRunId

    setSimulationProgress(0)

    const timer = window.setInterval(() => {
      if (currentRunId < 0) {
        window.clearInterval(timer)
        return
      }

      setSimulationProgress((currentProgress) => {
        const nextProgress = Math.min(currentProgress + velocityByScenario, 1)

        if (nextProgress >= 1) {
          window.clearInterval(timer)
        }

        return nextProgress
      })
    }, 220)

    return () => window.clearInterval(timer)
  }, [activeSheet, activeScenario, simulationRunId])

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
      const preferredSheetIndex = getPreferredSheetIndex(nextWorkbook)

      if (preferredSheetIndex === -1) {
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

      startTransition(() => {
        setParsedWorkbook(workbookWithWarnings)
        setActiveSheetIndex(preferredSheetIndex)
        setSimulationRunId((current) => current + 1)
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

  function handleSaveChamberCount() {
    const nextChamberCount = normalizedChamberCount
    const nextUnavailableChambers = normalizedUnavailableChambers

    setChamberCount(nextChamberCount)
    setChamberCountInput(String(nextChamberCount))
    setUnavailableChambers(nextUnavailableChambers)
    setUnavailableChambersDraft(nextUnavailableChambers)
    setSimulationRunId((current) => current + 1)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        chamberSettingsStorageKey,
        String(nextChamberCount),
      )
      window.localStorage.setItem(
        unavailableChambersStorageKey,
        nextUnavailableChambers.join('|'),
      )
    }
  }

  function handleToggleUnavailableChamber(chamberName: string) {
    setUnavailableChambersDraft((current) =>
      current.includes(chamberName)
        ? current.filter((name) => name !== chamberName)
        : [...current, chamberName].sort(),
    )
  }

  function handleCalendarBarPointerMove(
    event: PointerEvent<HTMLDivElement>,
    bar: ChamberTimelineBar,
  ) {
    setHoveredCalendarBar({
      bar,
      x: event.clientX,
      y: event.clientY,
    })
  }

  return (
    <div className="workspace">
      <section className="panel upload-panel">
        <div className="panel-header upload-header">
          <div>
            <p className="section-label">Carga de archivo</p>
            <h2>Subir orden de compra</h2>
            <p className="panel-copy">
              Carga un archivo `.csv`, `.xls` o `.xlsx`. Interpretamos la
              primera fila como encabezados y generamos de inmediato una vista
              de planificacion para el cliente. Las matrices anchas con una
              columna por fecha se normalizan automaticamente.
            </p>
          </div>
          <span className="pill">{isReadingFile ? 'Leyendo' : 'Listo'}</span>
        </div>

        <div className="upload-layout">
          <div className="uploader-card">
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

            <p className="section-label">Archivo fuente</p>
            <h3>Ingreso de orden del cliente</h3>
            <p className="panel-copy">
              Usa el selector visible de abajo. En cuanto el archivo se procesa,
              la simulacion se actualiza automaticamente.
            </p>

            <div className="limits-list">
              <span>
                Maximo {formatBytes(purchaseFileLimits.maxFileSizeBytes)}
              </span>
              <span>Hasta {purchaseFileLimits.maxSheets} hojas</span>
              <span>
                Hasta {purchaseFileLimits.maxRowsPerSheet} filas por hoja
              </span>
              <span>Hasta {purchaseFileLimits.maxTotalRows} filas totales</span>
              <span>
                Hasta {purchaseFileLimits.maxColumnsPerSheet} columnas por hoja
              </span>
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
              <p className="section-label">Archivo seleccionado</p>
              <strong>{selectedFileName}</strong>
              <span>
                {hasLoadedWorkbook
                  ? `${formatCount(detectedOrderCount, 'fila detectada', 'filas detectadas')} en la hoja activa`
                  : 'Sube una orden de compra para desbloquear la vista de simulacion.'}
              </span>
            </div>

            <div className="upload-hint">
              Supuestos visibles: quantity se interpreta como cajas y luego se
              convierte a pallets y contenedores para la simulacion. Si el
              archivo viene como matriz de demanda, cada celda con fecha y
              cantidad mayor a cero se transforma en una linea de pedido.
            </div>

            {parsedWorkbook ? (
              <div className="upload-summary">
                <strong>1 archivo cargado</strong>
                <span>
                  {formatCount(
                    detectedOrderCount,
                    'fila detectada',
                    'filas detectadas',
                  )}
                </span>
                <p>
                  El planificador interpreta cada fila del archivo cargado como
                  una linea independiente. Un solo CSV puede contener muchas
                  necesidades.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <div className="alert alert-error">{errorMessage}</div>
        ) : null}
      </section>

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
        <section className="panel simulation-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Laboratorio de simulacion</p>
              <h2>Escenario de planificacion en vivo</h2>
              <p className="panel-copy">
                Corre un escenario orientado al cliente con movimiento visible,
                carga operativa y riesgo sobre fechas de entrega.
              </p>
              <p className="simulation-explainer">
                {selectedFileName} genero{' '}
                {formatCount(
                  detectedOrderCount,
                  'linea simulada',
                  'lineas simuladas',
                )}
                . El planificador no trata todo el archivo como una sola orden.
              </p>
            </div>

            <div className="panel-actions">
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
                    scenarioDetail: activeScenarioOption.detail,
                    scenarioLabel: activeScenarioOption.label,
                    summary: simulationSummary,
                    timelineOrders,
                  })
                }}
              >
                Descargar workbook de resultados
              </button>
              <button
                className="ghost-link"
                type="button"
                onClick={() => setSimulationRunId((current) => current + 1)}
              >
                Volver a simular
              </button>
            </div>
          </div>

          {workbookWarnings.length > 0 ? (
            <div className="alert alert-warning">
              <ul className="warning-list">
                {workbookWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="scenario-strip">
            {scenarioOptions.map((scenario) => (
              <button
                key={scenario.id}
                className={
                  scenario.id === activeScenario
                    ? 'scenario-card is-active'
                    : 'scenario-card'
                }
                type="button"
                onClick={() => setActiveScenario(scenario.id)}
              >
                <strong>{scenario.label}</strong>
                <span>{scenario.detail}</span>
              </button>
            ))}
          </div>

          <section className="subpanel planning-controls-panel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">Controles de planificacion</p>
                <h3>Disponibilidad de camaras</h3>
              </div>
              <span>{Math.round(simulationProgress * 100)}% completado</span>
            </div>

            <div className="chamber-config-bar">
              <p className="chamber-config-copy">
                Define cuantas camaras estan disponibles antes de leer el
                calendario. Las camaras ocupadas siguen visibles como alerta,
                pero el planificador no las usa.
              </p>

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
                  disabled={!hasPendingChamberConfig}
                  onClick={handleSaveChamberCount}
                >
                  Guardar
                </button>
              </div>
            </div>

            <div className="chamber-toggle-row">
              {previewChamberNames.map((chamberName) => (
                <button
                  key={chamberName}
                  className={
                    unavailableChambersDraft.includes(chamberName)
                      ? 'chamber-toggle is-active'
                      : 'chamber-toggle'
                  }
                  type="button"
                  onClick={() => handleToggleUnavailableChamber(chamberName)}
                >
                  <strong>{chamberName}</strong>
                  <span>
                    {unavailableChambersDraft.includes(chamberName)
                      ? 'Ocupada'
                      : 'Disponible'}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="subpanel snapshot-panel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">Resumen de demanda</p>
                <h3>Pallets, cajas y contenedores</h3>
              </div>
            </div>

            <div className="snapshot-hero">
              <div className="snapshot-stack">
                <div className="snapshot-visual snapshot-visual-containers">
                  {Array.from(
                    {
                      length: Math.max(simulationSummary.totalContainers, 1),
                    },
                    (_, slotNumber) => slotNumber + 1,
                  ).map((slotNumber) => (
                    <span
                      key={`container-${slotNumber}`}
                      className="snapshot-unit is-container"
                    />
                  ))}
                </div>
                <div className="snapshot-visual snapshot-visual-pallets">
                  {Array.from(
                    { length: Math.min(simulationSummary.totalPallets, 18) },
                    (_, slotNumber) => slotNumber + 1,
                  ).map((slotNumber) => (
                    <span
                      key={`pallet-${slotNumber}`}
                      className="snapshot-unit is-pallet"
                    />
                  ))}
                </div>
                <div className="snapshot-visual snapshot-visual-boxes">
                  {Array.from(
                    {
                      length: Math.min(
                        Math.ceil(simulationSummary.totalBoxes / 1200),
                        18,
                      ),
                    },
                    (_, slotNumber) => slotNumber + 1,
                  ).map((slotNumber) => (
                    <span
                      key={`box-${slotNumber}`}
                      className="snapshot-unit is-box"
                    />
                  ))}
                </div>
              </div>

              <div className="snapshot-caption">
                <strong>Perfil de carga actual</strong>
                <span>
                  Los bloques verdes muestran la huella de carga derivada del
                  archivo cargado.
                </span>
              </div>
            </div>

            <div className="demand-stack">
              <article className="demand-card demand-good">
                <strong>{simulationSummary.totalBoxes}</strong>
                <span>Cajas requeridas</span>
              </article>
              <article className="demand-card demand-good">
                <strong>{simulationSummary.totalPallets}</strong>
                <span>Pallets estimados</span>
              </article>
              <article className="demand-card demand-good">
                <strong>
                  {
                    simulationSummary.chamberUsage.filter(
                      (chamber) => chamber.activated,
                    ).length
                  }
                </strong>
                <span>Camaras activas</span>
              </article>
              <article className="demand-card demand-neutral">
                <strong>{formatBytes(parsedWorkbook?.size ?? 0)}</strong>
                <span>Tamano del archivo</span>
              </article>
            </div>
          </section>

          <div className="metric-grid">
            {simulationMetrics
              .filter((metric) => metric.label !== 'Contenedores estimados')
              .map((metric) => (
                <article
                  key={metric.label}
                  className={`metric-card ${metric.tone}${metric.tone === 'warning' ? ' has-issue' : ''}`}
                >
                  <p className="section-label">{metric.label}</p>
                  <strong>{metric.value}</strong>
                  <span>{metric.hint}</span>
                </article>
              ))}
          </div>

          <section className="subpanel calendar-panel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">Vista calendario</p>
                <h3>Ocupacion de camaras en el tiempo</h3>
              </div>
              <span>
                {filteredTimelineOrders.length} lineas visibles en{' '}
                {chamberCalendarRows.length} camaras
              </span>
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

            <div className="calendar-legend">
              <p className="calendar-legend-title">
                El calendario distingue entre carga en plan y carga con riesgo
              </p>
              <div className="calendar-legend-list">
                <span className="calendar-legend-item legend-ripening">
                  en plan queda en verde
                </span>
                <span className="calendar-legend-item legend-risk">
                  riesgo sigue en rojo
                </span>
              </div>
            </div>

            <div className="calendar-shell">
              <div className="calendar-scroll">
                <div
                  className="calendar-grid calendar-header"
                  style={{
                    gridTemplateColumns: `280px repeat(${simulationSummary.dateRange.length}, minmax(90px, 1fr))`,
                  }}
                >
                  <div className="calendar-cell calendar-label">Camara</div>
                  {simulationSummary.dateRange.map((date) => (
                    <div key={date} className="calendar-cell">
                      {date.slice(5)}
                    </div>
                  ))}
                </div>

                <div className="calendar-body">
                  {chamberCalendarRows.map((row) => (
                    <div
                      key={row.chamber.name}
                      className="calendar-grid chamber-calendar-row"
                      style={{
                        gridTemplateColumns: `280px repeat(${simulationSummary.dateRange.length}, minmax(90px, 1fr))`,
                        minHeight: `${row.laneCount * 56 + 26}px`,
                      }}
                    >
                      <div className="calendar-cell calendar-chamber-info">
                        <div className="calendar-chamber-head">
                          <strong>{row.chamber.name}</strong>
                          {row.chamber.hasIssue ? (
                            <span className="issue-pill">
                              {row.chamber.isUnavailable
                                ? 'Ocupada'
                                : row.chamber.lateRiskOrders > 0
                                  ? `${row.chamber.lateRiskOrders} alerta`
                                  : 'Alerta'}
                            </span>
                          ) : (
                            <span className="status-pill">En plan</span>
                          )}
                        </div>
                        <span>
                          {row.chamber.occupancy}% ocupada ·{' '}
                          {row.visibleProductSummary}
                        </span>
                        <span>
                          {formatCount(
                            row.bars.length,
                            'grupo visible',
                            'grupos visibles',
                          )}
                        </span>
                        {row.chamber.issueNote ? (
                          <p className="calendar-warning-note">
                            {row.chamber.issueNote}
                          </p>
                        ) : null}
                      </div>

                      {simulationSummary.dateRange.map((date) => (
                        <div
                          key={`${row.chamber.name}-${date}`}
                          className="calendar-slot"
                        />
                      ))}

                      {row.bars.map((order) => (
                        <div
                          key={order.id}
                          className={`order-bar order-${order.scenarioStatus}${order.scenarioStatus === 'late_risk' ? ' has-issue' : ''}`}
                          onPointerEnter={(event) =>
                            handleCalendarBarPointerMove(event, order)
                          }
                          onPointerMove={(event) =>
                            handleCalendarBarPointerMove(event, order)
                          }
                          onPointerLeave={() => setHoveredCalendarBar(null)}
                          style={{
                            gridColumn: `${order.startIndex + 2} / span ${order.span}`,
                            top: `${12 + order.laneIndex * 56}px`,
                            opacity: 0.35 + simulationProgress * 0.65,
                            transform: `scaleX(${Math.max(simulationProgress, 0.12)})`,
                          }}
                        >
                          <div className="order-bar-copy">
                            <strong>{order.product}</strong>
                            <span>{buildCalendarBarSummary(order)}</span>
                          </div>
                          <div className="order-bar-meta">
                            <span>
                              {formatCalendarDate(order.requiredDate)}
                            </span>
                            {order.lineCount > 1 ? (
                              <span>{order.lineCount} lineas agrupadas</span>
                            ) : null}
                            {order.scenarioStatus === 'late_risk' ? (
                              <span className="bar-warning">Alerta</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}

                  {chamberCalendarRows.length === 0 ? (
                    <div className="calendar-empty-state">
                      Ninguna camara coincide con los filtros actuales.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {hoveredCalendarBar ? (
              <div
                className="floating-calendar-tooltip"
                style={{
                  left: `${Math.min(
                    hoveredCalendarBar.x + 16,
                    (typeof window !== 'undefined' ? window.innerWidth : 1280) -
                      340,
                  )}px`,
                  top: `${Math.min(
                    hoveredCalendarBar.y + 18,
                    (typeof window !== 'undefined' ? window.innerHeight : 900) -
                      180,
                  )}px`,
                }}
              >
                <strong>{hoveredCalendarBar.bar.product}</strong>
                {hoveredCalendarBar.bar.purchaseOrderRef ? (
                  <span>OC: {hoveredCalendarBar.bar.purchaseOrderRef}</span>
                ) : null}
                <span>
                  {hoveredCalendarBar.bar.centers.length > 0
                    ? `Centros: ${hoveredCalendarBar.bar.centers.join(', ')}`
                    : 'Centro sin asignar'}
                </span>
                <span>
                  {hoveredCalendarBar.bar.totalBoxes} cajas ·{' '}
                  {hoveredCalendarBar.bar.totalPallets} pallets
                </span>
                <span>
                  Fecha requerida:{' '}
                  {formatCalendarDate(hoveredCalendarBar.bar.requiredDate)}
                </span>
                <span>
                  Lineas agrupadas: {hoveredCalendarBar.bar.lineCount}
                </span>
                {hoveredCalendarBar.bar.riskNote ? (
                  <span>Alerta: {hoveredCalendarBar.bar.riskNote}</span>
                ) : null}
              </div>
            ) : null}

            {riskGroups.length > 0 ? (
              <div className="calendar-insights">
                <div className="risk-summary-grid">
                  <article className="risk-summary-card">
                    <strong>
                      {riskGroups.reduce(
                        (sum, riskGroup) => sum + riskGroup.orderCount,
                        0,
                      )}
                    </strong>
                    <span>Lineas con riesgo</span>
                  </article>
                  <article className="risk-summary-card">
                    <strong>{affectedChamberCount}</strong>
                    <span>Camaras afectadas</span>
                  </article>
                  <article className="risk-summary-card">
                    <strong>{riskGroups.length}</strong>
                    <span>Grupos de riesgo</span>
                  </article>
                </div>

                {visibleRiskGroups.map((riskGroup) => (
                  <article key={riskGroup.id} className="risk-card">
                    <div className="risk-card-head">
                      <strong>
                        {riskGroup.chamberName} · {riskGroup.orderCount} linea
                        afectada
                        {riskGroup.orderCount === 1 ? '' : 's'}
                      </strong>
                      <span className="issue-pill">Riesgo</span>
                    </div>
                    <p>{riskGroup.riskNote}</p>
                    <div className="risk-card-meta">
                      <span>
                        Productos: {riskGroup.products.slice(0, 2).join(', ')}
                        {riskGroup.products.length > 2
                          ? ` +${riskGroup.products.length - 2} mas`
                          : ''}
                      </span>
                      <span>
                        Fechas: {riskGroup.earliestRequiredDate}
                        {riskGroup.latestRequiredDate !==
                        riskGroup.earliestRequiredDate
                          ? ` a ${riskGroup.latestRequiredDate}`
                          : ''}
                      </span>
                    </div>
                  </article>
                ))}

                {riskGroups.length > visibleRiskGroupLimit ? (
                  <button
                    className="ghost-link risk-toggle"
                    type="button"
                    onClick={() => setShowAllRisks((current) => !current)}
                  >
                    {showAllRisks
                      ? 'Mostrar menos riesgos'
                      : `Mostrar los ${riskGroups.length} grupos de riesgo`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="subpanel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">Salida DataFrame</p>
                <h3>Filas procesadas listas para backend</h3>
              </div>
            </div>

            <div className="dataframe-meta">
              <span>Hoja: {activeSheet?.name}</span>
              <span>
                Claves:{' '}
                {activeSheet?.dataframe.columnKeys.join(', ') || 'Ninguna'}
              </span>
              <span>
                Total de filas: {activeSheet?.dataframe.totalRows ?? 0}
              </span>
            </div>

            <pre className="code-preview">
              <code>{JSON.stringify(dataframePreview, null, 2)}</code>
            </pre>
          </section>
        </section>
      ) : (
        <section className="panel empty-simulation">
          <p className="section-label">Antes de cargar</p>
          <h2>La simulacion se habilita despues de subir la orden de compra</h2>
          <p className="panel-copy">
            La siguiente capa visible sera un tablero en tiempo real con
            ocupacion de camaras, calculo de pallets y contenedores, y un
            calendario que muestra cada necesidad en el tiempo.
          </p>
        </section>
      )}
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
