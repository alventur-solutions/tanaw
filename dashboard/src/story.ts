// The sentences around each chart. Pure functions: the rows a chart draws go in, a string comes
// out, so the text and the bars cannot drift apart.
import { CATEGORIES, formatHa, formatMm, formatPhp, sumAmount, sumLoss } from './api'
import type { MetricRow, ProjectFeature, ProjectProps } from './api'

interface Rows {
  label: string
  rows: MetricRow[]
}

const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-PH')} ${word}${count === 1 ? '' : 's'}`

/** "from 2016 to 2025", or "in 2020" when the span is one year. */
const span = (from: number, to: number) => (from === to ? `in ${from}` : `from ${from} to ${to}`)

/** "a, b, or c" */
export function listOr(items: string[]): string {
  if (items.length <= 2) return items.join(' or ')
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}

/** "about 62 percent", or null when the whole is zero. A rounded share never reads as none or all. */
export function share(part: number | null, whole: number | null): string | null {
  if (part === null || whole === null || whole <= 0) return null
  const percent = Math.round((part / whole) * 100)
  if (percent === 0 && part > 0) return 'less than 1 percent'
  if (percent === 100 && part < whole) return 'more than 99 percent'
  return `about ${percent} percent`
}

function flagNote(flags: (string | undefined)[]): string {
  const seen = [...new Set(flags.filter((f): f is string => f !== undefined && f !== 'ok'))]
  return seen
    .map((flag) =>
      flag === 'storm_year'
        ? ' This year is flagged as a major storm year, so part of that loss may be natural.'
        : ` Data quality note: ${flag}.`,
    )
    .join('')
}

const yearRow = (s: Rows, year: number) => s.rows.find((r) => r.year === year && r.value !== null)

const yearTotal = (series: Rows[], year: number): number | null => {
  const values = series.map((s) => yearRow(s, year)?.value ?? null)
  if (values.length === 0 || values.some((value) => value === null)) return null
  return values.reduce<number>((total, value) => total + value!, 0)
}

const yearFlags = (series: Rows[], year: number) =>
  series.map((s) => s.rows.find((r) => r.year === year)?.quality_flag)

/** The year with the highest loss across the series a chart stacks, or null when all are zero. */
export function peakYear(series: Rows[]): { year: number; value: number } | null {
  const years = [...new Set(series.flatMap((s) => s.rows.map((r) => r.year)))]
  let best: { year: number; value: number } | null = null
  for (const year of years) {
    const value = yearTotal(series, year)
    if (value !== null && value > 0 && (best === null || value > best.value)) {
      best = { year, value }
    }
  }
  return best
}

export function lossLede(rows: MetricRow[], from: number, to: number): string {
  if (rows.length === 0) return 'No tree cover loss rows are loaded for this area yet.'
  const total = sumLoss(rows, from, to)
  if (total === null) {
    return `A complete tree cover loss total is not available for every year ${span(from, to)}.`
  }
  if (total === 0) return `No tree cover loss was recorded here ${span(from, to)}.`
  return `About ${formatHa(total)} of tree cover loss was recorded here ${span(from, to)}.`
}

/** The line under the loss chart. It follows the year the reader points at. */
export function lossLine(series: Rows[], year: number | null): string {
  if (year === null) {
    const peak = peakYear(series)
    if (peak === null) return 'No year in this record has tree cover loss.'
    return (
      `The highest recorded year was ${peak.year} at about ${formatHa(peak.value)}. Later years are ` +
      'detected more completely, so this does not rank years across the whole record.' +
      flagNote(yearFlags(series, peak.year))
    )
  }
  const total = yearTotal(series, year)
  if (total === null) return `A complete tree cover loss value is not loaded for ${year}.`
  // A zone with no row for the year has no value. It is never written as zero.
  const parts =
    series.length > 1
      ? ` (${series
          .map((s) => {
            const row = yearRow(s, year)
            return `${s.label.toLowerCase()} ${row ? formatHa(row.value) : 'no value'}`
          })
          .join(', ')})`
      : ''
  return (
    `In ${year}, ${formatHa(total)} of tree cover loss was recorded here${parts}.` +
    flagNote(yearFlags(series, year))
  )
}

