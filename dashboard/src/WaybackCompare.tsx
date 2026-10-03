import { Map as MapLibre } from 'maplibre-gl'
import type { RasterTileSource } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'

// Older and newer imagery across the whole map, split by a draggable divider. Two imagery
// maps sit under the main map and follow its camera. The main map hides its basemap in this
// mode, so its outlines, project points, and labels stay on top of both sides.
// Imagery is the Esri World Imagery Wayback archive. The approach follows ghostwatch (MIT).

export interface WaybackRelease {
  rnum: string
  date: string
}

const tiles = (rnum: string) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rnum}/{z}/{y}/{x}`

function imageryMap(container: HTMLDivElement, main: MapLibre, rnum: string) {
  return new MapLibre({
    container,
    center: main.getCenter(),
    zoom: main.getZoom(),
    bearing: main.getBearing(),
    pitch: main.getPitch(),
    maxPitch: 70,
    interactive: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: { imagery: { type: 'raster', tiles: [tiles(rnum)], tileSize: 256, maxzoom: 19 } },
      layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
    },
  })
}

interface Props {
  main: MapLibre
  releases: WaybackRelease[]
}

export default function WaybackCompare({ main, releases }: Props) {
  // Older side defaults to the last release on or before 2018, newer side to the latest.
  const early = releases.filter((r) => r.date <= '2018-01-01')
  const [older, setOlder] = useState((early[early.length - 1] ?? releases[0]).rnum)
  const [newer, setNewer] = useState(releases[releases.length - 1].rnum)
  const [position, setPosition] = useState(50)

  const frame = useRef<HTMLDivElement>(null)
  const olderEl = useRef<HTMLDivElement>(null)
  const newerEl = useRef<HTMLDivElement>(null)
  const olderMap = useRef<MapLibre | null>(null)
  const newerMap = useRef<MapLibre | null>(null)

  useEffect(() => {
    if (!olderEl.current || !newerEl.current) return
    const left = imageryMap(olderEl.current, main, older)
    const right = imageryMap(newerEl.current, main, newer)
    const follow = () => {
      const camera = {
        center: main.getCenter(),
        zoom: main.getZoom(),
        bearing: main.getBearing(),
        pitch: main.getPitch(),
      }
      left.jumpTo(camera)
      right.jumpTo(camera)
    }
    main.on('move', follow)
    olderMap.current = left
    newerMap.current = right
    return () => {
      main.off('move', follow)
      left.remove()
      right.remove()
    }
    // The imagery maps are built once. Date changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [main])

  useEffect(() => {
    const source = olderMap.current?.getSource('imagery') as RasterTileSource | undefined
    source?.setTiles([tiles(older)])
  }, [older])
  useEffect(() => {
    const source = newerMap.current?.getSource('imagery') as RasterTileSource | undefined
    source?.setTiles([tiles(newer)])
  }, [newer])

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    const move = (e: PointerEvent) => {
      const rect = frame.current?.getBoundingClientRect()
      if (rect) setPosition(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') setPosition((p) => Math.max(0, p - 3))
    if (event.key === 'ArrowRight') setPosition((p) => Math.min(100, p + 3))
  }

  const picker = (label: string, value: string, onChange: (rnum: string) => void) => (
    <label>
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {releases.map((r) => (
          <option key={r.rnum} value={r.rnum}>
            {r.date}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <>
      <div className="underlay" ref={frame}>
        <div ref={olderEl} className="underlay-map" />
        <div
          ref={newerEl}
          className="underlay-map"
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
      </div>
      <div className="compare-divider" style={{ left: `${position}%` }}>
        <button
          className="compare-handle"
          role="slider"
          aria-label="Drag or use the arrow keys to compare older and newer imagery"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onPointerDown={startDrag}
          onKeyDown={onKey}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 4 1.5 8 5 12M11 4l3.5 4L11 12M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
      <div className="compare-bar">
        <div className="compare-dates">
          {picker('Older, left', older, setOlder)}
          {picker('Newer, right', newer, setNewer)}
        </div>
        {older === newer && <p className="warn">Same date on both sides. Pick two different dates.</p>}
        <p>
          Esri World Imagery Wayback (Esri, Maxar, Earthstar Geographics). Dates are when Esri
          refreshed its basemap, not always when the place was photographed again. For visual
          context only.
        </p>
      </div>
    </>
  )
}
