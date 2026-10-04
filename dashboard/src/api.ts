export type StudyType = 'river_basin' | 'rural_upland' | 'urban'
export type Category = 'drainage' | 'river_structure' | 'slope_protection' | 'pumping' | 'other'

export interface AreaProps {
  area_id: string
  name: string
  study_type: StudyType
  zone: 'up' | 'down' | null
  area_ha: number
  // Overview fields from GET /areas. Absent on zone features.
  bbox?: [number, number, number, number]
  has_zones?: boolean
  // False means the rows are not loaded yet. It never means a measured zero.
  metrics_loaded?: boolean
  projects_linked?: boolean
}

export interface AreaFeature {
  type: 'Feature'
  id: string
  properties: AreaProps
  geometry: GeoJSON.Geometry
}

export interface MetricRow {
  area_id: string
  year: number
  metric: string
  value: number | null
  quality_flag: string
  source_version: string | null
}

export interface ProjectProps {
  component_id: string
  project_id: string | null
  contract_id: string | null
  year: number
  category: Category
  type_of_work: string | null
  description: string | null
  status: string | null
  progress_pct: number | null
  quality_flag: string | null
  amount_php: number | null
  abc_php: number | null
  contractor: string | null
  municipality: string | null
  province: string | null
  start_date: string | null
  completion_date: string | null
}

export interface ProjectFeature {
  type: 'Feature'
  properties: ProjectProps
  geometry: { type: 'Point'; coordinates: [number, number] }
  // Study areas the site is linked to. Only on a record from GET /projects/{id}.
  area_ids?: string[]
}

// A project site on the map. The full record is fetched when the point is selected.
export interface PointFeature {
  type: 'Feature'
  properties: { component_id: string; category: Category; year: number }
  geometry: { type: 'Point'; coordinates: [number, number] }
}

export interface Projects {
  area_id: string
  min_year: number
  max_year: number
  notes: string[]
  features: ProjectFeature[]
}

export interface AreaData {
  // Keep null rows so charts and totals can distinguish unavailable data from a measured zero.
  loss: MetricRow[]
  // The four CHIRPS rainfall metrics, including unavailable rows and their quality flags.
  rain: MetricRow[]
  projects: Projects
}

export async function get<T>(path: string): Promise<T> {
  const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '')
  const apiBase = configuredBase || '/api'
  const response = await fetch(`${apiBase}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchAreas(): Promise<AreaFeature[]> {
  const body = await get<{ features: AreaFeature[] }>('/areas')
  return body.features
}

/** The selected area's own outline and its up and down zones. Fetched only for the selected area. */
export async function fetchZones(areaId: string): Promise<AreaFeature[]> {
  const body = await get<{ features: AreaFeature[] }>(`/areas/${encodeURIComponent(areaId)}/zones`)
  return body.features
}

export async function fetchAreaData(areaId: string): Promise<AreaData> {
  const [metrics, projects] = await Promise.all([
    get<{ rows: MetricRow[] }>(`/areas/${areaId}/metrics`),
    get<Projects>(`/areas/${areaId}/projects`),
  ])
  return {
    loss: metrics.rows.filter((row) => row.metric === 'tree_cover_loss'),
    rain: metrics.rows.filter((row) => RAIN_METRICS.includes(row.metric)),
    projects,
  }
}

/** One top-level area in GET /areas/summary. A null measure is not loaded, never zero. */
export interface AreaSummary {
  area_id: string
  name: string
  study_type: StudyType
  area_ha: number
  loss_window_ha: number | null
  loss_record_ha: number | null
  loss_from: number | null
  loss_to: number | null
  rain_mean_mm: number | null
  rain_years: number | null
  rain_from: number | null
  rain_to: number | null
  contracts: number | null
  contract_cost_php: number | null
  review_terminated: number | null
  review_ongoing_earlier: number | null
  review_not_started_earlier: number | null
  review_ongoing_full_progress: number | null
  review_any: number | null
  metrics_loaded: boolean
  projects_linked: boolean
}

export interface Summary {
  min_year: number
  max_year: number
  current_year: number
  note: string
  rows: AreaSummary[]
}

export function fetchSummary(): Promise<Summary> {
  return get<Summary>('/areas/summary')
}

export async function fetchPoints(): Promise<PointFeature[]> {
  const body = await get<{ features: PointFeature[] }>('/projects/points')
  return body.features
}

/** One project's full record, or null when it has no site on the map. */
export async function fetchProject(componentId: string): Promise<ProjectFeature | null> {
  const body = await get<ProjectFeature | (Omit<ProjectFeature, 'geometry'> & { geometry: null })>(
    `/projects/${encodeURIComponent(componentId)}`,
  )
  return body.geometry ? (body as ProjectFeature) : null
}

export interface GreeneryLayer {
  year: number
  window: string
  source: string
  tile_url: string
  legend: { name: string; color: string }[]
  caveat: string
}

export function fetchGreenery(): Promise<GreeneryLayer> {
  return get<GreeneryLayer>('/layers/greenery')
}

export const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'drainage', label: 'Drainage', color: '#2a78d6' },
  { key: 'river_structure', label: 'River structure', color: '#eb6834' },
  { key: 'slope_protection', label: 'Slope protection', color: '#1baf7a' },
  { key: 'pumping', label: 'Pumping station', color: '#eda100' },
  { key: 'other', label: 'Other', color: '#e87ba4' },
]

// A zone keeps one color on every chart, on screen and on paper.
export const UP_COLOR = '#9a5b1e'
export const DOWN_COLOR = '#00a39a'
export const LOSS_COLOR = '#9a5b1e'

export const RAIN_METRICS = [
  'rainfall_total',
  'rainfall_wet_season',
  'rainfall_max_1day',
  'heavy_rain_days',
]

export const STUDY_TYPE_LABEL: Record<StudyType, string> = {
  rural_upland: 'Upland forest',
  river_basin: 'River basin',
  urban: 'City streets',
}

export function formatHa(value: number | null): string {
  if (value === null) return 'not available'
  return `${value.toLocaleString('en-PH', { maximumFractionDigits: value < 100 ? 1 : 0 })} ha`
}

export function formatMm(value: number | null): string {
  if (value === null) return 'not available'
  return `${Math.round(value).toLocaleString('en-PH')} mm`
}

export function formatPhp(value: number | null): string {
  if (value === null) return 'not available'
  if (value >= 1e9) return `PHP ${(value / 1e9).toFixed(2)} billion`
  if (value >= 1e6) return `PHP ${(value / 1e6).toFixed(1)} million`
  return `PHP ${Math.round(value).toLocaleString('en-PH')}`
}

export function shortPhp(value: number | null): string {
  if (value === null) return 'not available'
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`
  return Math.round(value).toLocaleString('en-PH')
}