export function lossAlt(series: Rows[]): string {
  const years = series.flatMap((s) => s.rows.map((r) => r.year))
  if (years.length === 0) return 'Bar chart of tree cover loss per year in hectares. No rows yet.'
  const peak = peakYear(series)
  const from = Math.min(...years)
  const to = Math.max(...years)
  return (
    `Bar chart of tree cover loss per year in hectares, ${from === to ? from : `${from} to ${to}`}.` +
    (peak ? ` The highest recorded year is ${peak.year} at about ${formatHa(peak.value)}.` : '')
  )
}

/** Upstream as a share of the loss in the two zones, the same rows the zone bars draw. */
export function zoneLossLede(up: MetricRow[], down: MetricRow[], from: number, to: number): string {
  const upLoss = sumLoss(up, from, to)
  const downLoss = sumLoss(down, from, to)
  if (upLoss === null || downLoss === null) {
    return `Complete tree cover loss totals are not loaded for both zones ${span(from, to)}.`
  }
  const part = share(upLoss, upLoss + downLoss)
  if (part === null) return `No tree cover loss was recorded in either zone ${span(from, to)}.`
  return `Upstream holds ${part} of the tree cover loss recorded in the two zones ${span(from, to)}.`
}

function noCost(features: ProjectFeature[]): string {
  const count = features.filter((f) => f.properties.amount_php == null).length
  return count === 0 ? '' : ` ${count.toLocaleString('en-PH')} of them have no contract cost on record.`
}

export function fundingLede(features: ProjectFeature[], from: number, to: number): string {
  if (features.length === 0) {
    return `No DPWH flood control contracts are recorded here ${span(from, to)}.`
  }
  const amount = sumAmount(features)
  if (amount === null) {
    return (
      `${plural(features.length, 'DPWH flood control contract')} were sited here ${span(from, to)}, ` +
      `but a complete contract cost total is not available.${noCost(features)}`
    )
  }
  return (
    `${plural(features.length, 'DPWH flood control contract')} with a total contract cost of ` +
    `${formatPhp(amount)} ${features.length === 1 ? 'was' : 'were'} sited here ${span(from, to)}.` +
    noCost(features)
  )
}

export function categoryLede(features: ProjectFeature[]): string {
  if (features.length === 0) return 'No DPWH flood control contracts are recorded for these years.'
  const total = sumAmount(features)
  if (total === null) {
    return `A category comparison is unavailable because one or more contracts are missing a cost.${noCost(features)}`
  }
  const rows = CATEGORIES.map((c) => ({
    label: c.label,
    amount: sumAmount(features.filter((f) => f.properties.category === c.key)),
  })).sort((a, b) => b.amount! - a.amount!)
  const part = share(rows[0].amount, total)
  if (part === null) return 'Reported contract costs total PHP 0 across these contracts.'
  if (rows[1].amount === rows[0].amount) {
    return `${rows[0].label} and ${rows[1].label.toLowerCase()} hold the largest shares of the contract cost here in these years.`
  }
  return `${rows[0].label} holds the largest share: ${formatPhp(rows[0].amount)}, ${part} of the contract cost here in these years.`
}

/** How many contracts carry a category read from the description, which is an estimate. */
export function estimatedCategories(features: ProjectFeature[]): number {
  return features.filter((f) => f.properties.quality_flag === 'category_from_description').length
}

