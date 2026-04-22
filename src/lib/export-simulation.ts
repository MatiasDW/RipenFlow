import ExcelJS from 'exceljs'

import type { ParsedSheet } from '@/lib/purchase-file'
import type {
  ChamberFill,
  SimulationMetric,
  SimulationSummary,
  TimelineOrder,
} from '@/lib/simulation-lab'

type ExportSimulationWorkbookOptions = {
  activeSheet: ParsedSheet
  chamberFill: ChamberFill[]
  fileName: string
  metrics: SimulationMetric[]
  scenarioDetail: string
  scenarioLabel: string
  summary: SimulationSummary
  timelineOrders: TimelineOrder[]
}

const palette = {
  blueBg: 'D8EAFE',
  blueBorder: '7EA9E6',
  blueText: '173A63',
  greenBg: 'DFF3E4',
  greenBorder: '6FB07F',
  greenText: '194D2D',
  redBg: 'FBD9D9',
  redBorder: 'D95B5B',
  redText: '6B1B1B',
  amberBg: 'F7E8C7',
  amberBorder: 'C9982E',
  amberText: '6A4C0E',
  slateBg: 'EEF2F6',
  slateBorder: 'B8C2CC',
  slateText: '314252',
  headerBg: '1D232C',
  headerText: 'F7F8FA',
  white: 'FFFFFF',
} as const

const thinBorder = {
  top: { style: 'thin', color: { argb: `FF${palette.slateBorder}` } },
  left: { style: 'thin', color: { argb: `FF${palette.slateBorder}` } },
  bottom: { style: 'thin', color: { argb: `FF${palette.slateBorder}` } },
  right: { style: 'thin', color: { argb: `FF${palette.slateBorder}` } },
} as const

function applyFill(cell: ExcelJS.Cell, bg: string, fg: string, bold = false) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${bg}` },
  }
  cell.font = {
    bold,
    color: { argb: `FF${fg}` },
  }
  cell.alignment = {
    vertical: 'middle',
    horizontal: 'center',
  }
  cell.border = thinBorder
}

function applyBody(cell: ExcelJS.Cell) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${palette.white}` },
  }
  cell.font = {
    color: { argb: `FF${palette.slateText}` },
  }
  cell.border = thinBorder
  cell.alignment = {
    vertical: 'middle',
    horizontal: 'left',
  }
}

function applyHeader(cell: ExcelJS.Cell) {
  applyFill(cell, palette.headerBg, palette.headerText, true)
}

function applyTitle(cell: ExcelJS.Cell) {
  applyFill(cell, palette.slateBg, palette.slateText, true)
  cell.alignment = {
    vertical: 'middle',
    horizontal: 'left',
  }
}

function applyStatusStyle(
  cell: ExcelJS.Cell,
  status: TimelineOrder['scenarioStatus'] | 'healthy' | 'issue' | 'due',
) {
  switch (status) {
    case 'ready':
      applyFill(cell, palette.blueBg, palette.blueText, true)
      break
    case 'in_ripening':
      applyFill(cell, palette.greenBg, palette.greenText, true)
      break
    case 'late_risk':
    case 'issue':
      applyFill(cell, palette.redBg, palette.redText, true)
      break
    case 'due':
      applyFill(cell, palette.amberBg, palette.amberText, true)
      break
    default:
      applyFill(cell, palette.greenBg, palette.greenText, true)
      break
  }
}

function sanitizeFileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-')
}

function formatScenarioStatus(status: TimelineOrder['scenarioStatus']) {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'in_ripening':
      return 'In ripening'
    case 'late_risk':
      return 'Late risk'
    default:
      return 'Queued'
  }
}

