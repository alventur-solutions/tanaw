import { LngLatBounds, Map as MapLibre, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, fetchGreenery } from './api'
import type { AreaFeature, GreeneryLayer, ProjectFeature } from './api'
import WaybackCompare from './WaybackCompare'
import type { WaybackRelease } from './WaybackCompare'

const BASEMAP = 'https://tiles.openfreemap.org/styles/dark'
const RIVER = '#2dd4bf'

// The camera is kept in the URL hash as #zoom/lat/lon/bearing/pitch, so a view can be shared
// as a link. It is read once, when the page opens.
const SHARED_VIEW = location.hash.slice(1).split('/').map(Number)
const HAS_SHARED_VIEW = SHARED_VIEW.length >= 3 && SHARED_VIEW.every(Number.isFinite)

interface Props {
  areas: AreaFeature[]
  selectedId: string | null
  projects: ProjectFeature[]
  selectedProjectId: string | null
  releases: WaybackRelease[]
  compare: boolean
  onCompare: (on: boolean) => void
  onSelect: (areaId: string) => void
  onProject: (componentId: string) => void
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

export default function MapView({
  areas,
  selectedId,
  projects,
  selectedProjectId,
  releases,
  compare,
  onCompare,
  onSelect,
  onProject,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onProjectRef = useRef(onProject)
  onProjectRef.current = onProject
  const [ready, setReady] = useState(false)
  // A link with a camera in its hash keeps that camera until another area is picked.
  const sharedViewArea = useRef(HAS_SHARED_VIEW ? selectedId : undefined)
  const [tilted, setTilted] = useState(true)
  const [showGreenery, setShowGreenery] = useState(true)
  const [greenery, setGreenery] = useState<GreeneryLayer | null>(null)
  const [greeneryError, setGreeneryError] = useState(false)
  // Every basemap layer. Compare mode hides them so the imagery shows through. The dark
  // basemap labels are not readable over imagery, so they are hidden too.
  const basemapLayers = useRef<string[]>([])

  useEffect(() => {
    if (!container.current) return
    const instance = new MapLibre({
      container: container.current,
      style: BASEMAP,
      center: HAS_SHARED_VIEW ? [SHARED_VIEW[2], SHARED_VIEW[1]] : [121.1, 14.65],
      zoom: HAS_SHARED_VIEW ? SHARED_VIEW[0] : 9.6,
      bearing: HAS_SHARED_VIEW ? (SHARED_VIEW[3] ?? 0) : 0,
      pitch: HAS_SHARED_VIEW ? (SHARED_VIEW[4] ?? 55) : 55,
      maxPitch: 70,
      attributionControl: { compact: true },
    })
    instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')
    instance.on('load', () => {
      basemapLayers.current = instance.getStyle().layers.map((layer) => layer.id)
      for (const id of ['areas', 'zones', 'projects']) {
        instance.addSource(id, { type: 'geojson', data: collection([]) })
      }
      // 3D buildings come from the basemap's own vector tiles.
      instance.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#4a5558',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      })
      instance.addLayer({
        id: 'areas-fill',
        type: 'fill',
        source: 'areas',
        paint: {
          'fill-color': RIVER,
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.1, 0.03],
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
          'line-color': ['match', ['get', 'zone'], 'up', '#b8742f', '#0f9e90'],
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
          'circle-stroke-color': '#0b0e0f',
          'circle-stroke-width': 1,
        },
      })
      instance.addLayer({
        id: 'project-selected',
        type: 'circle',
        source: 'projects',
        filter: ['==', ['get', 'component_id'], ''],
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': RIVER,
          'circle-stroke-width': 2,
        },
      })

      instance.on('click', 'projects', (event) => {
        const feature = event.features?.[0]
        if (!feature) return
        onProjectRef.current(String(feature.properties.component_id))
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
      instance.on('moveend', () => {
        const { lng, lat } = instance.getCenter()
        const view = [instance.getZoom().toFixed(2), lat.toFixed(5), lng.toFixed(5), instance.getBearing().toFixed(0), instance.getPitch().toFixed(0)]
        history.replaceState(null, '', `${location.pathname}${location.search}#${view.join('/')}`)
      })
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
    if (sharedViewArea.current === selectedId) return
    sharedViewArea.current = undefined
    instance.fitBounds(bounds(focus), { padding: 48, duration: 700, pitch: instance.getPitch() })
  }, [ready, areas, selectedId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('projects') as GeoJSONSource).setData(collection(projects))
  }, [ready, projects])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    instance.setFilter('project-selected', ['==', ['get', 'component_id'], selectedProjectId ?? ''])
    const site = projects.find((p) => p.properties.component_id === selectedProjectId)
    if (site) {
      instance.flyTo({
        center: site.geometry.coordinates,
        zoom: Math.max(instance.getZoom(), 16),
        duration: 900,
      })
    }
    // Flying happens when the selection changes, not when the project list reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedProjectId])

  useEffect(() => {
    if (!showGreenery || greenery || greeneryError) return
    fetchGreenery().then(setGreenery, () => setGreeneryError(true))
  }, [showGreenery, greenery, greeneryError])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    if (greenery && !instance.getSource('greenery')) {
      instance.addSource('greenery', {
        type: 'raster',
        tiles: [greenery.tile_url],
        tileSize: 256,
        attribution: 'Dynamic World, Google and WRI',
      })
      // Under the buildings and labels, over the land.
      instance.addLayer(
        { id: 'greenery', type: 'raster', source: 'greenery', paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest' } },
        'building',
      )
    }
    const greeneryOn = showGreenery && !compare
    if (instance.getLayer('greenery')) {
      instance.setLayoutProperty('greenery', 'visibility', greeneryOn ? 'visible' : 'none')
    }
    for (const id of basemapLayers.current) {
      instance.setLayoutProperty(id, 'visibility', compare ? 'none' : 'visible')
    }
    instance.setLayoutProperty('buildings-3d', 'visibility', tilted && !compare ? 'visible' : 'none')
    instance.setLayoutProperty('building', 'visibility', tilted || compare ? 'none' : 'visible')
    // The area tint would muddy the greens and the imagery, so only the outline stays.
    instance.setPaintProperty(
      'areas-fill',
      'fill-opacity',
      greeneryOn || compare ? 0 : ['case', ['==', ['get', 'selected'], true], 0.1, 0.03],
    )
  }, [ready, greenery, showGreenery, tilted, compare])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    if (tilted !== instance.getPitch() > 0) instance.easeTo({ pitch: tilted ? 55 : 0, duration: 500 })
  }, [ready, tilted])