export function sumLoss(rows: MetricRow[], from: number, to: number): number | null {
  if (to < from) return null
  const byYear = new Map<number, MetricRow>(
    rows
      .filter((row) => row.year >= from && row.year <= to)
      .map((row) => [row.year, row] as const),
  )
  let total = 0
  for (let year = from; year <= to; year += 1) {
    const row = byYear.get(year)
    if (!row || row.value === null) return null
    total += row.value
  }
  return total
}

export function sumAmount(features: ProjectFeature[]): number | null {
  if (features.length === 0) return 0
  const amounts = features.map((feature) => feature.properties.amount_php)
  if (amounts.some((amount) => amount === null)) return null
  return amounts.reduce<number>((total, amount) => total + amount!, 0)
}

/** Combine totals only when every total is available. */
export function sumTotals(values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null
  return values.reduce<number>((total, value) => total + value!, 0)
}

// Display only. The island group of each study area, for lists and the intro. It is not stored
// in the database and never changes an area_id.
export type Region = 'Luzon' | 'Visayas' | 'Mindanao'
const REGION: Record<string, Region> = {
  'pampanga-river-basin': 'Luzon',
  'angat-river-basin': 'Luzon',
  'cagayan-river-basin': 'Luzon',
  'bicol-river-basin': 'Luzon',
  'pasig-marikina-tullahan': 'Luzon',
  'antipolo-rodriguez-uplands': 'Luzon',
  'quezon-city': 'Luzon',
  'iloilo-river-basin': 'Visayas',
  'jalaur-river-basin': 'Visayas',
  'agusan-river-basin': 'Mindanao',
  'davao-river-basin': 'Mindanao',
  'cagayan-de-oro-river-basin': 'Mindanao',
}

export function regionOf(areaId: string): Region | null {
  return REGION[areaId] ?? null
}

export const STUDY_TYPE_ORDER: StudyType[] = ['river_basin', 'rural_upland', 'urban']

export const STUDY_TYPE_GROUP: Record<StudyType, string> = {
  river_basin: 'River basins',
  rural_upland: 'Upland forest',
  urban: 'City streets',
}

/** The name without its study type suffix, for example "Quezon City (urban)" becomes "Quezon City". */
export function shortName(area: AreaFeature): string {
  return area.properties.name.split(' (')[0]
}
