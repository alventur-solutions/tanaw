// The all-areas story: the top-level study areas side by side. Pure functions, rows of
// GET /areas/summary in, strings out. Areas overlap, so nothing here adds one area to another.
import { formatHa, formatMm, formatPhp } from './api'
import type { AreaSummary } from './api'
import { plural, span } from './story'

/** Why a figure is not shown. A missing figure is never written as zero. */
export type Missing = 'not loaded' | 'not linked' | 'no contract cost on record'

export interface Cell {
  value: number | null
  missing: Missing | null
}

export interface Measure {
  key: string
  /** The button label and the column header. The header says when a figure is per hectare. */
  label: string
  /** The phrase after "the highest", for the lede. */
  phrase: string
  format: (value: number) => string
  cell: (row: AreaSummary) => Cell
}

const value = (v: number): Cell => ({ value: v, missing: null })
const missing = (why: Missing): Cell => ({ value: null, missing: why })

const lossCell = (row: AreaSummary, perThousand: boolean): Cell =>
  row.loss_window_ha == null
    ? missing('not loaded')
    : value(perThousand ? (row.loss_window_ha / row.area_ha) * 1000 : row.loss_window_ha)

/** Contract cost of a linked area. Zero contracts is a measured zero; contracts with no cost are not. */
const costCell = (row: AreaSummary, perHa: boolean): Cell => {
  if (!row.projects_linked || row.contracts == null) return missing('not linked')
  if (row.contracts === 0) return value(0)
  if (row.contract_cost_php == null) return missing('no contract cost on record')
  return value(perHa ? row.contract_cost_php / row.area_ha : row.contract_cost_php)
}

const countCell = (count: number | null, linked: boolean): Cell =>
  !linked || count == null ? missing('not linked') : value(count)

const oneDecimal = (v: number) => v.toLocaleString('en-PH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export function measures(from: number, to: number): Measure[] {
  const years = `${from} to ${to}`
  return [
    {
      key: 'loss_per_1000',
      label: `Tree cover loss per 1,000 ha, ${years}`,
      phrase: 'tree cover loss for its size',
      format: (v) => `${oneDecimal(v)} ha per 1,000 ha`,
      cell: (row) => lossCell(row, true),
    },
    {
      key: 'loss',
      label: `Tree cover loss, ${years}`,
      phrase: 'tree cover loss in hectares',
      format: formatHa,
      cell: (row) => lossCell(row, false),
    },
    {
      key: 'rain',
      label: 'Rain per year, complete years',
      phrase: 'mean yearly rainfall',
      format: (v) => `${formatMm(v)} a year`,
      cell: (row) => (row.rain_mean_mm == null ? missing('not loaded') : value(row.rain_mean_mm)),
    },
    {
      key: 'contracts',
      label: `DPWH contracts, ${years}`,
      phrase: 'number of DPWH flood control contracts',
      format: (v) => plural(v, 'contract'),
      cell: (row) => countCell(row.contracts, row.projects_linked),
    },
    {
      key: 'cost',
      label: `Contract cost, ${years}`,
      phrase: 'DPWH flood control contract cost',
      format: formatPhp,
      cell: (row) => costCell(row, false),
    },
    {
      key: 'cost_per_ha',
      label: `Contract cost per ha, ${years}`,
      phrase: 'DPWH flood control contract cost per hectare',
      format: (v) => `${formatPhp(v)} per ha`,
      cell: (row) => costCell(row, true),
    },
    {
      key: 'review',
      label: 'Contracts on a reported-status list',
      phrase: 'number of contracts on a reported-status list',
      format: (v) => plural(v, 'contract'),
      cell: (row) => countCell(row.review_any, row.projects_linked),
    },
  ]
}

export function cellText(measure: Measure, cell: Cell): string {
  return cell.value == null ? (cell.missing ?? 'not loaded') : measure.format(cell.value)
}

