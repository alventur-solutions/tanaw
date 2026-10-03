import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STUDY_TYPE_LABEL,
  fetchAreaData,
  fetchPoints,
  fetchProject,
  fetchAreas,
  fetchZones,
  formatHa,
  formatPhp,
  regionOf,
  STUDY_TYPE_GROUP,
  STUDY_TYPE_ORDER,
  sumAmount,
  shortName,
  sumLoss,
} from './api'
import type { AreaData, AreaFeature, MetricRow, PointFeature, ProjectFeature } from './api'
import { CategoryBars, FundingYearChart, RainChart, StatusList, TreeLossChart } from './charts'
import type { LossSeries } from './charts'
import AreaNav from './AreaNav'
import MapView from './MapView'
import { mark } from './perf'
import ProjectCard from './ProjectCard'
import {
  categoryLede,
  estimatedCategories,
  fundingLede,
  listOr,
  lossLede,
  missingCategories,
  rainLede,
  sideLede,
  sideLine,
  statusLede,
  zoneFinding,
  zoneLossLede,
} from './story'
import type { WaybackRelease } from './WaybackCompare'

const TABS = ['Land history', 'Funding', 'Side by side', 'Live sensors'] as const
type Tab = (typeof TABS)[number]

const UP_COLOR = '#9a5b1e'
const DOWN_COLOR = '#00a39a'
const LOSS_COLOR = '#9a5b1e'

