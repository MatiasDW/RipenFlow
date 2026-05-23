import type { ParsedWorkbook } from '@/lib/purchase-file'

type PlanningImportSummary = {
  id: string
  sourceFileName: string
  totalRows: number
  createdAt: string
}

export type PlanningStateResponse = {
  importCount: number
  latestImport: PlanningImportSummary | null
  workbook: ParsedWorkbook | null
  chamberConfig: {
    chamberCount: number
    modes: Record<string, 'ripening' | 'conservation' | 'occupied'>
  }
}

function buildJsonHeaders() {
  return {
    'content-type': 'application/json',
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null

    throw new Error(payload?.error ?? 'Request failed')
  }

  return (await response.json()) as T
}

export async function fetchPlanningState() {
  const response = await fetch('/api/planning-state', {
    headers: buildJsonHeaders(),
  })

  return parseJsonResponse<PlanningStateResponse>(response)
}

export async function persistPlanningWorkbook(workbook: ParsedWorkbook) {
  const response = await fetch('/api/purchase-orders/imports', {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(workbook),
  })

  return parseJsonResponse<PlanningStateResponse>(response)
}

export async function replacePlanningWorkbook(workbook: ParsedWorkbook) {
  const response = await fetch('/api/planning-state', {
    method: 'PUT',
    headers: buildJsonHeaders(),
    body: JSON.stringify(workbook),
  })

  return parseJsonResponse<PlanningStateResponse>(response)
}

export async function persistChamberConfig(payload: {
  chamberCount: number
  modes: Record<string, 'ripening' | 'conservation' | 'occupied'>
}) {
  const response = await fetch('/api/chamber-config', {
    method: 'PUT',
    headers: buildJsonHeaders(),
    body: JSON.stringify(payload),
  })

  return parseJsonResponse<PlanningStateResponse>(response)
}
