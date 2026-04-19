import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { startTransition, useEffect, useId, useRef, useState } from 'react'

import {
  formatBytes,
  type ParsedWorkbook,
  parsePurchaseFile,
} from '@/lib/purchase-file'
import {
  buildChamberFill,
  buildSimulationMetrics,
  buildSimulationSummary,
  buildTimelineOrders,
  getSimulationStageState,
} from '@/lib/simulation-lab'

const expectedFields = [
  'required_date',
  'quantity',
  'price',
  'amount',
  'product',
]

const scenarioOptions = [
  {
    id: 'balanced',
    label: 'Balanced plan',
    detail: 'Mix of due-date protection and chamber efficiency.',
  },
  {
    id: 'margin',
    label: 'Margin shield',
    detail: 'Protects value loss and avoids unnecessary ripening.',
  },
  {
    id: 'service',
    label: 'Service first',
    detail: 'Pushes fulfillment even if chamber cost increases.',
  },
] as const

function RootLayout() {
  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-topline">
          <p className="eyebrow">RipenFlow</p>
          <Link className="ghost-link" to="/">
            Simulation Lab
          </Link>
        </div>

        <div className="hero-copy">
          <div>
            <h1>Demand to ripening simulation</h1>
            <p>
              Upload a purchase-order file, generate a live planning scenario
              and show the client how containers, pallets, chambers and due
              dates evolve in real time.
            </p>
          </div>
        </div>
      </header>

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(
    null,
  )
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [activeScenario, setActiveScenario] = useState('balanced')
  const [simulationProgress, setSimulationProgress] = useState(0)
  const [simulationRunId, setSimulationRunId] = useState(0)

  const activeSheet = parsedWorkbook?.sheets[activeSheetIndex] ?? null
  const simulationSummary = activeSheet
    ? buildSimulationSummary(activeSheet)
    : null
  const selectedFileName = parsedWorkbook?.fileName ?? 'No file selected'
  const timelineOrders = simulationSummary
    ? buildTimelineOrders(simulationSummary)
    : []
  const simulationStages = getSimulationStageState(simulationProgress)
  const chamberFill = simulationSummary
    ? buildChamberFill(simulationSummary, simulationProgress)
    : []
  const simulationMetrics = simulationSummary
    ? buildSimulationMetrics(simulationSummary, simulationProgress)
    : []
  const dataframePreview =
    activeSheet?.dataframe.rows.slice(0, 4).map((row, index) => ({
      _row_number: index + 2,
      ...row,
    })) ?? []

  useEffect(() => {
    if (!activeSheet) {
      setSimulationProgress(0)
      return
    }

    const velocityByScenario =
      activeScenario === 'service'
        ? 0.042
        : activeScenario === 'margin'
          ? 0.028
          : 0.035
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
    }, 180)

    return () => window.clearInterval(timer)
  }, [activeSheet, activeScenario, simulationRunId])

  async function handleFileSelection(file: File | null) {
    if (!file) {
      return
    }

    setIsReadingFile(true)
    setErrorMessage(null)

    try {
      const nextWorkbook = await parsePurchaseFile(file)

      startTransition(() => {
        setParsedWorkbook(nextWorkbook)
        setActiveSheetIndex(0)
        setSimulationRunId((current) => current + 1)
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'We could not read the selected file.'

      setParsedWorkbook(null)
      setErrorMessage(message)
    } finally {
      setIsReadingFile(false)
    }
  }

  return (
    <div className="workspace">
      <section className="panel marquee-panel">
        <div className="marquee-grid">
          <div className="marquee-card">
            <p className="section-label">What the client sees</p>
            <h2>Upload demand, watch the plan move</h2>
            <p className="panel-copy">
              The dashboard turns a spreadsheet into a live simulation with
              boxes, pallets, containers, chamber load and a date-based order
              calendar.
            </p>
          </div>

          <div className="marquee-card compact">
            <p className="section-label">Expected fields</p>
            <div className="field-strip">
              {expectedFields.map((field) => (
                <span key={field} className="field-chip">
                  {field}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel upload-panel">
        <div className="panel-header upload-header">
          <div>
            <p className="section-label">File intake</p>
            <h2>Purchase order upload</h2>
            <p className="panel-copy">
              Load `.csv`, `.xls` or `.xlsx`. We interpret the first row as
              headers and generate a client-facing planning view immediately.
            </p>
          </div>
          <span className="pill">{isReadingFile ? 'Reading' : 'Ready'}</span>
        </div>

        <div className="upload-layout">
          <div className="uploader-card">
            <input
              ref={inputRef}
              id={inputId}
              className="file-input"
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={(event) =>
                handleFileSelection(event.target.files?.[0] ?? null)
              }
            />

            <p className="section-label">Source file</p>
            <h3>Client order intake</h3>
            <p className="panel-copy">
              Use the visible picker below. Once the file is parsed, the
              simulation lab updates automatically.
            </p>

            <div className="upload-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                Select purchase order file
              </button>
              <div className="selected-file">{selectedFileName}</div>
            </div>

            <div className="upload-hint">
              Visible assumptions: quantity is treated as boxes, then converted
              into pallets and containers for the simulation view.
            </div>
          </div>

          <aside className="brief-column">
            <div className="note-card">
              <p className="section-label">Simulation framing</p>
              <ul className="bullet-list">
                <li>Economic performance is the main objective.</li>
                <li>Demand dates belong to orders, not products.</li>
                <li>Planning must happen on batches and chambers.</li>
                <li>Late, surplus and over-ripening risk stay visible.</li>
              </ul>
            </div>

            <div className="note-card">
              <p className="section-label">Animation hooks</p>
              <ul className="bullet-list">
                <li>Live stage progression while the run advances.</li>
                <li>Container and chamber fill bars update over time.</li>
                <li>Calendar blocks show the time frame of each order.</li>
              </ul>
            </div>
          </aside>
        </div>

        {errorMessage ? (
          <div className="alert alert-error">{errorMessage}</div>
        ) : null}
      </section>

      {simulationSummary ? (
        <section className="panel simulation-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Simulation Lab</p>
              <h2>Live planning scenario</h2>
              <p className="panel-copy">
                Run a client-facing scenario with visible movement, operational
                load and due-date exposure.
              </p>
            </div>

            <button
              className="ghost-link"
              type="button"
              onClick={() => setSimulationRunId((current) => current + 1)}
            >
              Rerun simulation
            </button>
          </div>

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

          <div className="stage-rail">
            {simulationStages.map((stage) => (
              <article
                key={stage.id}
                className={`stage-card stage-${stage.status}`}
              >
                <div className="stage-topline">
                  <p className="section-label">{stage.label}</p>
                  <span>{Math.round(stage.progress * 100)}%</span>
                </div>
                <div className="stage-progress">
                  <span style={{ width: `${stage.progress * 100}%` }} />
                </div>
                <p>{stage.note}</p>
              </article>
            ))}
          </div>

          <div className="metric-grid">
            {simulationMetrics.map((metric) => (
              <article
                key={metric.label}
                className={`metric-card ${metric.tone}`}
              >
                <p className="section-label">{metric.label}</p>
                <strong>{metric.value}</strong>
                <span>{metric.hint}</span>
              </article>
            ))}
          </div>

          <div className="ops-grid">
            <section className="subpanel">
              <div className="subpanel-head">
                <div>
                  <p className="section-label">Chamber load</p>
                  <h3>Containers and pallets in motion</h3>
                </div>
                <span>{Math.round(simulationProgress * 100)}% complete</span>
              </div>

              <div className="chamber-list">
                {chamberFill.map((chamber) => (
                  <article key={chamber.name} className="chamber-card">
                    <div className="chamber-copy">
                      <strong>{chamber.name}</strong>
                      <span>{chamber.activeOrders} active order(s)</span>
                    </div>
                    <div className="fill-track">
                      <span
                        className="fill-bar"
                        style={{ width: `${chamber.occupancy}%` }}
                      />
                    </div>
                    <div className="fill-meta">
                      <span>{chamber.occupancy}% occupied</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="subpanel">
              <div className="subpanel-head">
                <div>
                  <p className="section-label">Demand snapshot</p>
                  <h3>Pallets, boxes and containers</h3>
                </div>
              </div>

              <div className="demand-stack">
                <article className="demand-card">
                  <strong>{simulationSummary.totalBoxes}</strong>
                  <span>Boxes required</span>
                </article>
                <article className="demand-card">
                  <strong>{simulationSummary.totalPallets}</strong>
                  <span>Pallets estimated</span>
                </article>
                <article className="demand-card">
                  <strong>{simulationSummary.totalContainers}</strong>
                  <span>Containers filling</span>
                </article>
                <article className="demand-card">
                  <strong>{formatBytes(parsedWorkbook?.size ?? 0)}</strong>
                  <span>Uploaded file size</span>
                </article>
              </div>
            </section>
          </div>

          <section className="subpanel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">Calendar view</p>
                <h3>Order time frame by required date</h3>
              </div>
              <span>{timelineOrders.length} orders</span>
            </div>

            <div className="calendar-shell">
              <div
                className="calendar-grid calendar-header"
                style={{
                  gridTemplateColumns: `220px repeat(${simulationSummary.dateRange.length}, minmax(90px, 1fr))`,
                }}
              >
                <div className="calendar-cell calendar-label">Order</div>
                {simulationSummary.dateRange.map((date) => (
                  <div key={date} className="calendar-cell">
                    {date.slice(5)}
                  </div>
                ))}
              </div>

              <div className="calendar-body">
                {timelineOrders.map((order) => (
                  <div
                    key={order.id}
                    className="calendar-grid calendar-row"
                    style={{
                      gridTemplateColumns: `220px repeat(${simulationSummary.dateRange.length}, minmax(90px, 1fr))`,
                    }}
                  >
                    <div className="calendar-cell calendar-order">
                      <strong>{order.product}</strong>
                      <span>
                        {order.quantityBoxes} boxes · {order.pallets} pallets
                      </span>
                    </div>

                    {simulationSummary.dateRange.map((date) => (
                      <div
                        key={`${order.id}-${date}`}
                        className="calendar-slot"
                      />
                    ))}

                    <div
                      className={`order-bar order-${order.scenarioStatus}`}
                      style={{
                        gridColumn: `${order.startIndex + 2} / span ${order.span}`,
                        opacity: 0.35 + simulationProgress * 0.65,
                        transform: `scaleX(${Math.max(simulationProgress, 0.12)})`,
                      }}
                    >
                      <span>{order.chamberName}</span>
                      <strong>{order.requiredDate}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="subpanel">
            <div className="subpanel-head">
              <div>
                <p className="section-label">DataFrame output</p>
                <h3>Parsed rows ready for backend</h3>
              </div>
            </div>

            <div className="dataframe-meta">
              <span>Sheet: {activeSheet?.name}</span>
              <span>
                Keys: {activeSheet?.dataframe.columnKeys.join(', ') || 'None'}
              </span>
            </div>

            <pre className="code-preview">
              <code>{JSON.stringify(dataframePreview, null, 2)}</code>
            </pre>
          </section>
        </section>
      ) : (
        <section className="panel empty-simulation">
          <p className="section-label">Before upload</p>
          <h2>
            Simulation views will unlock after the purchase order is loaded
          </h2>
          <p className="panel-copy">
            The next visible layer will be a real-time scenario board, chamber
            fill, pallet and container math, plus a calendar showing each order
            over time.
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