export default function App() {
  const [areas, setAreas] = useState<AreaFeature[]>([])
  const [error, setError] = useState<string | null>(null)
  // ?area=<area_id>&tab=<tab name> opens the page on that area and tab.
  const query = new URLSearchParams(location.search)
  const [selectedId, setSelectedId] = useState<string | null>(query.get('area'))
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t === query.get('tab')) ?? 'Land history')
  const [data, setData] = useState<Record<string, AreaData>>({})
  const [projectId, setProjectId] = useState<string | null>(query.get('project'))
  const [points, setPoints] = useState<PointFeature[]>([])
  const [project, setProject] = useState<ProjectFeature | null>(null)
  const [releases, setReleases] = useState<WaybackRelease[]>([])
  const [compare, setCompare] = useState(query.get('compare') === '1')

  const [zones, setZones] = useState<Record<string, AreaFeature[]>>({})
  // Other areas under the last map click, smallest first. The panel offers them.
  const [alternatives, setAlternatives] = useState<string[]>([])
  const [filter, setFilter] = useState('')

  const selectArea = (areaId: string | null, others: string[] = []) => {
    setProjectId(null)
    setSelectedId(areaId)
    setAlternatives(others)
  }

  useEffect(() => {
    fetchAreas().then(
      (loaded) => {
        mark('areas-loaded')
        setAreas(loaded)
      },
      () => setError('The TANAW API is not answering. Start it with: uvicorn api.main:app'),
    )
    fetchPoints().then(setPoints, () => setError('Could not load the project sites.'))
    fetch('/data/wayback.json')
      .then((response) => response.json())
      .then((body: { releases: WaybackRelease[] }) => setReleases(body.releases))
      .catch(() => setReleases([]))
  }, [])

  // The overview holds top-level areas only. Zones load for the selected area.
  const topAreas = useMemo(() => areas.filter((a) => a.properties.zone === null), [areas])
  const selected = topAreas.find((a) => a.properties.area_id === selectedId) ?? null
  const zoneIdsOf = useCallback(
    (id: string) =>
      topAreas.find((a) => a.properties.area_id === id)?.properties.has_zones
        ? [`${id}__up`, `${id}__down`]
        : [],
    [topAreas],
  )

  // Area data is cached by area_id. Hovering a menu item loads it ahead of the click.
  const inflight = useRef(new Set<string>())
  const dataRef = useRef(data)
  dataRef.current = data
  const loadArea = useCallback(
    (areaId: string) => {
      for (const id of [areaId, ...zoneIdsOf(areaId)]) {
        if (dataRef.current[id] || inflight.current.has(id)) continue
        inflight.current.add(id)
        fetchAreaData(id)
          .then(
            (loaded) => setData((current) => ({ ...current, [id]: loaded })),
            () => setError(`Could not load data for ${id}.`),
          )
          .finally(() => inflight.current.delete(id))
      }
    },
    [zoneIdsOf],
  )

  useEffect(() => {
    if (selectedId === null || selected === null) return
    loadArea(selectedId)
    if (selected.properties.has_zones && !zones[selectedId]) {
      fetchZones(selectedId).then(
        (loaded) => setZones((current) => ({ ...current, [selectedId]: loaded })),
        () => setError(`Could not load the zone outlines for ${selectedId}.`),
      )
    }
  }, [selectedId, selected, loadArea, zones])

  const current = selectedId ? data[selectedId] : undefined
  const up = selectedId ? data[`${selectedId}__up`] : undefined
  const down = selectedId ? data[`${selectedId}__down`] : undefined
  const hasZones = selectedId !== null && zoneIdsOf(selectedId).length === 2

  useEffect(() => {
    setProject(null)
    if (projectId === null) return
    let stale = false
    fetchProject(projectId).then(
      (loaded) => !stale && setProject(loaded),
      () => !stale && setError(`Could not load project ${projectId}.`),
    )
    return () => {
      stale = true
    }
  }, [projectId])

  // Not linked yet: no rows in funding_project_areas for this area_id. This cannot tell a true
  // zero from a reload that has not run. A finished-reload marker would let the two be told apart.
  const linked = selected
    ? (selected.properties.projects_linked ?? (current?.projects.features.length ?? 0) > 0)
    : false
  const byHectares = (a: string, b: string) => {
    const ha = (id: string) => topAreas.find((t) => t.properties.area_id === id)?.properties.area_ha ?? 0
    return ha(a) - ha(b) || a.localeCompare(b)
  }
  // A bridge opens the next tab from its top, so the story reads in order.
  const panelRef = useRef<HTMLElement>(null)
  const openTab = (name: Tab) => {
    setTab(name)
    panelRef.current?.scrollTo({ top: 0 })
  }
  // The area whose story a selected contract belongs to. Links come from funding_project_areas.
  const projectAreas = (project?.area_ids ?? [])
    .map((id) => topAreas.find((a) => a.properties.area_id === id))
    .filter((a): a is AreaFeature => a !== undefined)
    .sort((a, b) => byHectares(a.properties.area_id, b.properties.area_id))
  const storyArea = projectAreas.find((a) => a === selected) ?? projectAreas[0] ?? null
  const storyAreaId = storyArea?.properties.area_id ?? null
  useEffect(() => {
    if (storyAreaId !== null) loadArea(storyAreaId)
  }, [storyAreaId, loadArea])
  const others = alternatives
    .map((id) => topAreas.find((a) => a.properties.area_id === id))
    .filter((a): a is AreaFeature => a !== undefined && a !== selected)

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <img src="/assets/tanaw-mark.png" alt="" />
          <h1>Tanaw</h1>
        </div>
        <AreaNav
          areas={topAreas}
          selectedId={selectedId}
          onSelect={(id) => selectArea(id)}
          onPreview={loadArea}
        />
        <button
          className="pill"
          aria-pressed={compare}
          disabled={releases.length < 2}
          onClick={() => setCompare(!compare)}
        >
          {compare ? 'Close imagery' : 'Compare imagery'}
        </button>
      </header>

      <main className="workspace">
        <MapView
          areas={topAreas}
          zones={selectedId ? (zones[selectedId] ?? []) : []}
          selectedId={selectedId}
          projects={points}
          selectedProjectId={projectId}
          releases={releases}
          compare={compare}
          onSelect={selectArea}
          onProject={setProjectId}
        />

        <aside className="panel" ref={panelRef}>
          {error && <p className="error">{error}</p>}
          {!selected && !project && !error && (
            <div className="intro">
              <p className="eyebrow">Land change and flood control spending</p>
              <h2>
                Study areas across
                <br />
                <strong>the Philippines.</strong>
              </h2>
              <p>
                {topAreas.length > 0 ? `${topAreas.length} study areas` : 'The study areas'}: river
                basins in Luzon, Visayas, and Mindanao, plus an upland forest and a city in Metro
                Manila. Pick one from the menu above, from the list, or on the map. Each shows what
                satellites recorded on the land and the DPWH flood control spending inside it. Every
                circle on the map is a DPWH flood control project site, from{' '}
                {points.length.toLocaleString('en-PH')} projects with coordinates. Select one to see
                its record. Compare imagery shows older and newer satellite imagery side by side.
              </p>
              <input
                className="area-filter"
                type="search"
                value={filter}
                placeholder="Filter the list by name or island group"
                aria-label="Filter study areas"
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="area-groups">
                {STUDY_TYPE_ORDER.map((type) => {
                  const text = filter.trim().toLowerCase()
                  const items = topAreas
                    .filter((a) => a.properties.study_type === type)
                    .filter((a) =>
                      `${shortName(a)} ${regionOf(a.properties.area_id) ?? ''}`
                        .toLowerCase()
                        .includes(text),
                    )
                    .sort((a, b) => shortName(a).localeCompare(shortName(b)))
                  if (items.length === 0) return null
                  return (
                    <section key={type}>
                      <h3>{STUDY_TYPE_GROUP[type]}</h3>
                      <ul className="area-list">
                        {items.map((area) => (
                          <li key={area.properties.area_id}>
                            <button
                              onClick={() => selectArea(area.properties.area_id)}
                              onMouseEnter={() => loadArea(area.properties.area_id)}
                            >
                              <strong>{shortName(area)}</strong>
                              <span>
                                {regionOf(area.properties.area_id) ?? ''}
                                {regionOf(area.properties.area_id) ? ', ' : ''}
                                {formatHa(area.properties.area_ha)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </div>
              <p className="note">
                TANAW shows patterns for review. It does not show cause and it does not judge any
                project. Study areas overlap, so figures for one area must not be added to another.
              </p>
            </div>
          )}

          {project && (
            <ProjectCard
              project={project}
              area={storyArea}
              areaData={storyAreaId ? data[storyAreaId] : undefined}
              cameFrom={selected}
              compare={compare}
              onCompare={setCompare}
              onClose={() => setProjectId(null)}
              onStory={(areaId) => {
                if (areaId === selectedId) setProjectId(null)
                else selectArea(areaId)
                openTab('Funding')
              }}
            />
          )}

          {selected && !project && (
            <>
              <div className="panel-head">
                <p className="eyebrow">{STUDY_TYPE_LABEL[selected.properties.study_type]}</p>
                <h2>{shortName(selected)}</h2>
                <ul className="specs">
                  <li>{formatHa(selected.properties.area_ha)}</li>
                  {current && linked && (
                    <>
                      <li>
                        {current.projects.features.length.toLocaleString('en-PH')} DPWH projects
                      </li>
                      <li>
                        {current.projects.min_year} to {current.projects.max_year}
                      </li>
                    </>
                  )}
                  {current && !linked && <li>DPWH projects not linked yet</li>}
                </ul>
                {others.length > 0 && (
                  <div className="overlap">
                    <p>
                      Other study areas overlap this spot. Each is measured on its own, so their
                      figures must not be added together.
                    </p>
                    <ul>
                      {others.map((area) => (
                        <li key={area.properties.area_id}>
                          <button
                            onClick={() =>
                              selectArea(
                                area.properties.area_id,
                                [selected.properties.area_id, ...others
                                  .filter((o) => o !== area)
                                  .map((o) => o.properties.area_id)].sort(byHectares),
                              )
                            }
                            onMouseEnter={() => loadArea(area.properties.area_id)}
                          >
                            {shortName(area)}, {formatHa(area.properties.area_ha)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
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
                <LandHistory selected={selected} current={current} up={up} down={down} hasZones={hasZones} linked={linked} onTab={openTab} />
              )}
              {current && tab === 'Funding' && (
                <Funding current={current} linked={linked} onTab={openTab} />
              )}
              {current && tab === 'Side by side' && (
                <SideBySide selected={selected} current={current} up={up} down={down} hasZones={hasZones} linked={linked} onTab={openTab} />
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
  // False when no DPWH project is linked to this area yet.
  linked: boolean
  onTab: (tab: Tab) => void
}

/** The line that ends a tab and opens the next one. */
function Bridge({ to, onTab, children }: { to: Tab; onTab: (tab: Tab) => void; children: string }) {
  return (
    <button className="bridge" onClick={() => onTab(to)}>
      <span>Next: {to}</span>
      {children}
    </button>
  )
}

/** Shown wherever a city's panel leads with tree cover loss. */
function UrbanNote() {
  return (
    <p className="context-note">
      Built-up surface and green space are not computed for this area yet. They are the land
      measures for a city. Tree cover loss is shown as supporting evidence only.
    </p>
  )
}

const ZONES_NOT_LOADED =
  'Upstream and downstream figures are not loaded for this basin yet. No values are shown, so none of it should be read as zero.'

function RainBeat({ rain }: { rain: MetricRow[] }) {
  return (
    <section className="beat">
      <h3>How much rain fell here each year?</h3>
      {rain.length === 0 ? (
        <p className="empty">
          Rainfall metrics for this area are not loaded yet. No values are shown, so none of it
          should be read as zero rainfall.
        </p>
      ) : (
        <>
          <p className="lede">{rainLede(rain)}</p>
          <RainChart rows={rain} />
          <ul className="caveats">
            <li>
              Rainfall is the area mean from CHIRPS, at about 5.5 km per pixel. A local downpour can
              be heavier than the area mean.
            </li>
            <li>
              CHIRPS is a satellite and rain gauge estimate. Its daily values tend to read low on
              extreme days, so the wettest day and the count of heavy days are lower than gauge
              readings.
            </li>
            <li>
              Rainfall is not flooding. Flood extent is not computed for this area yet, so this
              panel does not show where or how often water stood.
            </li>
            <li>Source: {rain[0]?.source_version ?? 'CHIRPS Daily'}</li>
          </ul>
        </>
      )}
    </section>
  )
}

function LandHistory({ selected, current, up, down, hasZones, onTab }: PanelProps) {
  const urban = selected.properties.study_type === 'urban'
  const bridge = (
    <Bridge to="Funding" onTab={onTab}>
      What was spent on flood control here?
    </Bridge>
  )
  if (current.loss.length === 0) {
    return (
      <>
        {urban && <UrbanNote />}
        <section className="beat">
          <h3>Tree cover loss per year, in hectares</h3>
          <p className="empty">
            Tree cover loss for this area is not loaded yet. No values are shown, so none of it
            should be read as zero hectares.
          </p>
        </section>
        <RainBeat rain={current.rain} />
        {bridge}
      </>
    )
  }
  const dataYears: [number, number] = [current.projects.min_year, current.projects.max_year]
  // Zone rows must be loaded for both zones. An empty zone is not a measured zero.
  const zoned =
    hasZones && up !== undefined && down !== undefined && up.loss.length > 0 && down.loss.length > 0
  const series: LossSeries[] = zoned
    ? [
        { key: 'down', label: 'Downstream', color: DOWN_COLOR, rows: down.loss },
        { key: 'up', label: 'Upstream', color: UP_COLOR, rows: up.loss },
      ]
    : [{ key: 'all', label: 'Tree cover loss', color: LOSS_COLOR, rows: current.loss }]
  const years = current.loss.map((r) => r.year)
  const from = Math.min(...years)
  const to = Math.max(...years)

  return (
    <>
      {urban && <UrbanNote />}
      <section className="beat">
        <h3>How much tree cover was lost here, and when?</h3>
        <p className="lede">{lossLede(current.loss, from, to)}</p>
        <TreeLossChart series={series} windowYears={dataYears} />
        <ul className="caveats">
          <li>
            Tree cover loss is canopy removed for any reason: clearing, fire, storm damage,
            landslide, or plantation harvest.
          </li>
          <li>
            This is gross loss on land that had 30 percent tree canopy or more in 2000. Regrowth and
            new planting are not subtracted, so it is not the net change in tree cover.
          </li>
          <li>
            Detection improved from 2011 and again from 2015, so compare groups of years, not single
            years.
          </li>
          <li>Loss from a storm late in the year can be dated to the following year.</li>
          <li>Source: {current.loss[0]?.source_version ?? 'Hansen Global Forest Change'}</li>
        </ul>
      </section>

      {hasZones && !zoned && (
        <section className="beat">
          <p className="empty">{ZONES_NOT_LOADED}</p>
        </section>
      )}
      {zoned && (
        <section className="beat">
          <h3>Where in the basin was the loss recorded?</h3>
          <p className="lede">{zoneLossLede(up.loss, down.loss, from, to)}</p>
          <ul className="category-bars">
            {[
              { label: 'Upstream', color: UP_COLOR, value: sumLoss(up.loss, from, to) },
              { label: 'Downstream', color: DOWN_COLOR, value: sumLoss(down.loss, from, to) },
            ].map((zone, _, zones) => (
              <li key={zone.label}>
                <span className="category-name">{zone.label}</span>
                <span className="category-track">
                  {zone.value > 0 && (
                    <span
                      className="category-fill"
                      style={{
                        width: `${(zone.value / Math.max(...zones.map((z) => z.value))) * 100}%`,
                        background: zone.color,
                      }}
                    />
                  )}
                </span>
                <span className="category-value">{formatHa(zone.value)}</span>
              </li>
            ))}
          </ul>
          <ul className="caveats">
            <li>The zones differ in size and in tree cover, so hectares are not a rate.</li>
          </ul>
        </section>
      )}

      <RainBeat rain={current.rain} />
      {bridge}
    </>
  )
}

function Funding({ current, linked, onTab }: Pick<PanelProps, 'current' | 'linked' | 'onTab'>) {
  const { features, min_year, max_year } = current.projects
  const years = Array.from({ length: max_year - min_year + 1 }, (_, i) => min_year + i)
  const bridge = (
    <Bridge to="Side by side" onTab={onTab}>
      Where does the spending sit relative to the land change?
    </Bridge>
  )
  if (!linked) {
    return (
      <section className="beat">
        <p className="empty">
          DPWH flood control projects have not been linked to this area yet. This is not a count of
          zero. Figures will appear once the funding data is loaded for it.
        </p>
        {bridge}
      </section>
    )
  }
  if (features.length === 0) {
    return (
      <section className="beat">
        <p className="empty">
          No DPWH flood control projects are recorded inside this area for {min_year} to {max_year}.
        </p>
        {bridge}
      </section>
    )
  }
  const estimates = estimatedCategories(features)
  return (
    <>
      <section className="beat">
        <h3>What was spent on flood control here?</h3>
        <p className="lede">{fundingLede(features, min_year, max_year)}</p>
        <FundingYearChart projects={features} years={years} />
        <ul className="caveats">
          <li>
            Years outside {min_year} to {max_year} are not complete in the DPWH data, so they are
            left out.
          </li>
          <li>
            Contract cost is the contract budget listed by DPWH. It is not the amount paid.
          </li>
          <li>
            The year is the DPWH infrastructure year, which can differ from the year the work was
            built.
          </li>
          <li>
            Study areas overlap. A contract counts in every area it falls in, so totals must not
            be added across areas.
          </li>
          <li>DPWH only. DENR, LGU, and other agency spending is not included.</li>
        </ul>
      </section>

      <section className="beat">
        <h3>What kind of work was funded?</h3>
        <p className="lede">{categoryLede(features)}</p>
        <CategoryBars projects={features} />
        <ul className="caveats">
          <li>
            {estimates === 0
              ? 'Every contract here lists a type of work in the source.'
              : `${estimates.toLocaleString('en-PH')} of ${features.length.toLocaleString('en-PH')} contracts list no type of work in the source. Their category is read from the contract description and is an estimate.`}
          </li>
          <li>Each point is the project site, not the area the project protects.</li>
        </ul>
      </section>

      <section className="beat">
        <h3>What do DPWH records report for these contracts?</h3>
        <p className="lede">{statusLede(features)}</p>
        <StatusList projects={features} />
        <ul className="caveats">
          <li>Status is as reported by DPWH. TANAW has not checked it on site.</li>
        </ul>
      </section>
      {bridge}
    </>
  )
}

function SideBySide({ selected, current, up, down, hasZones, linked, onTab }: PanelProps) {
  const [year, setYear] = useState<number | null>(null)
  const { features, min_year, max_year } = current.projects
  const urban = selected.properties.study_type === 'urban'
  const windowLoss = current.loss.filter((r) => r.year >= min_year && r.year <= max_year)
  const hasLoss = windowLoss.length > 0
  if (!hasLoss || !linked) {
    return (
      <section className="beat">
        <h3>
          Land and spending, {min_year} to {max_year}
        </h3>
        <p className="empty">
          {!hasLoss && 'Satellite metrics for this area are not loaded yet. '}
          {!linked && 'DPWH projects are not linked to this area yet. '}
          A side by side view needs both, so none is shown. Missing data is not a measured zero.
        </p>
      </section>
    )
  }
  const loss = sumLoss(current.loss, min_year, max_year)
  const amount = sumAmount(features)
  const missing = missingCategories(features)
  const years = Array.from({ length: max_year - min_year + 1 }, (_, i) => min_year + i)
  // Both zones need loss rows and at least one linked contract between them. Empty is not zero.
  const zonesLoaded =
    up !== undefined &&
    down !== undefined &&
    up.loss.length > 0 &&
    down.loss.length > 0 &&
    up.projects.features.length + down.projects.features.length > 0
  const zones =
    hasZones && zonesLoaded && up && down
      ? [
          { label: 'Upstream', data: up },
          { label: 'Downstream', data: down },
        ]
      : []

  return (
    <>
      {urban && <UrbanNote />}
      <section className="beat">
        <h3>Where does the spending sit relative to the land change?</h3>
        <p className="lede">{sideLede(current.loss, features, min_year, max_year)}</p>
        <p className="chart-label">Tree cover loss per year, in hectares</p>
        <TreeLossChart
          series={[{ key: 'all', label: 'Tree cover loss', color: LOSS_COLOR, rows: windowLoss }]}
          activeYear={year}
          onYear={setYear}
        />
        <p className="chart-label">DPWH flood control contract cost per year</p>
        <FundingYearChart projects={features} years={years} activeYear={year} onYear={setYear} />
        <p className="live" aria-live="polite">
          {sideLine(current.loss, features, year)}
        </p>
        <ul className="caveats">
          <li>These figures sit side by side. They do not show that one caused the other.</li>
          <li>Project points mark the construction site, not the area a project protects.</li>
          <li>Tree cover loss includes storm and fire damage, not only clearing.</li>
          <li>
            Contract cost is the contract budget listed by DPWH, not the amount paid. The year is
            the DPWH infrastructure year, which can differ from the year the work was built.
          </li>
        </ul>
      </section>

      {hasZones && zones.length === 0 && (
        <section className="beat">
          <p className="empty">{ZONES_NOT_LOADED}</p>
        </section>
      )}
      {zones.length > 0 && (
        <section className="beat">
          <h3>How do upstream and downstream compare?</h3>
          <p className="lede">
            {zoneFinding(
              sumLoss(up!.loss, min_year, max_year),
              loss,
              sumAmount(up!.projects.features),
              amount,
            )}
          </p>
          <table className="zones">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Tree cover loss</th>
                <th>Contracts</th>
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
          <ul className="caveats">
            <li>
              Flood control works are usually sited along rivers and in built-up places, so a
              lower upstream share of contract cost is expected. It is not a finding.
            </li>
            <li>The zones differ in size and in tree cover, so hectares are not a rate.</li>
            <li>
              Each point is the project site, not the area the project protects. A site near the
              zone line can fall on either side.
            </li>
            <li>DPWH only. DENR and LGU work upstream does not appear in this data.</li>
          </ul>
        </section>
      )}

      <section className="beat">
        <h3>What could a reviewer check next?</h3>
        <ul className="next-steps">
          {missing.length > 0 && (
            <li>
              No {listOr(missing)} contracts appear in the DPWH data here for {min_year} to{' '}
              {max_year}. DENR, LGU, or other agency records may hold that work. Categories are
              partly estimates read from contract descriptions.
            </li>
          )}
          <li>DENR National Greening Program records for the same years and places.</li>
          <li>LGU DRRM fund use inside this area.</li>
          <li>A site visit to see the works and the land around them as they are today.</li>
        </ul>
        <p className="finding">
          TANAW shows a spending pattern for review. It does not show cause, and it does not judge
          any project.
        </p>
        <Bridge to="Live sensors" onTab={onTab}>
          What are the stations reading now?
        </Bridge>
      </section>
    </>
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
