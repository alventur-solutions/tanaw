// The review lists of the "For review" tab. Each rule is a small pure function: the contracts of
// one study area go in, a list comes out. A list is a prompt to look. It is never a finding about
// a contract or a contractor, so no rule reads or ranks the contractor field.
import { CATEGORIES } from './api'
import type { ProjectFeature } from './api'
import { listOr, plural, span } from './story'

// Thresholds. Change them here and every sentence that states them follows.
/** Rule 2: an on-going contract is listed when its infrastructure year is this many years back or more. */
export const ONGOING_MIN_AGE_YEARS = 2
/** Rule 3: a not yet started contract is listed when its infrastructure year is this many years back or more. */
export const NOT_STARTED_MIN_AGE_YEARS = 1
/** Rule 4: an on-going contract is listed when its reported progress equals this. */
export const FULL_PROGRESS_PCT = 100
/** Rule 5: how many of the largest completed contracts are listed. */
export const LARGEST_COMPLETED_COUNT = 10
/** Context note: a mapped point is counted when it holds this many contracts or more. */
export const POINT_MIN_CONTRACTS = 3
/** Context note: coordinates are matched after rounding to this many decimal places. */
export const POINT_DECIMALS = 4
/** Rows shown before the "Show all" control. */
export const ROWS_SHOWN = 5

// Status values as DPWH writes them. Compared without case or outer spaces.
export const STATUS_TERMINATED = 'Terminated'
export const STATUS_ONGOING = 'On-Going'
export const STATUS_NOT_STARTED = 'Not Yet Started'
export const STATUS_COMPLETED = 'Completed'
export const FLAG_ESTIMATE = 'category_from_description'

/** The list that is ranked by size. The other lists are reported-status lists. */
export const LARGEST_KEY = 'largest_completed'

// The office a reviewer asks. The long form is used once per block.
const OFFICE_FULL =
  'the DPWH implementing office for the contract (district engineering office, regional office, or project management office)'
const OFFICE = 'the DPWH implementing office'

export const NO_COST_NOTE = 'No contract cost on record.'

// Reading notes shared by more than one list. Each travels with its list on screen and in the CSV.
export const COST_CAVEAT =
  'Contract cost is the contract budget listed by DPWH. This data does not show what was paid.'
export const STATUS_CAVEAT = 'Status is as DPWH reports it and may be out of date.'
export const DOWNLOAD_CAVEAT =
  'The DPWH data is a download, not a live feed. Its status may have changed since.'
const YEAR_CAVEAT = 'The infrastructure year is the DPWH funding year. It can differ from the year work started.'
const COMPLETION_DATE_CAVEAT = 'The completion date in the DPWH record can be the scheduled one.'

/** The framing every CSV row carries, so a row read on its own keeps its limits. */
export const CSV_FRAMING =
  'Being on this list is a prompt to look. It is not a finding about the contract or the contractor. ' +
  'Status, progress, and dates are as reported by DPWH and were not checked on site. ' +
  'Contract cost is the contract budget listed by DPWH, and this data does not show what was paid. ' +
  'The completion date can be the scheduled one. ' +
  'A contract on two lists has two rows, and a contract appears in every study area it falls in, so do not add rows or files together.'

export interface ReviewList {
  key: string
  label: string
  /** The rule in words: why a contract is on this list. */
  why: string
  /** What to check, and with whom. */
  check: string
  /** The reading notes that travel with this list. Joined, they open the CSV "reading_note" column. */
  caveats: string[]
  /** Matching contracts, largest contract cost first. */
  rows: ProjectFeature[]
  /** Notes on single rows, keyed by component_id. They are the CSV "note" column. */
  notes: Record<string, string[]>
}

const hasStatus = (f: ProjectFeature, status: string) =>
  (f.properties.status ?? '').trim().toLowerCase() === status.toLowerCase()

/** True when the infrastructure year is a number and is at least `age` years before the current year. */
const yearAtLeast = (f: ProjectFeature, currentYear: number, age: number) =>
  Number.isFinite(f.properties.year) && f.properties.year <= currentYear - age

