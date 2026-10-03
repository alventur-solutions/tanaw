import type { Geometry } from "geojson";

export type StudyType = "river_basin" | "rural_upland" | "urban";
export type Category =
  "drainage" | "river_structure" | "slope_protection" | "pumping" | "other";
export type AreaProperties = {
  area_id: string;
  name: string;
  study_type: StudyType;
  zone: "up" | "down" | null;
  area_ha: number | null;
};
export type AreaFeature = {
  type: "Feature";
  id: string;
  properties: AreaProperties;
  geometry: Geometry;
};
export type MetricRow = {
  area_id: string;
  year: number;
  metric: string;
  value: number | null;
  quality_flag: string;
  source_version: string | null;
};
export type ProjectProperties = {
  component_id: string;
  project_id: string | null;
  year: number;
  category: Category;
  type_of_work: string | null;
  amount_php: number | null;
  abc_php: number | null;
  contractor: string | null;
  municipality: string | null;
  province: string | null;
  start_date: string | null;
  completion_date: string | null;
  source: string;
};
export type ProjectFeature = {
  type: "Feature";
  properties: ProjectProperties;
  geometry: { type: "Point"; coordinates: [number, number] };
};
export type ProjectResponse = {
  area_id: string;
  min_year: number | null;
  max_year: number | null;
  caveat: string | null;
  notes: string[];
  features: ProjectFeature[];
};
export type AreaData = {
  area: AreaFeature;
  projects: ProjectResponse;
  metrics: MetricRow[];
};

export const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: "drainage", label: "Drainage", color: "#2878b5" },
  { key: "river_structure", label: "River works", color: "#dc7929" },
  { key: "slope_protection", label: "Slope works", color: "#32845e" },
  { key: "pumping", label: "Pumping", color: "#a47712" },
  { key: "other", label: "Other", color: "#8561a8" },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!API_URL)
    throw new Error("Set NEXT_PUBLIC_API_URL to the API Lambda Function URL.");
  const response = await fetch(`${API_URL}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* Keep the HTTP status. */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function fetchAreas(signal?: AbortSignal): Promise<AreaFeature[]> {
  const body = await get<{ features: AreaFeature[] }>("/areas", signal);
  return body.features;
}

export async function fetchAreaData(
  area: AreaFeature,
  signal?: AbortSignal,
): Promise<AreaData> {
  const id = encodeURIComponent(area.properties.area_id);
  const [projects, metrics] = await Promise.all([
    get<ProjectResponse>(`/areas/${id}/projects`, signal),
    get<{ rows: MetricRow[] }>(
      `/areas/${id}/metrics?metric=tree_cover_loss`,
      signal,
    ),
  ]);
  return { area, projects, metrics: metrics.rows };
}

export function formatPhp(value: number | null) {
  return value === null
    ? "Not reported"
    : new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 0,
      }).format(value);
}

export const STUDY_TYPE_LABEL: Record<StudyType, string> = {
  rural_upland: "Upland",
  river_basin: "River basin",
  urban: "City",
};
