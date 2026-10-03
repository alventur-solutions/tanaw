import { LngLatBounds, Map as MapLibre, Marker, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, fetchGreenery } from './api'
import type { AreaFeature, GreeneryLayer, PointFeature } from './api'
import { mark, report } from './perf'
import SearchBox from './SearchBox'
import type { Place } from './SearchBox'
import WaybackCompare from './WaybackCompare'
import type { WaybackRelease } from './WaybackCompare'

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'
const RIVER = '#086aa5'
const INK = '#1d1d1f'

// The whole country: [west, south, east, north]. The overview and "All areas" fit this box.
const COUNTRY: [number, number, number, number] = [116.9, 4.6, 126.7, 21.2]
const COUNTRY_PADDING = 24

// The camera is kept in the URL hash as #zoom/lat/lon/bearing/pitch, so a view can be shared
// as a link. It is read once, when the page opens.
const SHARED_VIEW = location.hash.slice(1).split('/').map(Number)
const HAS_SHARED_VIEW = SHARED_VIEW.length >= 3 && SHARED_VIEW.every(Number.isFinite)

interface Props {
  // Top-level areas, simplified for the overview.
  areas: AreaFeature[]
  // Outline and zones of the selected area only, loaded when it is selected.
  zones: AreaFeature[]
  selectedId: string | null
  // Every project site, inside a study area or not.
  projects: PointFeature[]
  selectedProjectId: string | null
  releases: WaybackRelease[]
  compare: boolean
  // alternatives: the other areas under the click, smallest first.
  onSelect: (areaId: string, alternatives: string[]) => void
  onProject: (componentId: string) => void
}

function collection(features: unknown[]) {
  return { type: 'FeatureCollection', features } as unknown as GeoJSON.FeatureCollection
}

function bounds(features: AreaFeature[]): LngLatBounds {
  const box = new LngLatBounds()
  // The bbox from /areas is taken from the full geometry, so no vertex walk is needed.
  if (features.length > 0 && features.every((f) => f.properties.bbox)) {
    for (const f of features) {
      const [west, south, east, north] = f.properties.bbox!
      box.extend([west, south]).extend([east, north])
    }
    return box
  }
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
  zones,
  selectedId,
  projects,
  selectedProjectId,
  releases,
  compare,
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
  // Every basemap layer. Compare mode hides them so the imagery shows through.
  const basemapLayers = useRef<string[]>([])
  const searchMarker = useRef<Marker | null>(null)

  const goToPlace = (place: Place) => {
    const instance = map.current
    if (!instance) return
    searchMarker.current?.remove()
    searchMarker.current = new Marker({ color: INK }).setLngLat(place.center).addTo(instance)
    if (place.extent) {
      const [west, north, east, south] = place.extent
      instance.fitBounds([west, south, east, north], { padding: 80, maxZoom: 16.5, duration: 900 })
    } else {
      instance.flyTo({ center: place.center, zoom: 16, duration: 900 })
    }
  }

  useEffect(() => {
    if (!container.current) return
    const instance = new MapLibre({
      container: container.current,
      style: BASEMAP,
      // Without a shared view the map opens on the whole country, flat.
      ...(HAS_SHARED_VIEW
        ? { center: [SHARED_VIEW[2], SHARED_VIEW[1]] as [number, number], zoom: SHARED_VIEW[0] }
        : {
            bounds: COUNTRY,
            fitBoundsOptions: { padding: COUNTRY_PADDING },
          }),
      bearing: HAS_SHARED_VIEW ? (SHARED_VIEW[3] ?? 0) : 0,
      pitch: HAS_SHARED_VIEW ? (SHARED_VIEW[4] ?? 55) : 0,
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
          'fill-extrusion-color': '#dcdce1',
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
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.08, 0.03],
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
        id: 'outline-fine',
        type: 'line',
        source: 'zones',
        filter: ['==', ['get', 'role'], 'outline'],
        paint: { 'line-color': RIVER, 'line-width': 2.5 },
      })
      instance.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        filter: ['==', ['get', 'role'], 'zone'],
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
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 9, 3, 13, 6],
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
      instance.addLayer({
        id: 'project-selected',
        type: 'circle',
        source: 'projects',
        filter: ['==', ['get', 'component_id'], ''],
        paint: {
          'circle-radius': 11,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': INK,
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
        // Areas overlap. A click picks the smallest one under the pointer (ties by area_id)
        // and hands the rest to the panel, in the same order.
        const seen = new Map<string, number>()
        for (const f of event.features ?? []) {
          seen.set(String(f.properties.area_id), Number(f.properties.area_ha))
        }
        const ordered = [...seen.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        if (ordered.length > 0) {
          onSelectRef.current(ordered[0][0], ordered.slice(1).map(([id]) => id))
        }
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
      mark('map-load')
      setReady(true)
      instance.once('idle', () => {
        mark('first-idle')
      })
    })
    map.current = instance
    return () => instance.remove()
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance || areas.length === 0) return
    const top = areas.filter((a) => a.properties.zone === null)
    const source = (id: string) => instance.getSource(id) as GeoJSONSource
    source('areas').setData(
      collection(
        top.map((a) => ({
          ...a,
          properties: { ...a.properties, selected: a.properties.area_id === selectedId },
        })),
      ),
    )
    mark('areas-set')
    const focus = top.filter((a) => selectedId === null || a.properties.area_id === selectedId)
    if (sharedViewArea.current === selectedId) return
    // A link that opens on a project keeps the camera on its site.
    if (selectedProjectId !== null) return
    sharedViewArea.current = undefined
    if (selectedId === null) {
      instance.fitBounds(COUNTRY, { padding: COUNTRY_PADDING, duration: 700, pitch: 0, bearing: 0 })
    } else if (focus.length > 0) {
      instance.fitBounds(bounds(focus), { padding: 48, duration: 700, pitch: tilted ? 55 : 0 })
    }
    // The fit follows the area, not the project selection or the 3D toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, areas, selectedId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    // Zone outlines exist only for the selected area.
    const own = zones.filter((z) => selectedId !== null && z.properties.area_id.startsWith(selectedId))
    ;(instance.getSource('zones') as GeoJSONSource).setData(
      collection(
        own.map((z) => ({
          ...z,
          properties: { ...z.properties, role: z.properties.zone === null ? 'outline' : 'zone' },
        })),
      ),
    )
  }, [ready, zones, selectedId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource('projects') as GeoJSONSource).setData(collection(projects))
    if (projects.length > 0) {
      mark('points-set')
      instance.once('idle', () => {
        mark('points-idle')
        report()
      })
    }
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
    // Flying happens when the selection changes, or when a linked project first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedProjectId, projects.length > 0])

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
        { id: 'greenery', type: 'raster', source: 'greenery', paint: { 'raster-opacity': 0.55, 'raster-resampling': 'nearest' } },
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
      <SearchBox onPick={goToPlace} />
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