export const contractId = (f: ProjectFeature) => f.properties.contract_id ?? f.properties.component_id

/** Largest contract cost first. A contract with no cost on record sorts last. */
export function byCost(a: ProjectFeature, b: ProjectFeature): number {
  const x = a.properties.amount_php
  const y = b.properties.amount_php
  if (x == null && y == null) return a.properties.component_id.localeCompare(b.properties.component_id)
  if (x == null) return 1
  if (y == null) return -1
  return y - x || a.properties.component_id.localeCompare(b.properties.component_id)
}

/** "this contract" for a list of one, so a sentence about the list reads true. */
const these = (rows: ProjectFeature[]) => (rows.length === 1 ? 'this contract' : 'these contracts')
const their = (rows: ProjectFeature[]) => (rows.length === 1 ? 'its' : 'their')

/** "2024 or earlier" */
const orEarlier = (currentYear: number, age: number) => `${currentYear - age} or earlier`

/** The no-cost note for every row that has no contract cost, whichever list holds it. */
function costNotes(rows: ProjectFeature[]): Record<string, string[]> {
  const notes: Record<string, string[]> = {}
  for (const f of rows) {
    if (f.properties.amount_php == null) notes[f.properties.component_id] = [NO_COST_NOTE]
  }
  return notes
}

/**
 * The description as lower case letters and digits, single spaced. Punctuation is dropped, since
 * the source writes one description as "PHASE 1," in one row and "PHASE 1" in another. Empty when
 * there is no description. For a strict match (trim, collapse spaces, lower case) swap the
 * pattern for /\s+/g.
 */
export const DESCRIPTION_SEPARATORS = /[^a-z0-9]+/g
export const normalDescription = (f: ProjectFeature) =>
  (f.properties.description ?? '').toLowerCase().replace(DESCRIPTION_SEPARATORS, ' ').trim()

/** Other contracts whose description reads the same, under another contract ID. A text match. */
export function sameDescription(row: ProjectFeature, features: ProjectFeature[]): ProjectFeature[] {
  const text = normalDescription(row)
  if (text === '') return []
  const seen = new Set([contractId(row)])
  return features.filter((f) => {
    if (normalDescription(f) !== text || seen.has(contractId(f))) return false
    seen.add(contractId(f))
    return true
  })
}

