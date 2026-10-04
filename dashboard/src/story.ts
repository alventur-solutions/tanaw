// The sentences around each chart. Pure functions: the rows a chart draws go in, a string comes
// out, so the text and the bars cannot drift apart.
import { CATEGORIES, formatHa, formatMm, formatPhp, sumAmount, sumLoss } from './api'
import type { MetricRow, ProjectFeature, ProjectProps } from './api'

interface Rows {
  label: string
  rows: MetricRow[]
}

export const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-PH')} ${word}${count === 1 ? '' : 's'}`

/** "from 2016 to 2025", or "in 2020" when the span is one year. */
export const span = (from: number, to: number) => (from === to ? `in ${from}` : `from ${from} to ${to}`)

/** Shown wherever a city's story leads with tree cover loss, on screen and in the printed brief. */
export const URBAN_NOTE =
  'Built-up surface and green space are not computed for this area yet. They are the land measures for a city. Tree cover loss is shown as supporting evidence only.'

/** "a, b, or c" */
export function listOr(items: string[]): string {
  if (items.length <= 2) return items.join(' or ')
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}

/** "about 62 percent", or null when the whole is zero. A rounded share never reads as none or all. */
export function share(part: number, whole: number): string | null {
  if (whole <= 0) return null
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
        : flag === 'storm_prior_year'
          ? ' The year before is flagged as a major storm year, and loss from a storm late in the year can be dated to this year.'
          : ` Data quality note: ${flag}.`,
    )
    .join('')
}

const yearRow = (s: Rows, year: number) => s.rows.find((r) => r.year === year && r.value !== null)

const yearTotal = (series: Rows[], year: number) =>
  series.reduce((t, s) => t + (yearRow(s, year)?.value ?? 0), 0)

const yearFlags = (series: Rows[], year: number) =>
  series.map((s) => s.rows.find((r) => r.year === year)?.quality_flag)

/** The year with the highest loss across the series a chart stacks, or null when all are zero. */
export function peakYear(series: Rows[]): { year: number; value: number } | null {
  const years = [...new Set(series.flatMap((s) => s.rows.map((r) => r.year)))]
  let best: { year: number; value: number } | null = null
  for (const year of years) {
    const value = yearTotal(series, year)
    if (value > 0 && (best === null || value > best.value)) best = { year, value }
  }
  return best
}

