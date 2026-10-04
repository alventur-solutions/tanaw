// The all-areas story, shown under the intro when no area is selected. One beat: the areas side
// by side, a measure picker that redraws the bars and the line, and a sortable table.
import { useMemo, useState } from 'react'
import { formatHa, regionOf } from './api'
import type { AreaSummary, Summary } from './api'
import {
  cellText,
  compareLede,
  linkedLine,
  measureAlt,
  measureLine,
  measures,
  overlapNote,
  ranked,
} from './compare'
import type { Measure } from './compare'
import { readParam, writeParams } from './urlState'

interface Props {
  summary: Summary | null
  // True when GET /areas/summary did not answer.
  failed: boolean
  onSelect: (areaId: string) => void
  onPreview: (areaId: string) => void
}

type SortKey = 'name' | 'region' | 'area_ha' | string

// Defaults are left out of the link. The keys of the measures do not depend on the years.
const MEASURE_KEYS = measures(0, 0).map((m) => m.key)
const DEFAULT_MEASURE = 'loss_per_1000'
const SORT_KEYS = ['name', 'region', 'area_ha', ...MEASURE_KEYS]
const DEFAULT_SORT = { key: 'loss_per_1000', down: true }

function readSort(): { key: SortKey; down: boolean } {
  const [key, dir] = (readParam('sort') ?? '').split(':')
  if (!SORT_KEYS.includes(key) || (dir !== 'asc' && dir !== 'desc')) return DEFAULT_SORT
  return { key, down: dir === 'desc' }
}

const shortName = (row: AreaSummary) => row.name.split(' (')[0]

function Bars({ rows, measure, onSelect, onPreview }: { rows: AreaSummary[]; measure: Measure } & Pick<Props, 'onSelect' | 'onPreview'>) {
  const shown = ranked(rows, measure)
  const max = Math.max(...shown.map((r) => r.value), 0)
  const absent = rows.filter((row) => measure.cell(row).value === null)
  return (
    <ul className="category-bars compare-bars" aria-label={measureAlt(rows, measure)}>
      {shown.map(({ row, value }) => (
        <li key={row.area_id}>
          <button
            className="compare-row"
            onClick={() => onSelect(row.area_id)}
            onMouseEnter={() => onPreview(row.area_id)}
          >
            <span className="category-name">{shortName(row)}</span>
            <span className="category-track">
              {value > 0 && max > 0 && (
                <span className="category-fill" style={{ width: `${(value / max) * 100}%` }} />
              )}
            </span>
            <span className="category-value">{measure.format(value)}</span>
          </button>
        </li>
      ))}
      {absent.map((row) => (
        <li key={row.area_id}>
          <button
            className="compare-row"
            onClick={() => onSelect(row.area_id)}
            onMouseEnter={() => onPreview(row.area_id)}
          >
            <span className="category-name">{shortName(row)}</span>
            <span className="category-track" />
            <span className="category-value">{cellText(measure, measure.cell(row))}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function AllAreas({ summary, failed, onSelect, onPreview }: Props) {
  const list = useMemo(
    () => (summary ? measures(summary.min_year, summary.max_year) : []),
    [summary],
  )
  const [pick, setPickState] = useState(() => {
    const value = readParam('measure')
    return value !== null && MEASURE_KEYS.includes(value) ? value : DEFAULT_MEASURE
  })
  const [sort, setSortState] = useState(readSort)
  const setPick = (key: string) => {
    setPickState(key)
    writeParams({ measure: key === DEFAULT_MEASURE ? null : key })
  }
  const setSort = (next: { key: SortKey; down: boolean }) => {
    setSortState(next)
    const same = next.key === DEFAULT_SORT.key && next.down === DEFAULT_SORT.down
    writeParams({ sort: same ? null : `${next.key}:${next.down ? 'desc' : 'asc'}` })
  }

  if (failed) {
    return (
      <section className="beat compare">
        <p className="empty">
          The comparison of all study areas did not load. The API did not answer for it, so no
          figure is shown.
        </p>
      </section>
    )
  }
  if (!summary) {
    return (
      <section className="beat compare">
        <p className="empty">Loading the comparison of all study areas.</p>
      </section>
    )
  }

  const { rows, min_year, max_year } = summary
  const measure = list.find((m) => m.key === pick) ?? list[0]
  const sortValue = (row: AreaSummary): string | number | null => {
    if (sort.key === 'name') return shortName(row)
    if (sort.key === 'region') return regionOf(row.area_id)
    if (sort.key === 'area_ha') return row.area_ha
    return list.find((m) => m.key === sort.key)?.cell(row).value ?? null
  }
  // A row with no value sorts last in either direction, so "not loaded" never reads as lowest.
  const sorted = [...rows].sort((a, b) => {
    const x = sortValue(a)
    const y = sortValue(b)
    if (x === null && y === null) return shortName(a).localeCompare(shortName(b))
    if (x === null) return 1
    if (y === null) return -1
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return (sort.down ? -order : order) || shortName(a).localeCompare(shortName(b))
  })
  const header = (key: SortKey, label: string) => {
    const active = sort.key === key
    return (
      <th key={key} aria-sort={active ? (sort.down ? 'descending' : 'ascending') : 'none'}>
        <button
          className="sort"
          // A new column starts high to low, except the two text columns.
          onClick={() => setSort({ key, down: active ? !sort.down : !['name', 'region'].includes(key) })}
        >
          {label}
          {active ? (sort.down ? ' (high to low)' : ' (low to high)') : ''}
        </button>
      </th>
    )
  }
  const notes = linkedLine(rows)

  return (
    <section className="beat compare">
      <h3>How do the study areas compare?</h3>
      <p className="lede">{compareLede(rows, min_year, max_year)}</p>
      <div className="picker" role="group" aria-label="Measure shown in the bars">
        {list.map((m) => (
          <button key={m.key} aria-pressed={m.key === measure.key} onClick={() => setPick(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <Bars rows={rows} measure={measure} onSelect={onSelect} onPreview={onPreview} />
      <p className="live" aria-live="polite">
        {measureLine(rows, measure)}
      </p>
      <details className="table-view">
        <summary>Show all measures as a table</summary>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                {header('name', 'Area')}
                {header('region', 'Island group')}
                {header('area_ha', 'Area (ha)')}
                {list.map((m) => header(m.key, m.label))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.area_id}>
                  <th>
                    <button className="sort" onClick={() => onSelect(row.area_id)}>
                      {shortName(row)}
                    </button>
                  </th>
                  <td>{regionOf(row.area_id) ?? 'Not set'}</td>
                  <td>{formatHa(row.area_ha)}</td>
                  {list.map((m) => (
                    <td key={m.key}>{cellText(m, m.cell(row))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <ul className="caveats">
        <li>
          Areas differ in size, land cover, and population. A figure per hectare compares
          intensity. It does not show need.
        </li>
        <li>{overlapNote(rows)}</li>
        <li>
          Contract cost per hectare uses the contract site, not the area the contract protects.
          Contract cost is the contract budget listed by DPWH. This data does not show what was
          paid.
        </li>
        <li>
          Tree cover loss and contract figures cover {min_year} to {max_year}, the years with
          DPWH data. Rain per year is the mean of the complete years loaded for each area.
        </li>
        <li>
          A reported-status list is a prompt to look, not a finding about a contract. A contract
          on more than one list counts once.
        </li>
        {notes && <li>{notes}</li>}
        <li>Select an area to open its story.</li>
      </ul>
    </section>
  )
}