/** "a, b, and c" */
function listAnd(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/** The note on a terminated row. It states a text match and never says the work was re-awarded. */
export function sameDescriptionNote(matches: ProjectFeature[]): string | null {
  if (matches.length === 0) return null
  const named = matches.map(
    (f) =>
      `${contractId(f)} (${f.properties.status ? `reported status ${f.properties.status}` : 'no status on record'})`,
  )
  const one = matches.length === 1
  return (
    `The description text matches ${one ? 'contract' : 'contracts'} ${listAnd(named)}. ` +
    `This is a text match only. The DPWH data does not link ${one ? 'the two' : 'these'} contracts.`
  )
}

/** How many rows of a list hold a date, for the lists where the date matters. Rows must not be empty. */
function dateCaveat(rows: ProjectFeature[], field: 'start_date' | 'completion_date', name: string): string {
  const held = rows.filter((f) => f.properties[field] != null).length
  if (held === 0) {
    return `No ${name} is on record for ${rows.length === 1 ? 'this contract' : 'these contracts'}, so this data says nothing about ${rows.length === 1 ? 'its' : 'their'} schedule.`
  }
  return `A ${name} is on record for ${held.toLocaleString('en-PH')} of ${plural(rows.length, 'contract')} on this list. It can be the scheduled date.`
}

/** Rule 1. Reported status is "Terminated". */
export function terminatedList(features: ProjectFeature[]): ReviewList {
  const rows = features.filter((f) => hasStatus(f, STATUS_TERMINATED)).sort(byCost)
  const notes = costNotes(rows)
  // Descriptions are indexed once, so a long list does not scan the area for every row.
  const byText = new Map<string, ProjectFeature[]>()
  for (const f of features) {
    const text = normalDescription(f)
    if (text !== '') byText.set(text, [...(byText.get(text) ?? []), f])
  }
  for (const row of rows) {
    const lead = sameDescriptionNote(sameDescription(row, byText.get(normalDescription(row)) ?? []))
    if (lead) notes[row.properties.component_id] = [...(notes[row.properties.component_id] ?? []), lead]
  }
  return {
    key: 'terminated',
    label: 'Reported as terminated',
    why: `DPWH reports the status of ${these(rows)} as "${STATUS_TERMINATED}".`,
    check: `Ask ${OFFICE_FULL} for the reason and date of the termination, and whether the work was re-awarded or completed under another contract.`,
    caveats: [
      'The DPWH data gives no reason and no date for a termination.',
      `${COMPLETION_DATE_CAVEAT} On a terminated contract it is not the termination date.`,
      'Reported progress on these rows is as listed by DPWH. It says nothing about what was built.',
      'A matching description is a match of the text alone, with punctuation and spacing set aside. It is a starting point for asking whether the work continued under another contract. It does not show that it did.',
      'Where no contract cost is shown, the DPWH source lists it as 0. TANAW treats that as no cost on record. It does not mean the contract had no cost.',
      COST_CAVEAT,
    ],
    rows,
    notes,
  }
}

/** Rule 2. Reported status is "On-Going" and the infrastructure year is at least ONGOING_MIN_AGE_YEARS back. */
export function ongoingEarlierList(features: ProjectFeature[], currentYear: number): ReviewList {
  const rows = features
    .filter((f) => hasStatus(f, STATUS_ONGOING) && yearAtLeast(f, currentYear, ONGOING_MIN_AGE_YEARS))
    .sort(byCost)
  return {
    key: 'ongoing_earlier_year',
    label: 'Reported as on-going from an earlier infrastructure year',
    why: `DPWH reports the status of ${these(rows)} as "${STATUS_ONGOING}", and ${their(rows)} infrastructure year is ${orEarlier(currentYear, ONGOING_MIN_AGE_YEARS)}.`,
    check: `Ask ${OFFICE_FULL} for the current status of the work and its scheduled completion date.`,
    caveats: [
      `A contract can run for more than one year, so an on-going status from an earlier infrastructure year is expected for some contracts. ${STATUS_CAVEAT}`,
      DOWNLOAD_CAVEAT,
      ...(rows.length === 0 ? [] : [dateCaveat(rows, 'completion_date', 'completion date')]),
      YEAR_CAVEAT,
      COST_CAVEAT,
    ],
    rows,
    notes: costNotes(rows),
  }
}

/** Rule 3. Reported status is "Not Yet Started" and the infrastructure year is before the current year. */
export function notStartedEarlierList(features: ProjectFeature[], currentYear: number): ReviewList {
  const rows = features
    .filter((f) => hasStatus(f, STATUS_NOT_STARTED) && yearAtLeast(f, currentYear, NOT_STARTED_MIN_AGE_YEARS))
    .sort(byCost)
  return {
    key: 'not_started_earlier_year',
    label: 'Reported as not yet started from an earlier infrastructure year',
    why: `DPWH reports the status of ${these(rows)} as "${STATUS_NOT_STARTED}", and ${their(rows)} infrastructure year is ${orEarlier(currentYear, NOT_STARTED_MIN_AGE_YEARS)}.`,
    check: `Ask ${OFFICE_FULL} for the current status of the work and its start date.`,
    caveats: [
      STATUS_CAVEAT,
      DOWNLOAD_CAVEAT,
      ...(rows.length === 0 ? [] : [dateCaveat(rows, 'start_date', 'start date')]),
      YEAR_CAVEAT,
      COST_CAVEAT,
    ],
    rows,
    notes: costNotes(rows),
  }
}

/** Rule 4. Reported status is "On-Going" and reported progress equals FULL_PROGRESS_PCT. */
export function ongoingFullProgressList(features: ProjectFeature[]): ReviewList {
  const rows = features
    .filter((f) => hasStatus(f, STATUS_ONGOING) && f.properties.progress_pct === FULL_PROGRESS_PCT)
    .sort(byCost)
  return {
    key: 'ongoing_full_progress',
    label: `Reported status on-going, reported progress ${FULL_PROGRESS_PCT} percent`,
    why: `DPWH reports the status of ${these(rows)} as "${STATUS_ONGOING}" and ${their(rows)} progress as ${FULL_PROGRESS_PCT} percent.`,
    check: `Ask ${OFFICE_FULL} whether close-out is pending.`,
    caveats: [
      'Two fields of the DPWH record read this way together. It may be a close-out step that is not recorded in this data. It is not a finding about the project.',
      STATUS_CAVEAT,
      COST_CAVEAT,
    ],
    rows,
    notes: costNotes(rows),
  }
}

/** Rule 5. The LARGEST_COMPLETED_COUNT largest contracts by contract cost with reported status "Completed". */
export function largestCompletedList(features: ProjectFeature[]): ReviewList {
  const rows = features
    .filter((f) => hasStatus(f, STATUS_COMPLETED) && f.properties.amount_php != null)
    .sort(byCost)
    .slice(0, LARGEST_COMPLETED_COUNT)
  return {
    key: LARGEST_KEY,
    label: 'Largest contracts reported as completed',
    why:
      rows.length === 0
        ? 'No contracts match in this data.'
        : rows.length === 1
          ? `This is the largest contract by contract cost that DPWH reports as "${STATUS_COMPLETED}" in this area.`
          : `These are the ${rows.length.toLocaleString('en-PH')} largest contracts by contract cost that DPWH reports as "${STATUS_COMPLETED}" in this area.`,
    check: `Ask ${OFFICE} for the completion report. Then look at the site and the land around it in the imagery, and on the ground with the LGU engineering office or the DRRM office.`,
    caveats: [
      'This list is ranked by contract cost alone. Size is the only reason a contract is on it.',
      COST_CAVEAT,
      COMPLETION_DATE_CAVEAT,
      'The mapped point is the site as given by DPWH. The two DPWH files give different sites for many contracts, so the point can be off.',
      'The infrastructure year can differ from the year of construction, so compare imagery over several years.',
      'Narrow or small structures can be built and be hard to see from above.',
    ],
    rows,
    notes: {},
  }
}

/** Rules 1 to 5 in display order. Rule 6 is a count, see estimateLine. */
export function reviewLists(features: ProjectFeature[], currentYear: number): ReviewList[] {
  return [
    terminatedList(features),
    ongoingEarlierList(features, currentYear),
    notStartedEarlierList(features, currentYear),
    ongoingFullProgressList(features),
    largestCompletedList(features),
  ]
}

/** Mapped points that hold POINT_MIN_CONTRACTS or more contracts, coordinates rounded to POINT_DECIMALS. */
export function sharedPointCount(features: ProjectFeature[]): number {
  const counts = new Map<string, number>()
  for (const f of features) {
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (typeof lon !== 'number' || typeof lat !== 'number') continue
    const key = `${lat.toFixed(POINT_DECIMALS)},${lon.toFixed(POINT_DECIMALS)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].filter((count) => count >= POINT_MIN_CONTRACTS).length
}

/** Context, not a review list: several contracts at one mapped point. Null when no point qualifies. */
export function sharedPointLine(features: ProjectFeature[]): string | null {
  const points = sharedPointCount(features)
  if (points === 0) return null
  return (
    `${plural(points, 'mapped point')} here ${points === 1 ? 'holds' : 'each hold'} ${POINT_MIN_CONTRACTS} or more contracts ` +
    `whose coordinates match to ${POINT_DECIMALS} decimal places. Phased or packaged work can share a point. ` +
    'The point is the project site as given by DPWH, and the two DPWH files give different sites for many contracts. ' +
    'These contracts are not a review list.'
  )
}

/** Contracts on at least one of the lists given. A contract on two lists counts once. */
export function listedCount(lists: ReviewList[]): number {
  return new Set(lists.flatMap((l) => l.rows.map((f) => f.properties.component_id))).size
}

/**
 * The opening lede: how many contracts match a reported-status list, out of how many, in which
 * years. The largest completed contracts are named apart, since size is their one reason.
 */
export function reviewLede(lists: ReviewList[], features: ProjectFeature[], from: number, to: number): string {
  const total = features.length
  const when = span(from, to)
  if (total === 0) return `No DPWH flood control contracts appear in this data here ${when}.`
  const listed = listedCount(lists.filter((l) => l.key !== LARGEST_KEY))
  const largest = lists.find((l) => l.key === LARGEST_KEY)?.rows.length ?? 0
  const whole = `${plural(total, 'DPWH flood control contract')} sited here ${when}`
  const status =
    listed === 0
      ? total === 1
        ? `The single DPWH flood control contract sited here ${when} matches no reported-status list in this data.`
        : `None of the ${whole} match a reported-status list in this data.`
      : `${listed.toLocaleString('en-PH')} of ${whole} ${listed === 1 ? 'matches' : 'match'} a reported-status list below.`
  const size =
    largest === 0
      ? ''
      : largest === 1
        ? ' The largest completed contract is listed separately, by size alone.'
        : ` The ${largest.toLocaleString('en-PH')} largest completed contracts are listed separately, by size alone.`
  const framing =
    listed === 0 && largest === 0 ? '' : ' A list is a prompt to look, not a finding about a contract.'
  return `${status}${size}${framing}`
}

/** The count of one list, and how many of its rows hold a contract cost. No peso total is stated. */
export function listCountLine(list: ReviewList): string {
  const count = list.rows.length
  if (count === 0) return 'No contracts match in this data.'
  const costed = list.rows.filter((f) => f.properties.amount_php != null).length
  const base = `${plural(count, 'contract')} ${count === 1 ? 'is' : 'are'} on this list.`
  if (costed === count) return base
  if (costed === 0) return `${base} No contract cost is on record for ${count === 1 ? 'it' : 'them'}.`
  return `${base} A contract cost is on record for ${costed.toLocaleString('en-PH')} of them.`
}

/** "44.2 percent", or null when no progress is on record. A value that is not whole keeps one decimal and is never rounded up. */
export function progressValue(f: ProjectFeature): string | null {
  const pct = f.properties.progress_pct
  if (pct == null || !Number.isFinite(pct)) return null
  if (Number.isInteger(pct)) return `${pct.toFixed(0)} percent`
  const tenths = Math.floor(pct * 10)
  // A value above zero is never printed as zero.
  if (tenths === 0 && pct > 0) return `less than ${(1 / 10).toFixed(1)} percent`
  return `${(tenths / 10).toFixed(1)} percent`
}

/** One contract's reported progress, as a phrase for a row on screen. */
export function progressText(f: ProjectFeature): string {
  const value = progressValue(f)
  return value === null ? 'No reported progress on record' : `Reported progress ${value}`
}

/** A description cut at a word for a table cell on paper. The full text is in the CSV file. */
export function shortText(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:/(-]+$/, '')}...`
}

/** The line under a capped table: how many contracts of the list are not printed. Null when all are. */
export function moreInCsvLine(list: ReviewList, shown: number): string | null {
  const more = list.rows.length - shown
  if (more <= 0) return null
  return `Largest ${plural(shown, 'contract')} by contract cost shown, and ${more.toLocaleString('en-PH')} more in the CSV file.`
}

/** Alt text for the bar list of contracts per review list. */
export function reviewAlt(lists: ReviewList[]): string {
  const top = [...lists].sort((a, b) => b.rows.length - a.rows.length)[0]
  if (!top || top.rows.length === 0) return 'Bar list of contracts per review list. No contracts match.'
  return `Bar list of contracts per review list. The longest list is "${top.label}" with ${plural(top.rows.length, 'contract')}.`
}

/** Rule 6. How many contracts carry a type of work read from the description. Null when none do. */
export function estimateLine(features: ProjectFeature[]): string | null {
  const count = features.filter((f) => f.properties.quality_flag === FLAG_ESTIMATE).length
  if (count === 0) return null
  return (
    `${count.toLocaleString('en-PH')} of ${plural(features.length, 'contract')} here ` +
    `${count === 1 ? 'lists' : 'list'} no type of work in the source. ` +
    `${count === 1 ? 'Its' : 'Their'} category is read from the contract description and is an estimate.`
  )
}

const ESTIMATE_ASK = `Read the contract description, or ask ${OFFICE} for the program of work,`
export const ESTIMATE_CHECK = `${ESTIMATE_ASK} before reading the bars by type of work in the Funding tab.`
/** The same check on paper, where the types of work are a table. */
export const ESTIMATE_CHECK_PRINT = `${ESTIMATE_ASK} before reading the table by type of work.`

/** Named types of work with no contract here, as a check against other records. Null when all appear. */
export function otherRecordsLine(features: ProjectFeature[], from: number, to: number): string | null {
  const absent = CATEGORIES.filter(
    (c) => c.key !== 'other' && !features.some((f) => f.properties.category === c.key),
  ).map((c) => c.label.toLowerCase())
  if (absent.length === 0) return null
  return (
    `No ${listOr(absent)} contracts appear in the DPWH data here ${span(from, to)}. ` +
    'DENR, LGU, or other agency records may hold that work. Categories are partly estimates read from contract descriptions.'
  )
}

// CSV export. One row per contract per list, so a contract on two lists has two rows.
export const CSV_COLUMNS = [
  'area_id',
  'area_name',
  'review_list',
  'why_listed',
  'what_to_check',
  'contract_id',
  'description',
  'infrastructure_year',
  'category',
  'category_quality_flag',
  'reported_status',
  'reported_progress_pct',
  'contract_cost_php',
  'completion_date_scheduled_or_actual',
  'site_latitude',
  'site_longitude',
  'implementing_office_as_listed',
  'note',
  'reading_note',
  'exported_on',
] as const

/** Text that a spreadsheet would run as a formula is given a leading apostrophe. */
const plainText = (value: string) => (/^\s*[=+\-@]/.test(value) ? `'${value}` : value)

/** One CSV field. Quoted when it holds a comma, a quote, or a line break. Quotes are doubled. */
export function csvField(value: string | number | null | undefined): string {
  if (value == null) return ''
  const text = typeof value === 'number' ? String(value) : plainText(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** YYYY-MM-DD, with the local date. */
export function isoDate(today: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${today.getFullYear()}-${two(today.getMonth() + 1)}-${two(today.getDate())}`
}

export function reviewCsv(lists: ReviewList[], areaId: string, areaName: string, today: Date): string {
  const exported = isoDate(today)
  const lines = [CSV_COLUMNS.join(',')]
  for (const list of lists) {
    // The framing states what contract cost means, so the list's own copy is not repeated.
    const reading = [...list.caveats.filter((caveat) => caveat !== COST_CAVEAT), CSV_FRAMING].join(' ')
    for (const f of list.rows) {
      const p = f.properties
      const [lon, lat] = f.geometry?.coordinates ?? []
      lines.push(
        [
          areaId,
          areaName,
          list.label,
          list.why,
          list.check,
          contractId(f),
          p.description,
          p.year,
          p.category,
          p.quality_flag,
          p.status,
          p.progress_pct,
          p.amount_php,
          p.completion_date,
          lat,
          lon,
          p.province,
          (list.notes[p.component_id] ?? []).join(' '),
          reading,
          exported,
        ]
          .map(csvField)
          .join(','),
      )
    }
  }
  return `${lines.join('\r\n')}\r\n`
}

/** tanaw-review-<area_id>-<YYYY-MM-DD>.csv, with the local date. */
export function reviewFileName(areaId: string, today: Date): string {
  return `tanaw-review-${areaId}-${isoDate(today)}.csv`
}