function setColumns(worksheet: ExcelJS.Worksheet, widths: number[]) {
  worksheet.columns = widths.map((width) => ({ width }))
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  options: ExportSimulationWorkbookOptions,
) {
  const worksheet = workbook.addWorksheet('Executive Summary')
  setColumns(worksheet, [24, 20, 58])

  worksheet.mergeCells('A1:C1')
  applyTitle(worksheet.getCell('A1'))
  worksheet.getCell('A1').value = 'RipenFlow Simulation Export'

  const lateRiskOrders = options.summary.orders.filter(
    (order) => order.scenarioStatus === 'late_risk',
  ).length

  const rows = [
    ['Source file', options.fileName],
    ['Source sheet', options.activeSheet.name],
    ['Scenario', options.scenarioLabel],
    ['Scenario detail', options.scenarioDetail],
    [],
    ['Headline metrics', '', ''],
    ['Total boxes', options.summary.totalBoxes, ''],
    ['Total pallets', options.summary.totalPallets, ''],
    ['Total containers', options.summary.totalContainers, ''],
    ['Total revenue', options.summary.totalRevenue, ''],
    ['Late-risk orders', lateRiskOrders, ''],
    [],
    ['Visible dashboard metrics', '', ''],
    ['Metric', 'Value', 'Hint'],
    ...options.metrics.map((metric) => [
      metric.label,
      metric.value,
      metric.hint,
    ]),
    [],
    ['Model assumptions', '', ''],
    ['Assumption', '', ''],
    ...options.summary.assumptions.map((assumption) => [assumption, '', '']),
  ]

  rows.forEach((row) => {
    worksheet.addRow(row)
  })

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)

    row.eachCell((cell) => applyBody(cell))

    if (
      row.getCell(1).value === 'Headline metrics' ||
      row.getCell(1).value === 'Visible dashboard metrics' ||
      row.getCell(1).value === 'Model assumptions'
    ) {
      applyTitle(row.getCell(1))
    }

    if (
      row.getCell(1).value === 'Metric' ||
      row.getCell(1).value === 'Assumption'
    ) {
      row.eachCell((cell) => applyHeader(cell))
    }
  }
}

function addCalendarSheet(
  workbook: ExcelJS.Workbook,
  timelineOrders: TimelineOrder[],
  summary: SimulationSummary,
) {
  const worksheet = workbook.addWorksheet('Order Calendar')
  setColumns(worksheet, [
    14,
    26,
    14,
    14,
    14,
    14,
    ...summary.dateRange.map(() => 13),
  ])
  worksheet.views = [{ state: 'frozen', xSplit: 6, ySplit: 4 }]

  worksheet.mergeCells(1, 1, 1, 6 + summary.dateRange.length)
  worksheet.getCell('A1').value = 'Order Calendar'
  applyTitle(worksheet.getCell('A1'))

  worksheet.addRow(['Legend', 'Ready', 'In ripening', 'Late risk', 'Due date'])
  applyHeader(worksheet.getCell('A2'))
  applyStatusStyle(worksheet.getCell('B2'), 'ready')
  applyStatusStyle(worksheet.getCell('C2'), 'in_ripening')
  applyStatusStyle(worksheet.getCell('D2'), 'late_risk')
  applyStatusStyle(worksheet.getCell('E2'), 'due')

  worksheet.addRow([
    'Color key',
    'ready ahora va en azul',
    'in_ripening queda en verde',
    'late-risk sigue en rojo',
    'la fecha due va en dorado',
  ])
  for (let columnIndex = 1; columnIndex <= 5; columnIndex += 1) {
    applyBody(worksheet.getRow(3).getCell(columnIndex))
  }

  const header = [
    'Order ID',
    'Product',
    'Chamber',
    'Status',
    'Required Date',
    'Start Date',
    ...summary.dateRange,
  ]
  worksheet.addRow(header)
  worksheet.getRow(4).eachCell((cell) => applyHeader(cell))

  timelineOrders.forEach((order) => {
    const row = worksheet.addRow([
      order.id,
      order.product,
      order.chamberName,
      formatScenarioStatus(order.scenarioStatus),
      order.requiredDate,
      order.startDate,
      ...summary.dateRange.map((date) => {
        if (date === order.requiredDate) {
          return 'Due'
        }

        if (date === order.startDate) {
          return 'Start'
        }

        if (date > order.startDate && date < order.requiredDate) {
          return 'Ripening'
        }

        return ''
      }),
    ])

    row.eachCell((cell, columnNumber) => {
      applyBody(cell)

      if (columnNumber === 4) {
        applyStatusStyle(cell, order.scenarioStatus)
      }

      if (columnNumber >= 7 && cell.value) {
        applyStatusStyle(
          cell,
          cell.value === 'Due' ? 'due' : order.scenarioStatus,
        )
      }
    })
  })
}

