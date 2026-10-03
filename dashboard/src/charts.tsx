import { useState } from 'react'
import { CATEGORIES, formatHa, formatPhp, shortPhp } from './api'
import type { MetricRow, ProjectFeature } from './api'

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
  windowYears: [number, number]
}

export function TreeLossChart({ series, windowYears }: LossProps) {
  const [hover, setHover] = useState<number | null>(null)
  const years = [...new Set(series.flatMap((s) => s.rows.map((r) => r.year)))].sort()
  if (years.length === 0) return <p className="empty">No tree cover loss rows for this area yet.</p>

  const byYear = (s: LossSeries, year: number) => s.rows.find((r) => r.year === year)
  const total = (year: number) => series.reduce((t, s) => t + (byYear(s, year)?.value ?? 0), 0)
  const max = niceMax(Math.max(...years.map(total)))
  const band = PLOT_W / years.length
  const barW = Math.max(4, band - 5)
  const x = (year: number) => M.left + (year - years[0]) * band
  const y = (value: number) => M.top + PLOT_H - (value / max) * PLOT_H
  const storm = (year: number) => series.some((s) => byYear(s, year)?.quality_flag === 'storm_year')
  const flags = (year: number) => [...new Set(series.map((s) => byYear(s, year)?.quality_flag))]

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
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tree cover loss per year in hectares">
          <rect
            x={x(windowYears[0]) - 1}
            y={M.top - 6}
            width={band * (windowYears[1] - windowYears[0] + 1)}
            height={PLOT_H + 6}
            className="window-band"
          />
          <text x={x(windowYears[1]) + band - 1} y={M.top - 10} textAnchor="end" className="tick">
            years with DPWH data
          </text>
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
            return (
              <g key={year} opacity={hover === null || hover === year ? 1 : 0.45}>
                {series.map((s, i) => {
                  const value = byYear(s, year)?.value ?? 0
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
                {storm(year) && (
                  <path
                    d={`M${x(year) + band / 2 - 3},${H - M.bottom + 3} h6 l-3,4 z`}
                    className="storm-mark"
                  />
                )}
                <rect
                  x={x(year)}
                  y={M.top}
                  width={band}
                  height={PLOT_H + 10}
                  fill="transparent"
                  onMouseEnter={() => setHover(year)}
                  onMouseLeave={() => setHover(null)}
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
            style={{ left: `${((x(hover) + band / 2) / W) * 100}%`, top: `${(y(total(hover)) / H) * 100}%` }}
          >
            <strong>{hover}</strong>
            {series.map((s) => (
              <span key={s.key}>
                {series.length > 1 && <span className="swatch" style={{ background: s.color }} />}
                {series.length > 1 ? `${s.label}: ` : ''}
                {formatHa(byYear(s, hover)?.value ?? 0)}
              </span>
            ))}
            {series.length > 1 && <span>Total: {formatHa(total(hover))}</span>}
            <span className="muted">quality: {flags(hover).join(', ')}</span>
          </div>
        )}
      </div>
      <figcaption>
        <span className="storm-key" /> Typhoon year (2009 Ondoy, 2020 Ulysses). Part of that loss may
        be natural.
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
                  <td key={s.key}>{(byYear(s, year)?.value ?? 0).toFixed(1)}</td>
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

export function FundingYearChart({ projects, years }: { projects: ProjectFeature[]; years: number[] }) {
  const rows = years.map((year) => {
    const inYear = projects.filter((p) => p.properties.year === year)
    return {
      year,
      count: inYear.length,
      amount: inYear.reduce((t, p) => t + (p.properties.amount_php ?? 0), 0),
    }
  })
  const max = niceMax(Math.max(...rows.map((r) => r.amount)))
  const band = PLOT_W / rows.length
  const barW = Math.min(44, band - 24)
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
            <g key={row.year}>
              <title>{`${row.year}: ${formatPhp(row.amount)}, ${row.count} projects`}</title>
              <path d={bar(cx - barW / 2, y(row.amount), barW, y(0) - y(row.amount), true)} className="funding-bar" />
              <text x={cx} y={y(row.amount) - 6} textAnchor="middle" className="value">
                {row.count > 0 ? shortPhp(row.amount) : '0'}
              </text>
              <text x={cx} y={height - 18} textAnchor="middle" className="tick strong">
                {row.year}
              </text>
              <text x={cx} y={height - 5} textAnchor="middle" className="tick">
                {row.count} {row.count === 1 ? 'project' : 'projects'}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption>Contract cost in PHP (nominal). B is billion, M is million.</figcaption>
    </figure>
  )
}

export function CategoryBars({ projects }: { projects: ProjectFeature[] }) {
  const rows = CATEGORIES.map((category) => {
    const matching = projects.filter((p) => p.properties.category === category.key)
    return {
      ...category,
      count: matching.length,
      amount: matching.reduce((t, p) => t + (p.properties.amount_php ?? 0), 0),
    }
  })
  const max = Math.max(1, ...rows.map((r) => r.amount))
  return (
    <ul className="category-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="category-name">{row.label}</span>
          <span className="category-track">
            {row.count > 0 && <span
              className="category-fill"
              style={{ width: `${(row.amount / max) * 100}%`, background: row.color }}
            />}
          </span>
          <span className="category-value">
            {row.count === 0 ? 'None recorded' : `${formatPhp(row.amount)}, ${row.count} ${row.count === 1 ? 'project' : 'projects'}`}
          </span>
        </li>
      ))}
    </ul>
  )
}
