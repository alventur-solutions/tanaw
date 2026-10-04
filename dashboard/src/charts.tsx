import { useState } from 'react'
import { CATEGORIES, formatHa, formatPhp, RAIN_METRICS, shortPhp, sumAmount } from './api'
import type { MetricRow, ProjectFeature } from './api'
import {
  heavyRainAlt,
  heavyRainLine,
  lossAlt,
  lossLine,
  peakYear,
  rainAlt,
  rainLine,
  wettestYear,
} from './story'

const W = 420
const H = 190
const M = { top: 22, right: 6, bottom: 24, left: 40 }
const PLOT_W = W - M.left - M.right
const PLOT_H = H - M.top - M.bottom

function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= value) ?? 10
  return step * power
}

/** Bar with a rounded top, anchored to the baseline. */
function bar(x: number, y: number, width: number, height: number, round: boolean): string {
  const r = round ? Math.min(2, height, width / 2) : 0
  return (
    `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} ` +
    `Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
  )
}

export interface LossSeries {
  key: string
  label: string
  color: string
  rows: MetricRow[]
}

interface LossProps {
  series: LossSeries[]
  // The funding years, shaded when the chart shows a longer record.
  windowYears?: [number, number]
  // Set by a panel that links this chart's year to another chart. The panel then writes the line.
  activeYear?: number | null
  onYear?: (year: number | null) => void
}

export function TreeLossChart({ series, windowYears, activeYear, onYear }: LossProps) {
  const [own, setOwn] = useState<number | null>(null)
  const hover = onYear ? (activeYear ?? null) : own
  const setHover = onYear ?? setOwn
  const loadedYears = [...new Set(series.flatMap((s) => s.rows.map((r) => r.year)))].sort()
  if (loadedYears.length === 0) return <p className="empty">No tree cover loss rows for this area yet.</p>
  const years = Array.from(
    { length: loadedYears[loadedYears.length - 1] - loadedYears[0] + 1 },
    (_, index) => loadedYears[0] + index,
  )

  const byYear = (s: LossSeries, year: number) => s.rows.find((r) => r.year === year)
  const total = (year: number): number | null => {
    const values = series.map((s) => byYear(s, year)?.value ?? null)
    if (values.length === 0 || values.some((value) => value === null)) return null
    return values.reduce<number>((sum, value) => sum + value!, 0)
  }
  const knownTotals = years.map(total).filter((value): value is number => value !== null)
  const max = niceMax(Math.max(0, ...knownTotals))
  const band = PLOT_W / years.length
  const barW = Math.max(4, band - 5)
  const x = (year: number) => M.left + (year - years[0]) * band
  const y = (value: number) => M.top + PLOT_H - (value / max) * PLOT_H
  // A storm year and the year after one carry the same mark: late storm loss can be dated to the next year.
  const flagged = (year: number, flag: string) => series.some((s) => byYear(s, year)?.quality_flag === flag)
  const storm = (year: number) => flagged(year, 'storm_year') || flagged(year, 'storm_prior_year')
  const followsStorm = years.some((year) => flagged(year, 'storm_prior_year'))
  const flags = (year: number) =>
    [...new Set(series.map((s) => byYear(s, year)?.quality_flag))].filter(Boolean)
  // A zone with no row for a year has no value. It is never shown as zero.
  const shown = (s: LossSeries, year: number, digits?: number) => {
    const value = byYear(s, year)?.value
    if (value == null) return 'no value'
    return digits === undefined ? formatHa(value) : value.toFixed(digits)
  }
  const peak = peakYear(series)

  return (
    <figure className="chart">
      {series.length > 1 && (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={lossAlt(series)}>
          {windowYears && (
            <rect
              x={x(windowYears[0]) - 1}
              y={M.top - 6}
              width={band * (windowYears[1] - windowYears[0] + 1)}
              height={PLOT_H + 6}
              className="window-band"
            />
          )}
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(max * t)} y2={y(max * t)} className="grid" />
              <text x={M.left - 6} y={y(max * t) + 3} textAnchor="end" className="tick">
                {(max * t).toLocaleString('en-PH')}
              </text>
            </g>
          ))}
          {years.map((year) => {
            let base = 0
            const yearTotal = total(year)
            return (
              <g key={year} opacity={hover === null || hover === year ? 1 : 0.45}>
                {yearTotal !== null && series.map((s, i) => {
                  const value = byYear(s, year)!.value!
                  const top = y(base + value)
                  const height = y(base) - top
                  base += value
                  if (height <= 0) return null
                  // 1px surface gap between stacked segments.
                  const gap = i > 0 ? 1 : 0
                  return (
                    <path
                      key={s.key}
                      d={bar(x(year) + (band - barW) / 2, top, barW, Math.max(0, height - gap), i === series.length - 1)}
                      fill={s.color}
                    />
                  )
                })}
                {yearTotal === null && (
                  <text x={x(year) + band / 2} y={H - M.bottom - 3} textAnchor="middle" className="tick">
                    ?
                  </text>
                )}
                {storm(year) && (
                  <path
                    d={`M${x(year) + band / 2 - 3},${H - M.bottom + 3} h6 l-3,4 z`}
                    className="storm-mark"
                  />
                )}
                {peak?.year === year && yearTotal !== null && (
                  <text x={x(year) + band / 2} y={y(yearTotal) - 4} textAnchor="middle" className="value">
                    {Math.round(peak.value).toLocaleString('en-PH')}
                  </text>
                )}
                <rect
                  x={x(year)}
                  y={M.top}
                  width={band}
                  height={PLOT_H + 10}
                  fill="transparent"
                  className="year-target"
                  tabIndex={0}
                  aria-label={lossLine(series, year)}
                  onMouseEnter={() => setHover(year)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(year)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover(year)}
                />
              </g>
            )
          })}
          {years
            .filter((year) => year % 5 === 0 || year === years[0])
            .map((year) => (
              <text key={year} x={x(year) + band / 2} y={H - 4} textAnchor="middle" className="tick">
                {year}
              </text>
            ))}
        </svg>
        {hover !== null && (
          <div
            className="tooltip"
            style={{
              left: `${((x(hover) + band / 2) / W) * 100}%`,
              top: `${(y(total(hover) ?? 0) / H) * 100}%`,
            }}
          >
            <strong>{hover}</strong>
            {series.map((s) => (
              <span key={s.key}>
                {series.length > 1 && <span className="swatch" style={{ background: s.color }} />}
                {series.length > 1 ? `${s.label}: ` : ''}
                {shown(s, hover)}
              </span>
            ))}
            {series.length > 1 && <span>Total: {formatHa(total(hover))}</span>}
            <span className="muted">quality: {flags(hover).join(', ')}</span>
          </div>
        )}
      </div>
      {!onYear && (
        <p className="live" aria-live="polite">
          {lossLine(series, hover)}
        </p>
      )}
      <figcaption>
        {windowYears && (
          <>
            <span className="band-key" /> Shaded: {windowYears[0]} to {windowYears[1]}, the years
            with DPWH data.{' '}
          </>
        )}
        {years.some(storm) && (
          <>
            <span className="storm-key" />{' '}
            {followsStorm
              ? 'Marked years are flagged as major storm years, or follow one.'
              : 'Marked years are flagged as major storm years.'}{' '}
            Part of that loss may be natural.
          </>
        )}
        {years.some((year) => total(year) === null) && ' A question mark marks a year without a complete value.'}
      </figcaption>
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              {series.map((s) => (
                <th key={s.key}>{s.label} (ha)</th>
              ))}
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year}>
                <td>{year}</td>
                {series.map((s) => (
                  <td key={s.key}>{shown(s, year, 1)}</td>
                ))}
                <td>{flags(year).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

const RAIN_COLOR = '#3f6ea8'
const RAIN_LABEL: Record<string, string> = {
  rainfall_total: 'Total (mm)',
  rainfall_wet_season: 'Jun to Nov (mm)',
  rainfall_max_1day: 'Wettest day, area mean (mm)',
  heavy_rain_days: 'Days with area mean of 50 mm or more',
}

/** Yearly rainfall total. A year that is not complete is drawn lighter and is a lower bound. */
export function RainChart({ rows }: { rows: MetricRow[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = rows.filter((r) => r.metric === 'rainfall_total').sort((a, b) => a.year - b.year)
  if (totals.length === 0) return <p className="empty">No rainfall rows for this area yet.</p>

  const years = Array.from(
    { length: totals[totals.length - 1].year - totals[0].year + 1 },
    (_, index) => totals[0].year + index,
  )
  const totalsByYear = new Map(totals.map((row) => [row.year, row]))
  const knownValues = totals.flatMap((row) => (row.value === null ? [] : [row.value]))
  const max = niceMax(Math.max(0, ...knownValues))
  const band = PLOT_W / years.length
  const barW = Math.max(4, band - 5)
  const x = (year: number) => M.left + (year - years[0]) * band
  const y = (value: number) => M.top + PLOT_H - (value / max) * PLOT_H
  const wettest = wettestYear(rows)
  const partial = totals.some((r) => r.quality_flag === 'partial_year')
  const cell = (metric: string, year: number) =>
    rows.find((r) => r.metric === metric && r.year === year)?.value

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rainAlt(rows)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(max * t)} y2={y(max * t)} className="grid" />
            <text x={M.left - 6} y={y(max * t) + 3} textAnchor="end" className="tick">
              {(max * t).toLocaleString('en-PH')}
            </text>
          </g>
        ))}
        {years.map((year) => {
          const row = totalsByYear.get(year)
          const value = row?.value ?? null
          const dim = hover !== null && hover !== year
          return (
            <g key={year} opacity={dim ? 0.45 : 1}>
              {value === null ? (
                <text x={x(year) + band / 2} y={H - M.bottom - 3} textAnchor="middle" className="tick">
                  ?
                </text>
              ) : (
                <path
                  d={bar(x(year) + (band - barW) / 2, y(value), barW, y(0) - y(value), true)}
                  fill={RAIN_COLOR}
                  fillOpacity={row?.quality_flag === 'partial_year' ? 0.4 : 1}
                />
              )}
              {wettest?.year === year && value !== null && (
                <text x={x(year) + band / 2} y={y(value) - 4} textAnchor="middle" className="value">
                  {Math.round(value).toLocaleString('en-PH')}
                </text>
              )}
              <rect
                x={x(year)}
                y={M.top}
                width={band}
                height={PLOT_H + 10}
                fill="transparent"
                className="year-target"
                tabIndex={0}
                aria-label={rainLine(rows, year)}
                onMouseEnter={() => setHover(year)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(year)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(year)}
              />
            </g>
          )
        })}
        {years
          .filter((year) => year % 5 === 0 || year === years[0])
          .map((year) => (
            <text key={year} x={x(year) + band / 2} y={H - 4} textAnchor="middle" className="tick">
              {year}
            </text>
          ))}
      </svg>
      <p className="live" aria-live="polite">
        {rainLine(rows, hover)}
      </p>
      {partial && (
        <figcaption>
          A lighter bar is a year that is not complete yet. Its value is a lower bound.
        </figcaption>
      )}
      {years.some((year) => totalsByYear.get(year)?.value == null) && (
        <figcaption>A question mark marks a year with no rainfall value loaded.</figcaption>
      )}
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              {RAIN_METRICS.map((metric) => (
                <th key={metric}>{RAIN_LABEL[metric]}</th>
              ))}
              <th>Quality (total)</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                {RAIN_METRICS.map((metric) => (
                  <td key={metric}>{cell(metric, row.year)?.toFixed(0) ?? 'no value'}</td>
                ))}
                <td>{row.quality_flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

interface FundingYearProps {
  projects: ProjectFeature[]
  years: number[]
  activeYear?: number | null
  onYear?: (year: number | null) => void
}

export function FundingYearChart({ projects, years, activeYear = null, onYear }: FundingYearProps) {
  const rows = years.map((year) => {
    const inYear = projects.filter((p) => p.properties.year === year)
    return {
      year,
      count: inYear.length,
      amount: sumAmount(inYear),
    }
  })
  const knownAmounts = rows.flatMap((row) => (row.amount === null ? [] : [row.amount]))
  const max = niceMax(Math.max(0, ...knownAmounts))
  const band = PLOT_W / rows.length
  const barW = Math.min(44, band - 10)
  const height = 170
  const plotH = height - M.top - 34
  const y = (value: number) => M.top + plotH - (value / max) * plotH

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="DPWH contract cost per year">
        <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} className="grid" />
        {rows.map((row, i) => {
          const cx = M.left + i * band + band / 2
          return (
            <g
              key={row.year}
              opacity={activeYear === null || activeYear === row.year ? 1 : 0.45}
              className={onYear ? 'year-target' : undefined}
              tabIndex={onYear ? 0 : undefined}
              onMouseEnter={onYear && (() => onYear(row.year))}
              onMouseLeave={onYear && (() => onYear(null))}
              onFocus={onYear && (() => onYear(row.year))}
              onBlur={onYear && (() => onYear(null))}
              onClick={onYear && (() => onYear(row.year))}
            >
              <title>{`${row.year}: ${formatPhp(row.amount)}, ${row.count} ${row.count === 1 ? 'contract' : 'contracts'}`}</title>
              {row.amount === null ? (
                <text x={cx} y={height - 34} textAnchor="middle" className="tick">
                  ?
                </text>
              ) : (
                <path d={bar(cx - barW / 2, y(row.amount), barW, y(0) - y(row.amount), true)} className="funding-bar" />
              )}
              <text x={cx} y={row.amount === null ? height - 44 : y(row.amount) - 6} textAnchor="middle" className="value">
                {row.count === 0 ? '0' : shortPhp(row.amount)}
              </text>
              <text x={cx} y={height - 18} textAnchor="middle" className="tick strong">
                {row.year}
              </text>
              <text x={cx} y={height - 5} textAnchor="middle" className="tick">
                {row.count}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption>
        Contract cost in PHP (nominal). B is billion, M is million. The number under each year is
        the count of contracts. A question mark means one or more contracts has no cost on record.
      </figcaption>
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th>Contracts</th>
              <th>Contract cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                <td>{row.count.toLocaleString('en-PH')}</td>
                <td>{formatPhp(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export function CategoryBars({ projects }: { projects: ProjectFeature[] }) {
  const rows = CATEGORIES.map((category) => {
    const matching = projects.filter((p) => p.properties.category === category.key)
    return {
      ...category,
      count: matching.length,
      amount: sumAmount(matching),
    }
  })
  const knownAmounts = rows.flatMap((row) => (row.amount === null ? [] : [row.amount]))
  const max = Math.max(1, ...knownAmounts)
  return (
    <ul className="category-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="category-name">{row.label}</span>
          <span className="category-track">
            {row.count > 0 && row.amount !== null && <span
              className="category-fill"
              style={{ width: `${(row.amount / max) * 100}%`, background: row.color }}
            />}
          </span>
          <span className="category-value">
            {row.count === 0
              ? 'Does not appear in this data'
              : row.amount === null
                ? `${row.count} ${row.count === 1 ? 'contract' : 'contracts'}; cost not available`
                : `${formatPhp(row.amount)}, ${row.count} ${row.count === 1 ? 'contract' : 'contracts'}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function StatusList({ projects }: { projects: ProjectFeature[] }) {
  const counts = new Map<string, number>()
  for (const project of projects) {
    const status = project.properties.status ?? 'No status on record'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return (
    <table>
      <thead>
        <tr>
          <th>Reported status</th>
          <th>Contracts</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([status, count]) => (
          <tr key={status}>
            <th>{status}</th>
            <td>{count.toLocaleString('en-PH')}</td>
            <td>{((count / projects.length) * 100).toFixed(1)} percent</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Days per year when the area mean was 50 mm or more. A year that is not complete is drawn lighter.
 * The wettest day per year is read in the line and the table, never on a second axis.
 */
export function HeavyRainChart({ rows, color = RAIN_COLOR }: { rows: MetricRow[]; color?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const days = rows.filter((r) => r.metric === 'heavy_rain_days' && r.value !== null).sort((a, b) => a.year - b.year)
  if (days.length === 0) return <p className="empty">No heavy rain day rows for this area yet.</p>

  const years = days.map((r) => r.year)
  const max = niceMax(Math.max(...days.map((r) => r.value ?? 0)))
  const band = PLOT_W / years.length
  const barW = Math.max(4, band - 5)
  const x = (year: number) => M.left + years.indexOf(year) * band
  const y = (value: number) => M.top + PLOT_H - (value / max) * PLOT_H
  const partial = days.some((r) => r.quality_flag === 'partial_year')
  const wettest = (year: number) =>
    rows.find((r) => r.metric === 'rainfall_max_1day' && r.year === year)?.value

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={heavyRainAlt(rows)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(max * t)} y2={y(max * t)} className="grid" />
            <text x={M.left - 6} y={y(max * t) + 3} textAnchor="end" className="tick">
              {(max * t).toLocaleString('en-PH', { maximumFractionDigits: 1 })}
            </text>
          </g>
        ))}
        {days.map((row) => {
          const value = row.value ?? 0
          return (
            <g key={row.year} opacity={hover !== null && hover !== row.year ? 0.45 : 1}>
              {value > 0 && (
                <path
                  d={bar(x(row.year) + (band - barW) / 2, y(value), barW, y(0) - y(value), true)}
                  fill={color}
                  fillOpacity={row.quality_flag === 'partial_year' ? 0.4 : 1}
                />
              )}
              <rect
                x={x(row.year)}
                y={M.top}
                width={band}
                height={PLOT_H + 10}
                fill="transparent"
                className="year-target"
                tabIndex={0}
                aria-label={heavyRainLine(rows, row.year)}
                onMouseEnter={() => setHover(row.year)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(row.year)}
                onBlur={() => setHover(null)}
                onClick={() => setHover(row.year)}
              />
            </g>
          )
        })}
        {years
          .filter((year) => year % 5 === 0 || year === years[0])
          .map((year) => (
            <text key={year} x={x(year) + band / 2} y={H - 4} textAnchor="middle" className="tick">
              {year}
            </text>
          ))}
      </svg>
      <p className="live" aria-live="polite">
        {heavyRainLine(rows, hover)}
      </p>
      <figcaption>
        Days per year with an area mean of 50 mm or more. A year with no such day has no bar.
        {partial ? ' A lighter bar is a year that is not complete yet. Its value is a lower bound.' : ''}
      </figcaption>
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th>Days with area mean of 50 mm or more</th>
              <th>Wettest day, area mean (mm)</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {days.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                <td>{(row.value ?? 0).toFixed(0)}</td>
                <td>{wettest(row.year)?.toFixed(0) ?? 'no value'}</td>
                <td>{row.quality_flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
