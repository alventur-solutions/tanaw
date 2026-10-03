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
import ProjectCard from './ProjectCard'
import type { WaybackRelease } from './WaybackCompare'

// The three study areas sit on one river system, from the mountain to the city street.
const RIVER_ORDER: StudyType[] = ['rural_upland', 'river_basin', 'urban']
const TABS = ['Land history', 'Funding', 'Side by side', 'Live sensors'] as const
type Tab = (typeof TABS)[number]

const UP_COLOR = '#b8742f'
const DOWN_COLOR = '#0f9e90'
const LOSS_COLOR = '#b8742f'

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
  const [projectId, setProjectId] = useState<string | null>(query.get('project'))
  const [releases, setReleases] = useState<WaybackRelease[]>([])
  const [compare, setCompare] = useState(query.get('compare') === '1')

  const selectArea = (areaId: string | null) => {
    setProjectId(null)
    setSelectedId(areaId)
  }

  useEffect(() => {
    fetchAreas().then(setAreas, () =>
      setError('The TANAW API is not answering. Start it with: uvicorn api.main:app'),
    )
    fetch('/data/wayback.json')
      .then((response) => response.json())
      .then((body: { releases: WaybackRelease[] }) => setReleases(body.releases))
      .catch(() => setReleases([]))
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
  const project = current?.projects.features.find((f) => f.properties.component_id === projectId)

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <svg width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" />
            <circle cx="22" cy="8" r="6.5" />
            <circle cx="8" cy="8" r="2.4" className="pupil" />
            <circle cx="22" cy="8" r="2.4" className="pupil" />
          </svg>
          <h1>TANAW</h1>
        </div>
        <nav className="nav" aria-label="Study areas, from mountain to city">
          <button className={selectedId === null ? 'active' : ''} onClick={() => selectArea(null)}>
            All areas
          </button>
          {topAreas.map((area) => (
            <button
              key={area.properties.area_id}
              className={area.properties.area_id === selectedId ? 'active' : ''}
              onClick={() => selectArea(area.properties.area_id)}
            >
              {STUDY_TYPE_LABEL[area.properties.study_type]}
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace">
        <MapView
          areas={areas}
          selectedId={selectedId}
          projects={current?.projects.features ?? []}
          selectedProjectId={projectId}
          releases={releases}
          compare={compare}
          onCompare={setCompare}
          onSelect={selectArea}
          onProject={setProjectId}
        />

        <aside className="panel">
          {error && <p className="error">{error}</p>}
          {!selected && !error && (
            <div className="intro">
              <h2>One river system, three places to look</h2>
              <p>
                Pick a study area above or on the map. Each one shows what satellites recorded on
                the land and where DPWH flood control projects are sited. Turn on Compare imagery
                on the map to see older and newer satellite imagery side by side.
              </p>
              <ul className="area-list">
                {topAreas.map((area) => (
                  <li key={area.properties.area_id}>
                    <button onClick={() => selectArea(area.properties.area_id)}>
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

          {selected && project && (
            <ProjectCard
              project={project}
              compare={compare}
              onCompare={setCompare}
              onClose={() => setProjectId(null)}
            />
          )}

          {selected && !project && (
            <>
              <div className="panel-head">
                <h2>{shortName(selected)}</h2>
                <p>
                  {STUDY_TYPE_LABEL[selected.properties.study_type]},{' '}
                  {formatHa(selected.properties.area_ha)}
                </p>
                {current && current.projects.features.length > 0 && (
                  <p className="hint">
                    Turn on Compare imagery on the map to see older and newer satellite imagery.
                    Select a project point to go to its site.
                  </p>
                )}
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
