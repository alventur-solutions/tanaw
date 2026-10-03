import { useEffect, useMemo, useState } from 'react'
import {
  CATEGORIES,
  STUDY_TYPE_LABEL,
  fetchAreaData,
  fetchAreas,
  formatHa,
  formatPhp,
  sumAmount,
  sumLoss,
} from './api'
import type { AreaData, AreaFeature, StudyType } from './api'
import { CategoryBars, FundingYearChart, TreeLossChart } from './charts'
import type { LossSeries } from './charts'
import MapView from './MapView'

// The three study areas sit on one river system, from the mountain to the city street.
const RIVER_ORDER: StudyType[] = ['rural_upland', 'river_basin', 'urban']
const TABS = ['Land history', 'Funding', 'Side by side', 'Live sensors'] as const
type Tab = (typeof TABS)[number]

const UP_COLOR = '#9a5b1e'
const DOWN_COLOR = '#00a39a'
const LOSS_COLOR = '#9a5b1e'

function shortName(area: AreaFeature): string {
  return area.properties.name.split(' (')[0]
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)} percent` : 'no share'
}

export default function App() {
  const [areas, setAreas] = useState<AreaFeature[]>([])
  const [error, setError] = useState<string | null>(null)
  // ?area=<area_id>&tab=<tab name> opens the page on that area and tab.
  const query = new URLSearchParams(location.search)
  const [selectedId, setSelectedId] = useState<string | null>(query.get('area'))
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t === query.get('tab')) ?? 'Land history')
  const [data, setData] = useState<Record<string, AreaData>>({})

  useEffect(() => {
    fetchAreas().then(setAreas, () =>
      setError('The TANAW API is not answering. Start it with: uvicorn api.main:app'),
    )
  }, [])

  const topAreas = useMemo(
    () =>
      areas
        .filter((a) => a.properties.zone === null)
        .sort(
          (a, b) =>
            RIVER_ORDER.indexOf(a.properties.study_type) -
            RIVER_ORDER.indexOf(b.properties.study_type),
        ),
    [areas],
  )
  const selected = topAreas.find((a) => a.properties.area_id === selectedId) ?? null
  const zoneIds = useMemo(
    () =>
      areas
        .filter((a) => selectedId !== null && a.properties.area_id.startsWith(`${selectedId}__`))
        .map((a) => a.properties.area_id),
    [areas, selectedId],
  )

  useEffect(() => {
    if (selectedId === null) return
    for (const id of [selectedId, ...zoneIds]) {
      if (data[id]) continue
      fetchAreaData(id).then(
        (loaded) => setData((current) => ({ ...current, [id]: loaded })),
        () => setError(`Could not load data for ${id}.`),
      )
    }
  }, [selectedId, zoneIds, data])

  const current = selectedId ? data[selectedId] : undefined
  const up = selectedId ? data[`${selectedId}__up`] : undefined
  const down = selectedId ? data[`${selectedId}__down`] : undefined
  const hasZones = zoneIds.length === 2

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <h1>TANAW</h1>
          <p>Land change and flood control spending, side by side</p>
        </div>
        <nav className="river" aria-label="Study areas, from mountain to city">
          <svg viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,60 L0,22 L28,6 L52,20 L80,4 L112,24 L150,30 C230,40 250,46 330,48 C420,50 480,52 600,52 L600,60 Z" />
          </svg>
          <button
            className={selectedId === null ? 'stop all active' : 'stop all'}
            onClick={() => setSelectedId(null)}
          >
            All areas
          </button>
          {topAreas.map((area) => (
            <button
              key={area.properties.area_id}
              className={area.properties.area_id === selectedId ? 'stop active' : 'stop'}
              onClick={() => setSelectedId(area.properties.area_id)}
            >
              <span className="stop-type">{STUDY_TYPE_LABEL[area.properties.study_type]}</span>
              <span className="stop-name">{shortName(area)}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace">
        <MapView
          areas={areas}
          selectedId={selectedId}
          projects={current?.projects.features ?? []}
          onSelect={setSelectedId}
        />

        <aside className="panel">
          {error && <p className="error">{error}</p>}
          {!selected && !error && (
            <div className="intro">
              <h2>One river system, three places to look</h2>
              <p>
                Pick a study area above or on the map. Each one shows what satellites recorded on
                the land and where DPWH flood control projects were built.
              </p>
              <ul className="area-list">
                {topAreas.map((area) => (
                  <li key={area.properties.area_id}>
                    <button onClick={() => setSelectedId(area.properties.area_id)}>
                      <strong>{shortName(area)}</strong>
                      <span>
                        {STUDY_TYPE_LABEL[area.properties.study_type]},{' '}
                        {formatHa(area.properties.area_ha)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="note">
                TANAW shows patterns for review. It does not show cause and it does not judge any
                project.
              </p>
            </div>
          )}

          {selected && (
            <>
              <div className="panel-head">
                <h2>{shortName(selected)}</h2>
                <p>
                  {STUDY_TYPE_LABEL[selected.properties.study_type]},{' '}
                  {formatHa(selected.properties.area_ha)}
                </p>
              </div>
              <div className="tabs" role="tablist">
                {TABS.map((name) => (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={tab === name}
                    className={tab === name ? 'active' : ''}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {!current && <p className="empty">Loading data for this area.</p>}
              {current && tab === 'Land history' && (
                <LandHistory selected={selected} current={current} up={up} down={down} hasZones={hasZones} />
              )}
              {current && tab === 'Funding' && <Funding current={current} />}
              {current && tab === 'Side by side' && (
                <SideBySide selected={selected} current={current} up={up} down={down} hasZones={hasZones} />
              )}
              {tab === 'Live sensors' && <LiveSensors />}
            </>
          )}
        </aside>
      </main>
    </div>
  )
}

interface PanelProps {
  selected: AreaFeature
  current: AreaData
  up?: AreaData
  down?: AreaData
  hasZones: boolean
}

function LandHistory({ selected, current, up, down, hasZones }: PanelProps) {
  const dataYears: [number, number] = [current.projects.min_year, current.projects.max_year]
  const series: LossSeries[] =
    hasZones && up && down
      ? [
          { key: 'down', label: 'Downstream', color: DOWN_COLOR, rows: down.loss },
          { key: 'up', label: 'Upstream', color: UP_COLOR, rows: up.loss },
        ]
      : [{ key: 'all', label: 'Tree cover loss', color: LOSS_COLOR, rows: current.loss }]
  const years = current.loss.map((r) => r.year)
  const all = sumLoss(current.loss, Math.min(...years), Math.max(...years))

  return (
    <section>
      <h3>Tree cover loss per year, in hectares</h3>
      <p className="lede">
        {formatHa(all)} of tree cover loss recorded from {Math.min(...years)} to{' '}
        {Math.max(...years)}.
      </p>
      <TreeLossChart series={series} windowYears={dataYears} />
      <ul className="caveats">
        <li>
          Tree cover loss is canopy removed for any reason: clearing, fire, storm damage, landslide,
          or plantation harvest.
        </li>
        <li>
          Detection improved from 2011 and again from 2015, so compare groups of years, not single
          years.
        </li>
        {selected.properties.study_type === 'urban' && (
          <li>
            For a city this is supporting evidence only. Built-up surface and green space are not
            computed yet.
          </li>
        )}
        <li>Source: {current.loss[0]?.source_version ?? 'Hansen Global Forest Change'}</li>
      </ul>
    </section>
  )
}

function Funding({ current }: { current: AreaData }) {
  const { features, min_year, max_year } = current.projects
  const years = Array.from({ length: max_year - min_year + 1 }, (_, i) => min_year + i)
  if (features.length === 0) {
    return (
      <p className="empty">
        No DPWH flood control projects are recorded inside this area for {min_year} to {max_year}.
      </p>
    )
  }
  return (
    <section>
      <h3>
        DPWH flood control projects, {min_year} to {max_year}
      </h3>
      <p className="lede">
        {features.length.toLocaleString('en-PH')} projects with a total contract cost of{' '}
        {formatPhp(sumAmount(features))}.
      </p>
      <FundingYearChart projects={features} years={years} />
      <h3>By type of work</h3>
      <CategoryBars projects={features} />
      <ul className="caveats">
        <li>Coverage outside {min_year} to {max_year} is partial, so those years are left out.</li>
        <li>Each point is the project site, not the area the project protects.</li>
        <li>
          Study areas overlap. A project counts in every area it falls in, so totals must not be
          added across areas.
        </li>
        <li>DPWH only. DENR, LGU, and other agency spending is not included.</li>
      </ul>
    </section>
  )
}

function SideBySide({ selected, current, up, down, hasZones }: PanelProps) {
  const { features, min_year, max_year } = current.projects
  const loss = sumLoss(current.loss, min_year, max_year)
  const amount = sumAmount(features)
  const missing = CATEGORIES.filter((c) => !features.some((f) => f.properties.category === c.key))
  const zones =
    hasZones && up && down
      ? [
          { label: 'Upstream', data: up },
          { label: 'Downstream', data: down },
        ]
      : []

  return (
    <section>
      <h3>
        Land and spending, {min_year} to {max_year}
      </h3>
      <dl className="pair">
        <div>
          <dt>Tree cover loss</dt>
          <dd>{formatHa(loss)}</dd>
        </div>
        <div>
          <dt>DPWH flood control</dt>
          <dd>{formatPhp(amount)}</dd>
          <dd className="sub">{features.length.toLocaleString('en-PH')} projects</dd>
        </div>
      </dl>

      {zones.length > 0 && (
        <>
          <table className="zones">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Tree cover loss</th>
                <th>Projects</th>
                <th>Contract cost</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.label}>
                  <th>{zone.label}</th>
                  <td>{formatHa(sumLoss(zone.data.loss, min_year, max_year))}</td>
                  <td>{zone.data.projects.features.length.toLocaleString('en-PH')}</td>
                  <td>{formatPhp(sumAmount(zone.data.projects.features))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="finding">
            Upstream holds {percent(sumLoss(up!.loss, min_year, max_year), loss)} of the basin's
            tree cover loss and {percent(sumAmount(up!.projects.features), amount)} of its DPWH
            flood control spending in these years. This is a spending pattern for review, read
            together with DENR and LGU records.
          </p>
        </>
      )}

      {missing.length > 0 && (
        <p className="finding">
          No {missing.map((c) => c.label.toLowerCase()).join(' or ')} projects appear in the DPWH
          data for {shortName(selected)} in these years.
        </p>
      )}

      <ul className="caveats">
        <li>These figures sit side by side. They do not show that one caused the other.</li>
        <li>Project points mark the construction site, not the area a project protects.</li>
        <li>The funding data is DPWH only and covers {min_year} to {max_year}.</li>
        <li>Tree cover loss includes storm and fire damage, not only clearing.</li>
      </ul>
    </section>
  )
}

function LiveSensors() {
  return (
    <section>
      <h3>Flood stations</h3>
      <p className="empty">
        No station is sending readings yet. The station reads temperature, humidity, and water
        level on the device. Readings will appear here once it is connected to the network.
      </p>
    </section>
  )
}
