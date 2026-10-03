export type StudyType = 'river_basin' | 'rural_upland' | 'urban'
export type Category = 'drainage' | 'river_structure' | 'slope_protection' | 'pumping' | 'other'

export interface AreaProps {
  area_id: string
  name: string
  study_type: StudyType
  zone: 'up' | 'down' | null
  area_ha: number
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
  year: number
  category: Category
  type_of_work: string | null
  amount_php: number | null
  municipality: string | null
}

export interface ProjectFeature {
  type: 'Feature'
  properties: ProjectProps
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
  loss: MetricRow[]
  projects: Projects
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchAreas(): Promise<AreaFeature[]> {
  const body = await get<{ features: AreaFeature[] }>('/areas')
  return body.features
}

export async function fetchAreaData(areaId: string): Promise<AreaData> {
  const [metrics, projects] = await Promise.all([
    get<{ rows: MetricRow[] }>(`/areas/${areaId}/metrics?metric=tree_cover_loss`),
    get<Projects>(`/areas/${areaId}/projects`),
  ])
  return { loss: metrics.rows, projects }
}

export const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'drainage', label: 'Drainage', color: '#2a78d6' },
  { key: 'river_structure', label: 'River structure', color: '#eb6834' },
  { key: 'slope_protection', label: 'Slope protection', color: '#1baf7a' },
  { key: 'pumping', label: 'Pumping station', color: '#eda100' },
  { key: 'other', label: 'Other', color: '#e87ba4' },
]

export const STUDY_TYPE_LABEL: Record<StudyType, string> = {
  rural_upland: 'Upland forest',
  river_basin: 'River basin',
  urban: 'City streets',
}

export function formatHa(value: number): string {
  return `${value.toLocaleString('en-PH', { maximumFractionDigits: value < 100 ? 1 : 0 })} ha`
}

export function formatPhp(value: number): string {
  if (value >= 1e9) return `PHP ${(value / 1e9).toFixed(2)} billion`
  if (value >= 1e6) return `PHP ${(value / 1e6).toFixed(1)} million`
  return `PHP ${Math.round(value).toLocaleString('en-PH')}`
}

export function shortPhp(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`
  return Math.round(value).toLocaleString('en-PH')
}

export function sumLoss(rows: MetricRow[], from: number, to: number): number {
  return rows
    .filter((row) => row.year >= from && row.year <= to)
    .reduce((total, row) => total + (row.value ?? 0), 0)
}

export function sumAmount(features: ProjectFeature[]): number {
  return features.reduce((total, f) => total + (f.properties.amount_php ?? 0), 0)
}
