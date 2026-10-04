import { LngLatBounds, Map as MapLibre, Marker, NavigationControl } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EXAMPLE_STATION,
  LEVEL_COLOR,
  OFFLINE_MINUTES,
  OVERALL,
  STALE_MINUTES,
  STREET_LEVELS,
  actions,
  agoText,
  dms,
  fetchReadings,
  fetchStations,
  heatStatus,
  minutesAgo,
  waterStatus,
  worst,
} from './sensors'
import type { IconName, Level, Reading, Station } from './sensors'

const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'
const REFRESH_MS = 30_000
// Metro Manila, for the first frame before any station loads.
const START: [number, number] = [121.05, 14.63]

function stationName(station: Station): string {
  if (station.properties.station_id === 'example') return 'Test station'
  const kind = station.properties.station_type === 'river' ? 'River station' : 'Street station'
  return `${kind} ${station.properties.station_id}`
}

function stationLevel(station: Station, history: Reading[]): Level {
  const latest = station.properties.latest
  if (!latest) return 'ok'
  const water = waterStatus(station, history)
  const heat = heatStatus(latest)
  return worst([water?.level ?? 'ok', heat?.level ?? 'ok'])
}

export default function LiveSensors() {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    new URLSearchParams(location.search).get('station'),
  )
  const [readings, setReadings] = useState<Record<string, Reading[]>>({})
  const [now, setNow] = useState(Date.now())

  // Stations refresh every 30 seconds. The clock ticks so "min ago" stays true between loads.
  useEffect(() => {
    const load = () =>
      fetchStations().then(
        (loaded) => {
          setStations(loaded)
          setFailed(false)
        },
        () => {
          setFailed(true)
          setStations((current) => current ?? [])
        },
      )
    load()
    const refresh = setInterval(load, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      clearInterval(refresh)
      clearInterval(tick)
    }
  }, [])

  const reporting = (stations ?? []).filter((s) => s.properties.latest !== null)
  const example = stations !== null && reporting.length === 0
  const shown = example ? [EXAMPLE_STATION] : reporting
  const selected =
    shown.find((s) => s.properties.station_id === selectedId) ?? shown[0] ?? null
  const selectedKey = selected?.properties.station_id ?? null
  const latestTs = selected?.properties.latest?.ts

  useEffect(() => {
    if (!selectedKey || selectedKey === 'example') return
    let stale = false
    fetchReadings(selectedKey).then(
      (rows) => !stale && setReadings((current) => ({ ...current, [selectedKey]: rows })),
      () => undefined,
    )
    return () => {
      stale = true
    }
  }, [selectedKey, latestTs])

  const select = (id: string) => {
    setSelectedId(id)
    const url = new URL(location.href)
    url.searchParams.set('station', id)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="app live-app">
      <header className="masthead">
        <a className="brand" href="/">
          <img src="/assets/tanaw-mark.png" alt="" />
          <h1>Tanaw</h1>
        </a>
        <nav className="area-nav" aria-label="Pages">
          <a className="nav-link" href="/">
            Study areas
          </a>
          <a className="nav-link active" href="/live-sensors" aria-current="page">
            Live sensors
          </a>
        </nav>
        <p className="live-badge" aria-live="polite">
          <span className={failed ? 'pulse off' : 'pulse'} />
          {failed ? 'Connection lost' : example ? 'Waiting for stations' : 'Live'}
        </p>
      </header>

      <main className="workspace">
        <StationMap
          stations={shown}
          selectedId={selectedKey}
          levelOf={(s) => stationLevel(s, readings[s.properties.station_id] ?? [])}
          onSelect={select}
        />
        <aside className="panel live-panel">
          {stations === null && <p className="empty">Loading the flood stations.</p>}
          {stations !== null && selected && (
            <StationPanel
              station={selected}
              stations={shown}
              history={readings[selected.properties.station_id] ?? []}
              example={example}
              failed={failed}
              now={now}
              onSelect={select}
            />
          )}
        </aside>
      </main>
    </div>
  )
}