export function lossLede(rows: MetricRow[], from: number, to: number): string {
  if (rows.length === 0) return 'No tree cover loss rows are loaded for this area yet.'
  const total = sumLoss(rows, from, to)
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
  if (!series.some((s) => yearRow(s, year))) return `No value is loaded for ${year}.`
  // A zone with no row for the year has no value. It is never written as zero.
  const parts =
    series.length > 1
      ? ` (${series
          .map((s) => {
            const row = yearRow(s, year)
            return `${s.label.toLowerCase()} ${row ? formatHa(row.value ?? 0) : 'no value'}`
          })
          .join(', ')})`
      : ''
  return (
    `In ${year}, ${formatHa(yearTotal(series, year))} of tree cover loss was recorded here${parts}.` +
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
  const part = share(upLoss, upLoss + sumLoss(down, from, to))
  if (part === null) return `No tree cover loss was recorded in either zone ${span(from, to)}.`
  return `Upstream holds ${part} of the tree cover loss recorded in the two zones ${span(from, to)}.`
}

function noCost(features: ProjectFeature[]): string {
  const count = features.filter((f) => f.properties.amount_php == null).length
  return count === 0 ? '' : ` ${count.toLocaleString('en-PH')} of them ${count === 1 ? 'has' : 'have'} no contract cost on record.`
}

export function fundingLede(features: ProjectFeature[], from: number, to: number): string {
  return (
    `${plural(features.length, 'DPWH flood control contract')} with a total contract cost of ` +
    `${formatPhp(sumAmount(features))} ${features.length === 1 ? 'was' : 'were'} sited here ${span(from, to)}.` +
    noCost(features)
  )
}

export function categoryLede(features: ProjectFeature[]): string {
  const total = sumAmount(features)
  const rows = CATEGORIES.map((c) => ({
    label: c.label,
    amount: sumAmount(features.filter((f) => f.properties.category === c.key)),
  })).sort((a, b) => b.amount - a.amount)
  const part = share(rows[0].amount, total)
  if (part === null) return 'No contract cost is on record for these contracts.'
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
  const land = `${when[0].toUpperCase()}${when.slice(1)}, about ${formatHa(sumLoss(loss, from, to))} of tree cover loss was recorded here. `
  if (features.length === 0) {
    return `${land}No DPWH flood control contracts appear in this data here in the same period.`
  }
  return (
    `${land}In the same period, ${plural(features.length, 'DPWH flood control contract')} with a contract cost of ` +
    `${formatPhp(sumAmount(features))} ${features.length === 1 ? 'was' : 'were'} sited here.`
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
        `${formatPhp(sumAmount(inYear))} ${inYear.length === 1 ? 'carries' : 'carry'} this infrastructure year here.`
  return `In ${year}, ${land}. ${money}${flagNote([row?.quality_flag])}`
}

export function zoneFinding(
  upLoss: number,
  loss: number,
  upAmount: number,
  amount: number,
): string {
  const land = share(upLoss, loss)
  const money = share(upAmount, amount)
  const parts = [
    land && `${land} of the basin's tree cover loss`,
    money && `${money} of the basin's DPWH flood control contract cost`,
  ].filter(Boolean)
  if (parts.length === 0) return 'Neither zone has recorded loss or contract cost in these years.'
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
  const mean = full.reduce((t, r) => t + (r.value ?? 0), 0) / full.length
  if (full.length === 1) {
    return `CHIRPS estimates about ${formatMm(mean)} of rain here in ${years[0]}, the only complete year loaded.`
  }
  return `CHIRPS estimates about ${formatMm(mean)} of rain a year here, as the mean of the complete years from ${Math.min(...years)} to ${Math.max(...years)}.`
}

export function wettestYear(rows: MetricRow[]): MetricRow | null {
  return fullRainYears(rows).reduce<MetricRow | null>(
    (best, r) => (best === null || (r.value ?? 0) > (best.value ?? 0) ? r : best),
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

// Where contracts were sited, by the municipality DPWH lists.

/** How many places get their own bar before the rest are grouped. */
export const PLACES_SHOWN = 10

export interface PlaceRow {
  label: string
  count: number
  amount: number
  /** True when no contract in the group has a contract cost on record. */
  noCost: boolean
}

export interface Places {
  top: PlaceRow[]
  /** The named places after the first PLACES_SHOWN, as one row. Null when there are none. */
  rest: (PlaceRow & { places: number }) | null
  /** Contracts with no municipality on record. Null when every contract has one. */
  unnamed: PlaceRow | null
  named: number
}

const SMALL_WORDS = new Set(['of', 'and', 'de', 'del', 'la', 'ng'])

/** "CITY OF MANILA (METROPOLITAN MANILA)" becomes "City of Manila (Metropolitan Manila)". */
export function placeName(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[a-z]+/g, (word: string, at: number) =>
      at > 0 && SMALL_WORDS.has(word) ? word : `${word[0].toUpperCase()}${word.slice(1)}`,
    )
}

const placeGroup = (label: string, rows: ProjectFeature[]): PlaceRow => ({
  label,
  count: rows.length,
  amount: sumAmount(rows),
  noCost: rows.every((f) => f.properties.amount_php == null),
})

/**
 * Contracts grouped by municipality, largest contract cost first. The province field is not
 * used: in this data it holds the DPWH district engineering office.
 */
export function placeRows(features: ProjectFeature[]): Places {
  const byPlace = new Map<string, { label: string; rows: ProjectFeature[] }>()
  const unnamed: ProjectFeature[] = []
  for (const f of features) {
    const raw = f.properties.municipality?.trim()
    if (!raw) {
      unnamed.push(f)
      continue
    }
    const key = raw.toLowerCase()
    const entry = byPlace.get(key) ?? { label: placeName(raw), rows: [] }
    entry.rows.push(f)
    byPlace.set(key, entry)
  }
  const named = [...byPlace.values()]
    .map((p) => placeGroup(p.label, p.rows))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label))
  const tail = named.slice(PLACES_SHOWN)
  return {
    top: named.slice(0, PLACES_SHOWN),
    rest:
      tail.length === 0
        ? null
        : {
            label: plural(tail.length, 'other place'),
            count: tail.reduce((t, p) => t + p.count, 0),
            amount: tail.reduce((t, p) => t + p.amount, 0),
            noCost: tail.every((p) => p.noCost),
            places: tail.length,
          },
    unnamed: unnamed.length === 0 ? null : placeGroup('No municipality on record', unnamed),
    named: features.length - unnamed.length,
  }
}

export function placeLede(features: ProjectFeature[]): string {
  const total = features.length
  if (total === 0) return 'No DPWH flood control contracts appear in this data here.'
  const places = placeRows(features)
  if (places.named === 0) {
    return `No municipality is on record for any of the ${plural(total, 'contract')} here.`
  }
  const listed =
    places.named === total
      ? 'A municipality is on record for every contract here.'
      : `A municipality is on record for ${places.named.toLocaleString('en-PH')} of ${plural(total, 'contract')} here.`
  const top = places.top[0]
  const namedCost = places.top.reduce((t, p) => t + p.amount, 0) + (places.rest?.amount ?? 0)
  const part = share(top.amount, namedCost)
  if (part === null) {
    return `${listed} ${top.label} holds the most of them, ${plural(top.count, 'contract')}. No contract cost is on record for them.`
  }
  return `${listed} Among them, the largest share of contract cost is sited in ${top.label}: ${formatPhp(top.amount)}, ${part} of the contract cost with a municipality on record.`
}

/** Contract cost and count in the two zones, the same rows the zone bars draw. */
export function zoneSpendLede(up: ProjectFeature[], down: ProjectFeature[], from: number, to: number): string {
  const both = up.length + down.length
  if (both === 0) return `No DPWH flood control contracts are sited in either zone ${span(from, to)}.`
  const cost = share(sumAmount(up), sumAmount(up) + sumAmount(down))
  const count = `${up.length.toLocaleString('en-PH')} of the ${plural(both, 'contract')} in the two zones`
  return cost === null
    ? `Upstream holds ${count} ${span(from, to)}. No contract cost is on record for them.`
    : `Upstream holds ${count} and ${cost} of their contract cost ${span(from, to)}.`
}

// How often heavy rain fell. A heavy rain day is a day when the area mean was 50 mm or more.

const metricRows = (rows: MetricRow[], metric: string) =>
  rows.filter((r) => r.metric === metric && r.value !== null).sort((a, b) => a.year - b.year)

/** Complete years of heavy rain day counts. A partial year is a lower bound and is left out. */
export function fullHeavyYears(rows: MetricRow[]): MetricRow[] {
  return metricRows(rows, 'heavy_rain_days').filter((r) => r.quality_flag !== 'partial_year')
}

/** The smallest group of years compared. A group of fewer years is not compared. */
export const MIN_GROUP_YEARS = 3

/** The complete years split into two equal groups. With an odd count the middle year is in neither. */
export function heavyHalves(
  rows: MetricRow[],
): { first: MetricRow[]; second: MetricRow[]; middle: number | null } | null {
  const full = fullHeavyYears(rows)
  const half = Math.floor(full.length / 2)
  if (half < MIN_GROUP_YEARS) return null
  return {
    first: full.slice(0, half),
    second: full.slice(full.length - half),
    middle: full.length % 2 === 1 ? full[half].year : null,
  }
}

const meanOf = (rows: MetricRow[]) => rows.reduce((t, r) => t + (r.value ?? 0), 0) / rows.length

/** "about 4.2 days a year", and never "about 0.0" for a mean above zero. */
export function daysAYear(mean: number): string {
  if (mean === 0) return 'on no day in any year'
  if (mean < 0.05) return 'on less than 0.1 days a year'
  return `on about ${mean.toLocaleString('en-PH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} days a year`
}

const yearsOf = (rows: MetricRow[]) => `${rows[0].year} to ${rows[rows.length - 1].year}`

export function heavyRainLede(rows: MetricRow[], place = 'here'): string {
  const full = fullHeavyYears(rows)
  if (full.length === 0) return 'No complete year of heavy rain day counts is loaded for this area yet.'
  const halves = heavyHalves(rows)
  if (halves === null) {
    return `The area mean reached 50 mm or more ${daysAYear(meanOf(full))} ${place}, as the mean of the complete years ${span(full[0].year, full[full.length - 1].year)}.`
  }
  return (
    `The area mean reached 50 mm or more ${daysAYear(meanOf(halves.first))} ${place} from ${yearsOf(halves.first)}, ` +
    `and ${daysAYear(meanOf(halves.second))} from ${yearsOf(halves.second)}.`
  )
}

/** The note on the two groups of years: which year is in neither, when the count is odd. */
export function heavyGroupsNote(rows: MetricRow[]): string | null {
  const halves = heavyHalves(rows)
  if (halves === null) return null
  return (
    `The two groups hold ${plural(halves.first.length, 'complete year')} each.` +
    (halves.middle === null ? '' : ` ${halves.middle}, the middle year, is in neither group.`) +
    ' Compare the groups, not single years.'
  )
}

/** The line under the heavy rain chart. With no year in focus it reads the wettest day on record. */
export function heavyRainLine(rows: MetricRow[], year: number | null): string {
  if (year !== null) return rainLine(rows, year)
  const max = metricRows(rows, 'rainfall_max_1day').filter((r) => r.quality_flag !== 'partial_year')
  if (max.length === 0) return 'No complete year of daily rainfall is loaded.'
  const top = max.reduce((best, r) => ((r.value ?? 0) > (best.value ?? 0) ? r : best))
  return `The wettest day in the complete years had an area mean of about ${formatMm(top.value ?? 0)}, in ${top.year}. Point at a year to read its count and its wettest day.`
}

export function heavyRainAlt(rows: MetricRow[]): string {
  const days = metricRows(rows, 'heavy_rain_days')
  if (days.length === 0) return 'Bar chart of heavy rain days per year. No rows yet.'
  const partial = days.filter((r) => r.quality_flag === 'partial_year').map((r) => r.year)
  return (
    `Bar chart of days per year when the area mean was 50 mm or more, ${days[0].year} to ${days[days.length - 1].year}. ` +
    heavyRainLede(rows) +
    (partial.length > 0 ? ` ${partial.join(', ')} is not complete.` : '')
  )
}

/** Contracts with no municipality on record, as a line under the place bars. Null when there are none. */
export function unnamedPlaceLine(places: Places): string | null {
  const row = places.unnamed
  if (row === null) return null
  return (
    `${plural(row.count, 'contract')} ${row.count === 1 ? 'has' : 'have'} no municipality on record` +
    (row.noCost ? ', and no contract cost on record.' : `, with a contract cost of ${formatPhp(row.amount)}.`) +
    ' They are not drawn as a bar.'
  )
}

// Which DPWH office a contract is listed under. In this data the province field holds the DPWH
// office: district engineering offices, a few region names, and the Flood Control Management
// Cluster. No value in it is a province.

/** True for a value that names a region rather than an office, such as "Region III". */
export const isRegionName = (value: string) => /\bregion\b/i.test(value)

export interface Offices {
  top: PlaceRow[]
  rest: (PlaceRow & { places: number }) | null
  /** Contracts with no office on record. Null when every contract has one. */
  unlisted: PlaceRow | null
  offices: number
  regions: number
  /** Contracts listed under a region name. */
  regionContracts: number
}

/** Contracts grouped by the office DPWH lists, largest contract cost first, as listed. */
export function officeRows(features: ProjectFeature[]): Offices {
  const byOffice = new Map<string, ProjectFeature[]>()
  const unlisted: ProjectFeature[] = []
  for (const f of features) {
    const office = f.properties.province?.trim().replace(/\s+/g, ' ')
    if (!office) {
      unlisted.push(f)
      continue
    }
    byOffice.set(office, [...(byOffice.get(office) ?? []), f])
  }
  const all = [...byOffice.entries()]
    .map(([label, rows]) => placeGroup(label, rows))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label))
  const tail = all.slice(PLACES_SHOWN)
  const regions = all.filter((o) => isRegionName(o.label))
  return {
    top: all.slice(0, PLACES_SHOWN),
    rest:
      tail.length === 0
        ? null
        : {
            label: `${tail.length.toLocaleString('en-PH')} other ${tail.length === 1 ? 'office or region' : 'offices and regions'}`,
            count: tail.reduce((t, o) => t + o.count, 0),
            amount: tail.reduce((t, o) => t + o.amount, 0),
            noCost: tail.every((o) => o.noCost),
            places: tail.length,
          },
    unlisted: unlisted.length === 0 ? null : placeGroup('No office on record', unlisted),
    offices: all.length - regions.length,
    regions: regions.length,
    regionContracts: regions.reduce((t, o) => t + o.count, 0),
  }
}