export function statusLede(features: ProjectFeature[]): string {
  const counts = new Map<string, number>()
  for (const f of features) {
    const status = f.properties.status ?? 'No status on record'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return 'No contracts are loaded for this area.'
  return `The most common reported status is "${top[0]}", on ${top[1].toLocaleString('en-PH')} of ${plural(features.length, 'contract')}.`
}

export function sideLede(loss: MetricRow[], features: ProjectFeature[], from: number, to: number): string {
  const when = span(from, to)
  const totalLoss = sumLoss(loss, from, to)
  const land =
    totalLoss === null
      ? `A complete tree cover loss total is not available ${when}. `
      : `${when[0].toUpperCase()}${when.slice(1)}, about ${formatHa(totalLoss)} of tree cover loss was recorded here. `
  if (features.length === 0) {
    return `${land}No DPWH flood control contracts appear in this data here in the same period.`
  }
  return (
    `${land}In the same period, ${plural(features.length, 'DPWH flood control contract')} with a contract cost of ` +
    `${formatPhp(sumAmount(features))} ${features.length === 1 ? 'was' : 'were'} sited here.${noCost(features)}`
  )
}

/** The line under the two linked charts. It reads both figures for the year in focus. */
export function sideLine(loss: MetricRow[], features: ProjectFeature[], year: number | null): string {
  if (year === null) return 'Point at a year, or focus it with the keyboard, to read both figures for it.'
  const row = loss.find((r) => r.year === year)
  const inYear = features.filter((f) => f.properties.year === year)
  const land =
    row && row.value !== null
      ? `${formatHa(row.value)} of tree cover loss was recorded here`
      : 'no tree cover loss value is loaded here'
  const money =
    inYear.length === 0
      ? 'No DPWH flood control contracts in this data carry this infrastructure year here.'
      : `${plural(inYear.length, 'DPWH flood control contract')} with a contract cost of ` +
        `${formatPhp(sumAmount(inYear))} ${inYear.length === 1 ? 'carries' : 'carry'} this infrastructure year here.${noCost(inYear)}`
  return `In ${year}, ${land}. ${money}${flagNote([row?.quality_flag])}`
}

export function zoneFinding(
  upLoss: number | null,
  loss: number | null,
  upAmount: number | null,
  amount: number | null,
): string {
  const land = share(upLoss, loss)
  const money = share(upAmount, amount)
  const parts = [
    land && `${land} of the basin's tree cover loss`,
    money && `${money} of the basin's DPWH flood control contract cost`,
  ].filter(Boolean)
  if (parts.length === 0) {
    const landKnown = upLoss !== null && loss !== null
    const moneyKnown = upAmount !== null && amount !== null
    if (landKnown && loss === 0 && moneyKnown && amount === 0) {
      return 'Neither zone has recorded loss or contract cost in these years.'
    }
    return 'Complete comparison totals are not available for these years.'
  }
  return (
    `Upstream holds ${parts.join(' and ')} in these years. ` +
    (parts.length === 2 ? 'The two shares are' : 'The share is') +
    ' shown for review, read together with DENR and LGU records.'
  )
}

/** Named types of work with no contract here. "Other" is left out: it is not a type of work. */
export function missingCategories(features: ProjectFeature[]): string[] {
  return CATEGORIES.filter(
    (c) => c.key !== 'other' && !features.some((f) => f.properties.category === c.key),
  ).map((c) => c.label.toLowerCase())
}

const kindOf = (p: ProjectProps) =>
  CATEGORIES.find((c) => c.key === p.category)?.label.toLowerCase() ?? 'other'

/** One contract in a sentence: what kind, how much, which year, and its reported status. */
export function contractLede(p: ProjectProps): string {
  const other = p.category === 'other'
  const opening =
    p.quality_flag === 'category_from_description'
      ? `This contract is classed here as ${other ? 'other work' : kindOf(p)}, an estimate read from its description,`
      : other
        ? 'This is a flood control contract of another type of work'
        : `This is a ${kindOf(p)} contract`
  const cost =
    p.amount_php == null ? 'no contract cost on record' : `a contract cost of ${formatPhp(p.amount_php)}`
  const progress = p.progress_pct == null ? '' : `, at ${p.progress_pct.toFixed(0)} percent reported progress`
  const status = p.status
    ? ` DPWH reports its status as "${p.status}"${progress}.`
    : ' DPWH lists no status for it.'
  return `${opening} with ${cost}, infrastructure year ${p.year}.${status}`
}

/** Where one contract sits among the contracts of its study area. */
export function contractInArea(
  p: ProjectProps,
  features: ProjectFeature[],
  areaName: string,
  from: number,
  to: number,
): string {
  if (p.year < from || p.year > to) {
    return `Its infrastructure year, ${p.year}, is outside ${from} to ${to}, the years shown for ${areaName}.`
  }
  if (!features.some((f) => f.properties.component_id === p.component_id)) {
    return `This contract is not among the contracts loaded for ${areaName}.`
  }
  if (features.length === 1) {
    return `It is the only DPWH flood control contract sited in ${areaName} ${span(from, to)}.`
  }
  const sameKind = features.filter((f) => f.properties.category === p.category).length
  const kind =
    p.category === 'other'
      ? `${plural(sameKind, 'contract')} classed as other work`
      : plural(sameKind, `${kindOf(p)} contract`)
  const part = p.amount_php == null ? null : share(p.amount_php, sumAmount(features))
  return (
    `It is one of ${plural(features.length, 'DPWH flood control contract')} sited in ${areaName} ${span(from, to)}, ` +
    `and one of ${kind}.` +
    (part === null ? '' : ` Its contract cost is ${part} of the area's total contract cost.`)
  )
}

const rainValue = (rows: MetricRow[], metric: string, year: number) =>
  rows.find((r) => r.metric === metric && r.year === year)?.value ?? null

/** Yearly rainfall totals for complete years only. A partial year is a lower bound. */
export function fullRainYears(rows: MetricRow[]): MetricRow[] {
  return rows.filter(
    (r) => r.metric === 'rainfall_total' && r.quality_flag !== 'partial_year' && r.value !== null,
  )
}

export function rainLede(rows: MetricRow[]): string {
  const full = fullRainYears(rows)
  if (full.length === 0) return 'No complete year of rainfall is loaded for this area yet.'
  const years = full.map((r) => r.year)
  const mean = full.reduce((t, r) => t + r.value!, 0) / full.length
  if (full.length === 1) {
    return `CHIRPS estimates about ${formatMm(mean)} of rain here in ${years[0]}, the only complete year loaded.`
  }
  return `CHIRPS estimates about ${formatMm(mean)} of rain a year here, as the mean of the complete years from ${Math.min(...years)} to ${Math.max(...years)}.`
}

export function wettestYear(rows: MetricRow[]): MetricRow | null {
  return fullRainYears(rows).reduce<MetricRow | null>(
    (best, r) => (best === null || r.value! > best.value! ? r : best),
    null,
  )
}

/** The line under the rainfall chart. It follows the year the reader points at. */
export function rainLine(rows: MetricRow[], year: number | null): string {
  if (year === null) {
    const wettest = wettestYear(rows)
    if (wettest === null || wettest.value === null) return 'No complete year of rainfall is loaded.'
    return `The wettest complete year was ${wettest.year} at about ${formatMm(wettest.value)}.`
  }
  const total = rows.find((r) => r.metric === 'rainfall_total' && r.year === year)
  if (!total || total.value === null) return `No rainfall value is loaded for ${year}.`
  const days = rainValue(rows, 'heavy_rain_days', year)
  const max = rainValue(rows, 'rainfall_max_1day', year)
  const flag = total.quality_flag
  return (
    `In ${year}, CHIRPS estimates ${formatMm(total.value)} of rain here` +
    (days === null ? '' : `, with ${plural(Math.round(days), 'day')} when the area mean was 50 mm or more`) +
    '.' +
    (max === null ? '' : ` The wettest day had an area mean of ${formatMm(max)}.`) +
    (flag === 'partial_year'
      ? ' The year is not complete, so these are lower bounds.'
      : flag === 'small_area'
        ? ' The area is smaller than one rainfall pixel, so this is a coarse value.'
        : flag === 'ok'
          ? ''
          : ` Data quality note: ${flag}.`)
  )
}

export function rainAlt(rows: MetricRow[]): string {
  const totals = rows.filter((r) => r.metric === 'rainfall_total')
  if (totals.length === 0) return 'Bar chart of rainfall per year in mm. No rows yet.'
  const years = totals.map((r) => r.year)
  const wettest = wettestYear(rows)
  const partial = totals.filter((r) => r.quality_flag === 'partial_year').map((r) => r.year)
  return (
    `Bar chart of CHIRPS rainfall per year in mm, ${Math.min(...years)} to ${Math.max(...years)}.` +
    (wettest && wettest.value !== null
      ? ` The wettest complete year is ${wettest.year} at about ${formatMm(wettest.value)}.`
      : '') +
    (partial.length > 0 ? ` ${partial.join(', ')} is not complete.` : '')
  )
}
