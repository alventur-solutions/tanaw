import { LngLatBounds, Map as MapLibre, NavigationControl, Popup } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, formatPhp } from './api'
import type { AreaFeature, ProjectFeature, ProjectProps } from './api'

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'
const RIVER = '#0e6f7c'

interface Props {
  areas: AreaFeature[]
  selectedId: string | null
  projects: ProjectFeature[]
  onSelect: (areaId: string) => void
}

function collection(features: unknown[]) {
  return { type: 'FeatureCollection', features } as unknown as GeoJSON.FeatureCollection
}

function bounds(features: AreaFeature[]): LngLatBounds {
  const box = new LngLatBounds()
  const walk = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      box.extend([coords[0] as number, coords[1] as number])
    } else if (Array.isArray(coords)) {
      coords.forEach(walk)
    }
  }
  features.forEach((f) => walk((f.geometry as GeoJSON.Polygon).coordinates))
  return box
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function popupHtml(p: ProjectProps): string {
  const category = CATEGORIES.find((c) => c.key === p.category)?.label ?? p.category
  const amount = p.amount_php == null ? 'Amount not recorded' : formatPhp(p.amount_php)
  const place = p.municipality ? `<br>${escapeHtml(p.municipality)}` : ''
  return (
    `<strong>${escapeHtml(p.type_of_work ?? 'Flood control project')}</strong>` +
    `<br>${escapeHtml(category)}, ${p.year}<br>${amount}${place}` +
    `<br><span class="popup-note">Point marks the project site.</span>`
  )
}

export default function MapView({ areas, selectedId, projects, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const instance = new MapLibre({
      container: container.current,
      style: BASEMAP,
      center: [121.1, 14.65],
      zoom: 9.6,
      attributionControl: { compact: true },
    })
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    instance.on('load', () => {
      for (const id of ['areas', 'zones', 'projects']) {
        instance.addSource(id, { type: 'geojson', data: collection([]) })
      }
      instance.addLayer({
        id: 'areas-fill',
        type: 'fill',
        source: 'areas',
        paint: {
          'fill-color': RIVER,
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.14, 0.05],
        },
      })
      instance.addLayer({
        id: 'areas-line',
        type: 'line',
        source: 'areas',
        paint: {
          'line-color': RIVER,
          'line-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1],
        },
      })
      instance.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['match', ['get', 'zone'], 'up', '#9a5b1e', '#00a39a'],
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      })
      instance.addLayer({
        id: 'projects',
        type: 'circle',
        source: 'projects',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 6],
          'circle-color': [
            'match',
            ['get', 'category'],
            ...CATEGORIES.flatMap((c) => [c.key, c.color]),
            '#888888',
          ] as unknown as string,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      })

      instance.on('click', 'projects', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        new Popup({ closeButton: false, maxWidth: '260px' })
          .setLngLat(event.lngLat)
          .setHTML(popupHtml(feature.properties as ProjectProps))
          .addTo(instance)
      })
      instance.on('click', 'areas-fill', (event) => {
        if (instance.queryRenderedFeatures(event.point, { layers: ['projects'] }).length) return
        // Areas overlap. A click picks the smallest one under the pointer.
        const hit = [...(event.features ?? [])].sort(
          (a, b) => Number(a.properties.area_ha) - Number(b.properties.area_ha),
        )[0]
        if (hit) onSelectRef.current(String(hit.properties.area_id))
      })
      for (const layer of ['projects', 'areas-fill']) {
        instance.on('mouseenter', layer, () => (instance.getCanvas().style.cursor = 'pointer'))
        instance.on('mouseleave', layer, () => (instance.getCanvas().style.cursor = ''))
      }
      setReady(true)
    })
    map.current = instance
    return () => instance.remove()
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance || areas.length === 0) return
    const top = areas.filter((a) => a.properties.zone === null)
    const zones = areas.filter(
      (a) => a.properties.zone !== null && a.properties.area_id.startsWith(`${selectedId}__`),
    )
    const source = (id: string) => instance.getSource(id) as GeoJSONSource
    source('areas').setData(
      collection(
        top.map((a) => ({
          ...a,
          properties: { ...a.properties, selected: a.properties.area_id === selectedId },
        })),
      ),
    )
    source('zones').setData(collection(zones))
    const focus = top.filter((a) => selectedId === null || a.properties.area_id === selectedId)
    instance.fitBounds(bounds(focus), { padding: 48, duration: 700 })
  }, [ready, areas, selectedId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('projects') as GeoJSONSource).setData(collection(projects))
  }, [ready, projects])

  return (
    <div className="map-wrap">
      <div ref={container} className="map" aria-label="Map of study areas and project sites" />
      {projects.length > 0 && (
        <ul className="map-legend" aria-label="Project categories">
          {CATEGORIES.map((c) => (
            <li key={c.key}>
              <span className="dot" style={{ background: c.color }} />
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
