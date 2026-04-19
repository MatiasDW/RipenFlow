import { useQuery } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { startTransition, useId, useRef, useState } from 'react'

import {
  formatBytes,
  type ParsedWorkbook,
  parsePurchaseFile,
} from '@/lib/purchase-file'
import { loadStackCards } from '@/lib/stack-data'

const expectedFields = [
  'required_date',
  'quantity',
  'price',
  'amount',
  'product',
]

const planningNotes = [
  'El archivo Excel o CSV es la entrada inicial de la demanda.',
  'La fecha objetivo vive en la demanda, no en product.',
  'La optimizacion principal es economica, no solo operativa.',
  'El planeamiento real tiene que bajar a lotes y camaras.',
]

const targetTables = [
  'purchase_order_imports',
  'purchase_order_import_rows',
  'orders',
  'order_products',
  'batches',
  'ripening_runs',
]

function RootLayout() {
  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-topline">
          <p className="eyebrow">RipenFlow</p>
          <Link className="ghost-link" to="/">
            Intake
          </Link>
        </div>

        <div className="hero-copy">
          <div>
            <h1>Ordenes de compra</h1>
            <p>
              Pantalla inicial para cargar Excel o CSV, leer la demanda y
              convertir cada fila en una estructura tipo DataFrame lista para
              backend.
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
  const stackQuery = useQuery({
    queryKey: ['stack-cards'],
    queryFn: loadStackCards,
  })
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isReadingFile, setIsReadingFile] = useState(false)
  const [parsedWorkbook, setParsedWorkbook] = useState<ParsedWorkbook | null>(
    null,
  )
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)

  const activeSheet = parsedWorkbook?.sheets[activeSheetIndex] ?? null
  const selectedFileName = parsedWorkbook?.fileName ?? 'Ningun archivo cargado'
  const dataframePreview =
    activeSheet?.dataframe.rows.slice(0, 3).map((row, index) => ({
      _row_number: index + 2,
      ...row,
    })) ?? []

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
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No pudimos leer el archivo seleccionado'

      setParsedWorkbook(null)
      setErrorMessage(message)
    } finally {
      setIsReadingFile(false)
    }
  }

  return (
    <div className="workspace">
      <section className="panel upload-panel">
        <div className="panel-header upload-header">
          <div>
            <p className="section-label">Carga</p>
            <h2>Sube una orden de compra</h2>
            <p className="panel-copy">
              El parser toma la primera fila como encabezado, conserva los
              valores como texto y arma filas indexadas por titulo de columna.
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
              onChange={(event) =>
                handleFileSelection(event.target.files?.[0] ?? null)
              }
            />

            <p className="section-label">Archivo fuente</p>
            <h3>Excel o CSV</h3>
            <p className="panel-copy">
              Usa este formulario para seleccionar el archivo recibido del
              cliente y revisar la demanda antes de subirla a storage y
              normalizarla en base de datos.
            </p>

            <div className="upload-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                Seleccionar archivo
              </button>
              <div className="selected-file">{selectedFileName}</div>
            </div>

            <div className="field-strip">
              {expectedFields.map((field) => (
                <span key={field} className="field-chip">
                  {field}
                </span>
              ))}
            </div>
          </div>

          <aside className="brief-column">
            <div className="note-card">
              <p className="section-label">Brief de dominio</p>
              <ul className="bullet-list">
                {planningNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>

            <div className="note-card">
              <p className="section-label">Siguiente capa</p>
              <ul className="bullet-list">
                {targetTables.map((tableName) => (
                  <li key={tableName}>{tableName}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        {errorMessage ? (
          <div className="alert alert-error">{errorMessage}</div>
        ) : null}

        {parsedWorkbook ? (
          <>
            <div className="summary-grid">
              <article className="summary-card">
                <p className="section-label">Archivo</p>
                <strong>{parsedWorkbook.fileName}</strong>
                <span>{formatBytes(parsedWorkbook.size)}</span>
              </article>
              <article className="summary-card">
                <p className="section-label">Formato</p>
                <strong>{parsedWorkbook.extension.toUpperCase()}</strong>
                <span>{parsedWorkbook.sheets.length} hoja(s)</span>
              </article>
              <article className="summary-card">
                <p className="section-label">Filas parseadas</p>
                <strong>
                  {parsedWorkbook.sheets.reduce(
                    (totalRows, sheet) => totalRows + sheet.totalRows,
                    0,
                  )}
                </strong>
                <span>Sin encabezados</span>
              </article>
            </div>

            <div className="alert alert-warning">
              <ul className="warning-list">
                {parsedWorkbook.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>

            <div className="sheet-tabs">
              {parsedWorkbook.sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  className={
                    index === activeSheetIndex ? 'tab is-active' : 'tab'
                  }
                  type="button"
                  onClick={() => setActiveSheetIndex(index)}
                >
                  {sheet.name}
                </button>
              ))}
            </div>

            {activeSheet ? (
              <section className="preview-panel">
                <div className="preview-header">
                  <div>
                    <p className="section-label">Vista previa</p>
                    <h3>{activeSheet.name}</h3>
                  </div>
                  <div className="preview-metrics">
                    <span>{activeSheet.totalRows} filas</span>
                    <span>{activeSheet.totalColumns} columnas</span>
                    <span>{activeSheet.dataframe.rows.length} rows</span>
                  </div>
                </div>

                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>
                        <th>Fila</th>
                        {activeSheet.columns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSheet.previewRows.length > 0 ? (
                        activeSheet.previewRows.map((row) => (
                          <tr key={`${activeSheet.name}-${row.rowNumber}`}>
                            <td>{row.rowNumber}</td>
                            {activeSheet.columns.map((column, columnIndex) => (
                              <td key={`${row.rowNumber}-${column.key}`}>
                                {row.cells[columnIndex] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={activeSheet.columns.length + 1}>
                            La hoja no trae filas de datos despues del
                            encabezado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="dataframe-block">
                  <div className="dataframe-copy">
                    <div>
                      <p className="section-label">DataFrame</p>
                      <h3>Filas indexadas por titulo</h3>
                    </div>
                    <p>
                      Cada fila queda convertida a un objeto donde cada clave se
                      deriva del encabezado normalizado. Esa es la base para
                      insertar o mapear columnas en backend.
                    </p>
                  </div>

                  <div className="dataframe-meta">
                    <span>
                      Column keys: {activeSheet.dataframe.columnKeys.join(', ')}
                    </span>
                  </div>

                  <pre className="code-preview">
                    <code>{JSON.stringify(dataframePreview, null, 2)}</code>
                  </pre>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <p className="section-label">Sin archivo</p>
            <h3>Selecciona un Excel o CSV para empezar</h3>
            <p>
              Cuando cargues la OC vas a ver el preview tabular y el DataFrame
              generado a partir de los titulos de columna.
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="section-label">Base tecnica</p>
            <h2>Stack disponible para persistencia y simulacion</h2>
          </div>
          <span className="pill">
            {stackQuery.isSuccess ? 'Operativa' : 'Cargando'}
          </span>
        </div>

        <div className="grid">
          {stackQuery.data?.map((card) => (
            <article key={card.title} className="card">
              <p className="card-kicker">{card.title}</p>
              <h3>{card.summary}</h3>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      </section>
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