/** "16 DPWH offices and 2 region names" */
function officeCount(o: Offices): string {
  const parts = [
    o.offices > 0 && `${o.offices.toLocaleString('en-PH')} DPWH ${o.offices === 1 ? 'office' : 'offices'}`,
    o.regions > 0 && `${o.regions.toLocaleString('en-PH')} region ${o.regions === 1 ? 'name' : 'names'}`,
  ].filter(Boolean)
  return parts.join(' and ')
}

export function officeLede(features: ProjectFeature[]): string {
  if (features.length === 0) return 'No DPWH flood control contracts appear in this data here.'
  const o = officeRows(features)
  if (o.top.length === 0) return 'No DPWH office is on record for these contracts.'
  const top = o.top[0]
  const listed = `The contracts here are listed under ${officeCount(o)}.`
  const listedCost = o.top.reduce((t, r) => t + r.amount, 0) + (o.rest?.amount ?? 0)
  const part = share(top.amount, listedCost)
  if (part === null) {
    return `${listed} ${top.label} holds the most of them, ${plural(top.count, 'contract')}. No contract cost is on record for them.`
  }
  return `${listed} ${top.label} holds the largest share of the contract cost here: ${formatPhp(top.amount)}, ${part}, on ${plural(top.count, 'contract')}.`
}

/** The note on region names and on contracts with no office. Null when neither applies. */
export function officeNote(features: ProjectFeature[]): string | null {
  const o = officeRows(features)
  const parts = [
    o.regionContracts > 0 &&
      `${plural(o.regionContracts, 'contract')} ${o.regionContracts === 1 ? 'lists' : 'list'} a region name rather than an office. ${o.regionContracts === 1 ? 'It is' : 'They are'} shown as DPWH lists ${o.regionContracts === 1 ? 'it' : 'them'}.`,
    o.unlisted &&
      `${plural(o.unlisted.count, 'contract')} ${o.unlisted.count === 1 ? 'has' : 'have'} no office on record and ${o.unlisted.count === 1 ? 'is' : 'are'} not drawn as a bar.`,
  ].filter(Boolean)
  return parts.length === 0 ? null : parts.join(' ')
}