interface PanelProps {
  station: Station
  stations: Station[]
  history: Reading[]
  example: boolean
  failed: boolean
  now: number
  onSelect: (id: string) => void
}

function StationPanel({ station, stations, history, example, failed, now, onSelect }: PanelProps) {
  const latest = station.properties.latest!
  const water = waterStatus(station, history)
  const heat = heatStatus(latest)
  const level = worst([water?.level ?? 'ok', heat?.level ?? 'ok'])
  const todo = actions(station, water, heat)
  const age = minutesAgo(latest.ts, now)
  const offline = !example && age >= OFFLINE_MINUTES
  const staleNote = !example && age >= STALE_MINUTES
  const [lon, lat] = station.geometry.coordinates
  const overall = OVERALL[level]

  return (
    <>
      <div className="panel-head">
        <p className="eyebrow">Live flood stations</p>
        <h2>What is it like outside right now?</h2>
        <p className="live-intro">
          Readings from TANAW flood stations, updated every 30 seconds, with simple advice on what
          to bring and where not to go.
        </p>
      </div>

      {example && (
        <p className="notice">
          No station is sending live readings right now. The numbers below are an example reading
          from the test station, to show how this page will look.
        </p>
      )}
      {failed && !example && (
        <p className="notice">
          The connection to TANAW was lost. These are the last readings received.
        </p>
      )}

      {stations.length > 1 && (
        <div className="station-chips" role="tablist" aria-label="Stations">
          {stations.map((s) => (
            <button
              key={s.properties.station_id}
              role="tab"
              aria-selected={s === station}
              className={s === station ? 'active' : ''}
              onClick={() => onSelect(s.properties.station_id)}
            >
              {stationName(s)}
            </button>
          ))}
        </div>
      )}

      <section
        className={`status-card level-${offline ? 'off' : level}`}
        style={{ ['--level' as string]: offline ? '#86868b' : LEVEL_COLOR[level] }}
      >
        <p className="status-station">
          {stationName(station)}
          <span>
            {station.properties.station_type === 'river' ? 'on a bridge' : 'over the road'}
          </span>
        </p>
        <p className="status-headline">{offline ? 'Station is offline' : overall.headline}</p>
        {!offline && <p className="status-fil">{overall.fil}</p>}
        <p className="status-time">
          {example ? 'Example reading' : `Updated ${agoText(latest.ts, now)}`}
          {staleNote && !offline && '. This may be out of date.'}
          {offline && '. Advice is hidden until it reports again.'}
        </p>
      </section>

      <section className="tiles" aria-label="Latest reading">
        <Tile
          label="Temperature"
          value={latest.temp_c}
          unit="°C"
          note={heat ? `Feels like ${Math.round(heat.value)} °C` : undefined}
          level={offline ? undefined : heat?.level}
        />
        <Tile label="Humidity" value={latest.humidity_pct} unit="%" note={humidNote(latest)} />
        <Tile
          label={station.properties.station_type === 'river' ? 'Water level' : 'Flood depth'}
          value={
            station.properties.station_type === 'river'
              ? latest.water_level_cm
              : latest.flood_depth_cm
          }
          unit="cm"
          note={water?.headline}
          level={offline ? undefined : water?.level}
        />
      </section>

      {!offline && (
        <section className="beat">
          <h3>What should I do?</h3>
          <ul className="actions">
            {todo.map((action) => (
              <li key={action.text} style={{ ['--level' as string]: LEVEL_COLOR[action.level] }}>
                <span className="action-icon" aria-hidden="true">
                  <Icon name={action.icon} />
                </span>
                <span>
                  <strong>{action.text}</strong>
                  <em lang="fil">{action.fil}</em>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {water && (
        <section className="beat">
          <h3>
            {station.properties.station_type === 'street'
              ? 'How deep is the water on the street?'
              : 'How has the river moved today?'}
          </h3>
          <p className="lede">{water.detail}</p>
          {station.properties.station_type === 'street' ? (
            <DepthGauge depth={water.value} />
          ) : (
            <Sparkline rows={history} field="water_level_cm" example={example} />
          )}
        </section>
      )}

      <section className="beat">
        <h3>Where is this station?</h3>
        <dl className="where">
          <div>
            <dt>Latitude</dt>
            <dd>
              {lat.toFixed(3)}° N <span>{dms(lat, 'N', 'S')}</span>
            </dd>
          </div>
          <div>
            <dt>Longitude</dt>
            <dd>
              {lon.toFixed(5)}° E <span>{dms(lon, 'E', 'W')}</span>
            </dd>
          </div>
        </dl>
        <a
          className="back"
          href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Maps
        </a>
      </section>

      <section className="beat hotline">
        <p>
          <strong>In an emergency, call 911.</strong> Follow your barangay and LGU DRRM office for
          evacuation orders.
        </p>
      </section>

      <ul className="caveats">
        <li>
          Readings come straight from the device and are not checked by a person. A station reads
          one spot; the next street can be different.
        </li>
        <li>
          Street alert levels: 10 cm fills the gutter, 30 cm is not passable for cars, 50 cm is
          dangerous for people.
        </li>
        <li>
          "Feels like" is the heat index from temperature and humidity, grouped the way PAGASA
          groups it.
        </li>
        <li>The umbrella advice uses humidity and the season. It is not a rain forecast.</li>
      </ul>
    </>
  )
}

// Line icons drawn on a 24 unit grid, stroked in the text color.
const ICON_PATHS: Record<IconName, string[]> = {
  umbrella: ['M22 12a10 10 0 0 0-20 0Z', 'M12 12v7a2 2 0 0 0 4 0', 'M12 2v1'],
  drop: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
  car: [
    'M5 17H3v-4l2-5h14l2 5v4h-2',
    'M9 17h6',
    'M7 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M3 13h18',
  ],
  home: ['M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M9 21v-7h6v7'],
  phone: [
    'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  ],
  wade: ['M8 3v9l-3 4h9l1-4', 'M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5'],
  waves: [
    'M2 6c2 0 2-1.5 4-1.5S8 6 10 6s2-1.5 4-1.5S16 6 18 6s2-1.5 4-1.5',
    'M2 12c2 0 2-1.5 4-1.5S8 12 10 12s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
    'M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
  ],
  bag: ['M5 9a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z', 'M9 5V3h6v2', 'M8 14h8'],
  check: ['M20 6L9 17l-5-5'],
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

function humidNote(reading: Reading): string | undefined {
  const h = reading.humidity_pct
  if (h === null) return undefined
  if (h >= 85) return 'Very humid'
  if (h >= 60) return 'Humid'
  return 'Comfortable'
}

function Tile({
  label,
  value,
  unit,
  note,
  level,
}: {
  label: string
  value: number | null
  unit: string
  note?: string
  level?: Level
}) {
  return (
    <div className="tile" style={level ? { ['--level' as string]: LEVEL_COLOR[level] } : undefined}>
      <span className="label">{label}</span>
      <strong>
        {value === null ? 'No reading' : value.toFixed(1)}
        {value !== null && <small>{unit}</small>}
      </strong>
      {note && <span className={level ? 'tile-note has-level' : 'tile-note'}>{note}</span>}
    </div>
  )
}

/** A horizontal ruler from 0 to 60 cm with the three street alert levels marked. */
function DepthGauge({ depth }: { depth: number }) {
  const max = 60
  const marks = [
    { cm: STREET_LEVELS[0], text: 'Gutter' },
    { cm: STREET_LEVELS[1], text: 'No cars' },
    { cm: STREET_LEVELS[2], text: 'Danger' },
  ]
  return (
    <div
      className="gauge"
      role="img"
      aria-label={`Flood depth ${depth.toFixed(0)} cm on a scale with alert levels at 10, 30, and 50 cm`}
    >
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${(Math.min(depth, max) / max) * 100}%` }} />
        {marks.map((m) => (
          <span key={m.cm} className="gauge-mark" style={{ left: `${(m.cm / max) * 100}%` }}>
            <span>
              {m.cm} cm
              <br />
              {m.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Sparkline({
  rows,
  field,
  example,
}: {
  rows: Reading[]
  field: 'water_level_cm'
  example: boolean
}) {
  const points = rows.filter((r) => r[field] !== null)
  if (example || points.length < 2) {
    return (
      <p className="empty">
        The 24 hour line appears after the station has sent a few readings.
      </p>
    )
  }
  const width = 440
  const height = 90
  const times = points.map((r) => new Date(r.ts).getTime())
  const values = points.map((r) => r[field] as number)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const top = Math.max(10, ...values)
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width
  const y = (v: number) => height - (v / top) * (height - 8) - 4
  const path = points.map((r, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(values[i]).toFixed(1)}`).join('')
  const last = values[values.length - 1]
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Water level over the last 24 hours, now ${last.toFixed(0)} cm, highest ${Math.max(...values).toFixed(0)} cm`}>
        <path d={`${path}L${width},${height}L0,${height}Z`} className="spark-area" />
        <path d={path} className="spark-line" />
        <circle cx={x(t1)} cy={y(last)} r="4" className="spark-dot" />
      </svg>
      <figcaption>
        <span>{new Date(t0).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</span>
        <span>Highest {Math.max(...values).toFixed(0)} cm</span>
        <span>Now</span>
      </figcaption>
    </figure>
  )
}

interface MapProps {
  stations: Station[]
  selectedId: string | null
  levelOf: (station: Station) => Level
  onSelect: (id: string) => void
}

function StationMap({ stations, selectedId, levelOf, onSelect }: MapProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const markers = useRef<Marker[]>([])
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const fitted = useRef(false)

  useEffect(() => {
    if (!container.current) return
    const instance = new MapLibre({
      container: container.current,
      style: BASEMAP,
      center: START,
      zoom: 11,
      pitch: 45,
      maxPitch: 70,
      attributionControl: { compact: true },
    })
    instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')
    instance.on('load', () => {
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
    })
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
  }, [])

  // Marker colors follow each station's advice level.
  const signature = useMemo(
    () => stations.map((s) => `${s.properties.station_id}:${levelOf(s)}`).join('|'),
    [stations, levelOf],
  )
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    markers.current.forEach((m) => m.remove())
    markers.current = stations.map((station) => {
      const id = station.properties.station_id
      const el = document.createElement('button')
      el.className = id === selectedId ? 'station-marker selected' : 'station-marker'
      el.style.setProperty('--level', LEVEL_COLOR[levelOf(station)])
      el.setAttribute('aria-label', stationName(station))
      el.innerHTML = '<span class="ring"></span><span class="core"></span>'
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        onSelectRef.current(id)
      })
      return new Marker({ element: el }).setLngLat(station.geometry.coordinates).addTo(instance)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, selectedId])

  // The first load frames every station. A later selection flies to that station.
  useEffect(() => {
    const instance = map.current
    if (!instance || stations.length === 0) return
    const target = stations.find((s) => s.properties.station_id === selectedId) ?? stations[0]
    if (!fitted.current && stations.length > 1) {
      const box = new LngLatBounds()
      stations.forEach((s) => box.extend(s.geometry.coordinates))
      instance.fitBounds(box, { padding: 120, maxZoom: 16, duration: 0 })
    } else {
      instance.flyTo({
        center: target.geometry.coordinates,
        zoom: 16.2,
        pitch: 55,
        duration: fitted.current ? 900 : 0,
      })
    }
    fitted.current = true
  }, [stations.length, selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      <div className="map-legend live-legend">
        {(['ok', 'watch', 'warn', 'danger'] as Level[]).map((level) => (
          <span key={level}>
            <i style={{ background: LEVEL_COLOR[level] }} />
            {{ ok: 'Safe', watch: 'Careful', warn: 'Avoid', danger: 'Danger' }[level]}
          </span>
        ))}
      </div>
    </div>
  )
}