  return (
    <div className="map-wrap">
      {compare && ready && map.current && releases.length > 1 && (
        <WaybackCompare main={map.current} releases={releases} />
      )}
      <div ref={container} className="map" aria-label="Map of study areas and project sites" />
      <div className="map-toggles">
        <button aria-pressed={tilted} onClick={() => setTilted(!tilted)}>
          3D buildings
        </button>
        <button
          aria-pressed={showGreenery && !compare}
          disabled={compare}
          onClick={() => setShowGreenery(!showGreenery)}
        >
          Greenery
        </button>
        <button
          aria-pressed={compare}
          disabled={releases.length < 2}
          onClick={() => onCompare(!compare)}
        >
          Compare imagery
        </button>
      </div>
      <div className="map-legend">
        {projects.length > 0 && (
          <ul aria-label="Project categories">
            {CATEGORIES.map((c) => (
              <li key={c.key}>
                <span className="dot" style={{ background: c.color }} />
                {c.label}
              </li>
            ))}
          </ul>
        )}
        {showGreenery && !compare && greenery && (
          <ul aria-label="Vegetation cover">
            <li className="legend-title">Vegetation cover, Jan to May {greenery.year}</li>
            {greenery.legend.map((item) => (
              <li key={item.name}>
                <span className="cell" style={{ background: item.color }} />
                {item.name}
              </li>
            ))}
            <li className="legend-note">{greenery.caveat}</li>
          </ul>
        )}
        {showGreenery && !compare && !greenery && (
          <p>{greeneryError ? 'Greenery layer is not available. Earth Engine did not answer.' : 'Loading greenery from Earth Engine.'}</p>
        )}
      </div>
    </div>
  )
}