function addOrdersSheet(
  workbook: ExcelJS.Workbook,
  summary: SimulationSummary,
) {
  const worksheet = workbook.addWorksheet('Order Results')
  setColumns(worksheet, [14, 26, 14, 14, 14, 12, 12, 12, 12, 14, 14, 56])

  worksheet.addRow([
    'Order ID',
    'Product',
    'Required Date',
    'Start Date',
    'Status',
    'Boxes',
    'Pallets',
    'Containers',
    'Price',
    'Amount',
    'Chamber',
    'Risk Note',
  ])
  worksheet.getRow(1).eachCell((cell) => applyHeader(cell))

  summary.orders.forEach((order) => {
    const row = worksheet.addRow([
      order.id,
      order.product,
      order.requiredDate,
      order.startDate,
      formatScenarioStatus(order.scenarioStatus),
      order.quantityBoxes,
      order.pallets,
      order.containers,
      order.price,
      order.amount,
      order.chamberName,
      order.riskNote ?? '',
    ])

    row.eachCell((cell, columnNumber) => {
      applyBody(cell)

      if (columnNumber === 5) {
        applyStatusStyle(cell, order.scenarioStatus)
      }
    })
  })
}

function addChamberSheet(
  workbook: ExcelJS.Workbook,
  chamberFill: ChamberFill[],
) {
  const worksheet = workbook.addWorksheet('Chamber Utilization')
  setColumns(worksheet, [18, 14, 14, 16, 14, 54])

  worksheet.mergeCells('A1:F1')
  worksheet.getCell('A1').value = 'Chamber Utilization'
  applyTitle(worksheet.getCell('A1'))

  worksheet.addRow(['Legend', 'Healthy', 'Issue'])
  applyHeader(worksheet.getCell('A2'))
  applyStatusStyle(worksheet.getCell('B2'), 'healthy')
  applyStatusStyle(worksheet.getCell('C2'), 'issue')

  worksheet.addRow([
    'Chamber',
    'Occupancy %',
    'Active Orders',
    'Late-risk Orders',
    'Status',
    'Issue Note',
  ])
  worksheet.getRow(3).eachCell((cell) => applyHeader(cell))

  chamberFill.forEach((chamber) => {
    const row = worksheet.addRow([
      chamber.name,
      chamber.occupancy,
      chamber.activeOrders,
      chamber.lateRiskOrders,
      chamber.status === 'issue' ? 'Issue' : 'Healthy',
      chamber.issueNote ?? '',
    ])

    row.eachCell((cell) => applyBody(cell))
    applyStatusStyle(row.getCell(5), chamber.status)
    applyStatusStyle(
      row.getCell(2),
      chamber.status === 'issue' ? 'issue' : 'healthy',
    )
  })
}

function addRiskSheet(workbook: ExcelJS.Workbook, summary: SimulationSummary) {
  const worksheet = workbook.addWorksheet('Risk Review')
  setColumns(worksheet, [14, 24, 14, 14, 14, 12, 12, 56])

  worksheet.mergeCells('A1:H1')
  worksheet.getCell('A1').value = 'Risk Review'
  applyTitle(worksheet.getCell('A1'))

  worksheet.addRow([
    'Order ID',
    'Product',
    'Chamber',
    'Required Date',
    'Start Date',
    'Boxes',
    'Pallets',
    'Risk Reason',
  ])
  worksheet.getRow(2).eachCell((cell) => applyHeader(cell))

  summary.orders
    .filter((order) => order.scenarioStatus === 'late_risk')
    .forEach((order) => {
      const row = worksheet.addRow([
        order.id,
        order.product,
        order.chamberName,
        order.requiredDate,
        order.startDate,
        order.quantityBoxes,
        order.pallets,
        order.riskNote ?? '',
      ])

      row.eachCell((cell) => applyStatusStyle(cell, 'late_risk'))
    })
}

function downloadWorkbook(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function exportSimulationWorkbook(
  options: ExportSimulationWorkbookOptions,
) {
  const workbook = new ExcelJS.Workbook()

  workbook.creator = 'RipenFlow'
  workbook.created = new Date()
  workbook.modified = new Date()

  addSummarySheet(workbook, options)
  addCalendarSheet(workbook, options.timelineOrders, options.summary)
  addOrdersSheet(workbook, options.summary)
  addChamberSheet(workbook, options.chamberFill)
  addRiskSheet(workbook, options.summary)

  const exportFileName = `${sanitizeFileBaseName(options.fileName)}-${options.scenarioLabel.toLowerCase().replaceAll(/\s+/g, '-')}-simulation.xlsx`
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer

  downloadWorkbook(buffer, exportFileName)
}