/** Rows that hold the figure, highest first. Rows without it are left out, never ranked as zero. */
export function ranked(rows: AreaSummary[], measure: Measure): { row: AreaSummary; value: number }[] {
  return rows
    .map((row) => ({ row, value: measure.cell(row).value }))
    .filter((r): r is { row: AreaSummary; value: number } => r.value !== null)
    .sort((a, b) => b.value - a.value || a.row.name.localeCompare(b.row.name))
}

const name = (row: AreaSummary) => row.name.split(' (')[0]

/** The opening lede: the highest loss for its size and the highest contract cost per hectare. */
export function compareLede(rows: AreaSummary[], from: number, to: number): string {
  const [lossBy, , , , , costBy] = measures(from, to)
  const loss = ranked(rows, lossBy)[0]
  const cost = ranked(rows, costBy)[0]
  const when = span(from, to)
  const opening = `${when[0].toUpperCase()}${when.slice(1)}`
  const land = loss
    ? `${opening}, ${name(loss.row)} recorded the most tree cover loss for its size, about ${lossBy.format(loss.value)}.`
    : `Tree cover loss ${when} is not loaded for any study area yet.`
  if (!cost || cost.value === 0) {
    return `${land} No study area has a DPWH contract cost on record for these years.`
  }
  const who = loss && cost.row.area_id === loss.row.area_id ? 'the same area' : name(cost.row)
  return `${land} In the same period, ${who} had the highest DPWH flood control contract cost per hectare, about ${costBy.format(cost.value)}.`
}

/** The line under the bar chart. It follows the measure the reader picks. */
export function measureLine(rows: AreaSummary[], measure: Measure): string {
  const shown = ranked(rows, measure)
  if (shown.length === 0) return 'This figure is not loaded for any study area yet.'
  const top = shown[0]
  const rest = rows.length - shown.length
  return (
    `${name(top.row)} has the highest ${measure.phrase}: ${measure.format(top.value)}.` +
    (rest === 0
      ? ''
      : ` ${plural(rest, 'area')} ${rest === 1 ? 'has' : 'have'} no value for it and ${rest === 1 ? 'is' : 'are'} left out of the bars.`)
  )
}

export function measureAlt(rows: AreaSummary[], measure: Measure): string {
  const shown = ranked(rows, measure)
  if (shown.length === 0) return `Bar list of ${measure.label.toLowerCase()} per study area. No values yet.`
  return `Bar list of ${measure.label.toLowerCase()} per study area, highest first. ${measureLine(rows, measure)}`
}

/** The overlap caveat. The named pairs are printed only when both areas are in the rows. */
export function overlapNote(rows: AreaSummary[]): string {
  const has = (id: string) => rows.some((r) => r.area_id === id)
  const pairs = [
    has('angat-river-basin') && has('pampanga-river-basin') && 'Angat and Pampanga overlap',
    has('quezon-city') &&
      has('antipolo-rodriguez-uplands') &&
      has('pasig-marikina-tullahan') &&
      'Quezon City and the Antipolo-Rodriguez uplands overlap Pasig-Marikina-Tullahan',
  ].filter(Boolean)
  return (
    'Study areas overlap' +
    (pairs.length > 0 ? ` (${pairs.join('; ')})` : '') +
    '. A contract and a hectare of loss count in every area they fall in, so rows must not be added together.'
  )
}

/** Which areas have figures that are not loaded or not linked. Null when every area has both. */
export function linkedLine(rows: AreaSummary[]): string | null {
  const unlinked = rows.filter((r) => !r.projects_linked).length
  const unloaded = rows.filter((r) => !r.metrics_loaded).length
  const parts = [
    unlinked > 0 && `DPWH contracts are not linked to ${plural(unlinked, 'area')} yet`,
    unloaded > 0 && `satellite metrics are not loaded for ${plural(unloaded, 'area')} yet`,
  ].filter(Boolean)
  if (parts.length === 0) return null
  const text = parts.join(', and ')
  return `${text[0].toUpperCase()}${text.slice(1)}. Those figures read "not linked" or "not loaded", which is not zero.`
}
