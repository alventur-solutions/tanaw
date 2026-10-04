import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DOWN_COLOR,
  LOSS_COLOR,
  STUDY_TYPE_LABEL,
  UP_COLOR,
  fetchAreaData,
  fetchPoints,
  fetchProject,
  fetchAreas,
  fetchSummary,
  fetchZones,
  formatHa,
  formatPhp,
  regionOf,
  STUDY_TYPE_GROUP,
  STUDY_TYPE_ORDER,
  sumAmount,
  shortName,
  sumLoss,
  sumTotals,
} from './api'
import type { AreaData, AreaFeature, MetricRow, PointFeature, ProjectFeature, Summary } from './api'
import {
  CategoryBars,
  FundingYearChart,
  HeavyRainChart,
  RainChart,
  StatusList,
  TreeLossChart,
} from './charts'
import type { LossSeries } from './charts'
import AllAreas from './AllAreas'
import AreaBrief from './AreaBrief'
import AreaNav from './AreaNav'
import ForReview from './ForReview'
import { AREA_KEYS, readChoice, writeParams } from './urlState'
import MapView from './MapView'
import { mark } from './perf'
import ProjectCard from './ProjectCard'
import {
  categoryLede,
  URBAN_NOTE,
  estimatedCategories,
  fundingLede,
  heavyGroupsNote,
  heavyRainLede,
  lossLede,
  officeLede,
  officeNote,
  officeRows,
  placeLede,
  placeRows,
  rainLede,
  share,
  sideLede,
  sideLine,
  statusLede,
  zoneFinding,
  zoneLossLede,
  zoneSpendLede,
  unnamedPlaceLine,
} from './story'
import type { WaybackRelease } from './WaybackCompare'

const TABS = ['Land history', 'Funding', 'Side by side', 'For review'] as const
type Tab = (typeof TABS)[number]

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
  // The all-areas comparison under the intro. Null until GET /areas/summary answers.
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryFailed, setSummaryFailed] = useState(false)

  const selectArea = (areaId: string | null, others: string[] = []) => {
    // Keys that belong to the old area are dropped before the new area renders.
    writeParams(Object.fromEntries(AREA_KEYS.map((key) => [key, null])))
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
    fetchSummary().then(setSummary, () => setSummaryFailed(true))
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
    const ha = (id: string) =>
      topAreas.find((t) => t.properties.area_id === id)?.properties.area_ha ?? Number.POSITIVE_INFINITY
    return ha(a) - ha(b) || a.localeCompare(b)
  }
  // A bridge opens the next tab from its top, so the story reads in order.
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    writeParams({
      area: selectedId,
      tab: selectedId === null || tab === TABS[0] ? null : tab,
      project: projectId,
      compare: compare ? '1' : null,
    })
  }, [selectedId, tab, projectId, compare])

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

  // The printed brief exists once the area's own data has loaded. Print CSS then shows it alone.
  const briefReady = selected !== null && current !== undefined
  const printBrief = () => window.print()

  return (
    <div className={briefReady ? 'app has-brief' : 'app'}>
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
        <div className="masthead-actions">
        <a className="nav-link" href="/live-sensors">
          Live sensors
        </a>
        <button
          className="pill"
          aria-pressed={compare}
          disabled={releases.length < 2}
          onClick={() => setCompare(!compare)}
        >
          {compare ? 'Close imagery' : 'Compare imagery'}
        </button>
        </div>
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
              <AllAreas
                summary={summary}
                failed={summaryFailed}
                onSelect={(id) => selectArea(id)}
                onPreview={loadArea}
              />
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
                <button className="back print-brief" disabled={!briefReady} onClick={printBrief}>
                  Print area brief
                </button>
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
                <Funding current={current} up={up} down={down} hasZones={hasZones} linked={linked} onTab={openTab} />
              )}
              {current && tab === 'Side by side' && (
                <SideBySide selected={selected} current={current} up={up} down={down} hasZones={hasZones} linked={linked} onTab={openTab} />
              )}
              {current && tab === 'For review' && (
                <ForReview
                  selected={selected}
                  current={current}
                  linked={linked}
                  onProject={setProjectId}
                  onPrint={printBrief}
                />
              )}
            </>
          )}
        </aside>
      </main>
      {selected && current && (
        <div className="brief-print" aria-hidden="true">
          <AreaBrief
            selected={selected}
            current={current}
            up={up}
            down={down}
            hasZones={hasZones}
            linked={linked}
          />
        </div>
      )}
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
    <p className="context-note">{URBAN_NOTE}</p>
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

const hasHeavy = (rows?: MetricRow[]) => (rows ?? []).some((r) => r.metric === 'heavy_rain_days')

const ZONE_CHOICES = [
  { key: 'all', label: 'Whole area', place: 'here' },
  { key: 'up', label: 'Upstream', place: 'in the upstream zone' },
  { key: 'down', label: 'Downstream', place: 'in the downstream zone' },
] as const

function HeavyRainBeat({ rain, up, down }: { rain: MetricRow[]; up?: MetricRow[]; down?: MetricRow[] }) {
  const [zone, setZoneState] = useState(() => readChoice('rainzone', ['all', 'up', 'down'] as const, 'all'))
  const setZone = (next: 'all' | 'up' | 'down') => {
    setZoneState(next)
    writeParams({ rainzone: next === 'all' ? null : next })
  }
  // The toggle shows only when both zones have heavy rain rows. A zone still loading is not offered.
  const zoned = hasHeavy(up) && hasHeavy(down)
  const choice = ZONE_CHOICES.find((c) => c.key === (zoned ? zone : 'all')) ?? ZONE_CHOICES[0]
  const rows = choice.key === 'up' ? (up ?? []) : choice.key === 'down' ? (down ?? []) : rain
  const groups = heavyGroupsNote(rows)
  return (
    <section className="beat">
      <h3>How often did heavy rain fall here?</h3>
      {!hasHeavy(rain) ? (
        <p className="empty">
          Heavy rain day counts for this area are not loaded yet. No values are shown, so none of
          it should be read as zero days.
        </p>
      ) : (
        <>
          <p className="lede">{heavyRainLede(rows, choice.place)}</p>
          {zoned && (
            <div className="picker" role="group" aria-label="Part of the basin shown">
              {ZONE_CHOICES.map((c) => (
                <button key={c.key} aria-pressed={c.key === choice.key} onClick={() => setZone(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <p className="chart-label">
            Days with an area mean of 50 mm or more{choice.key === 'all' ? '' : `, ${choice.label.toLowerCase()} zone`}
          </p>
          <HeavyRainChart
            key={choice.key}
            rows={rows}
            color={choice.key === 'up' ? UP_COLOR : choice.key === 'down' ? DOWN_COLOR : undefined}
          />
          <ul className="caveats">
            <li>
              A heavy rain day here is a day when the CHIRPS area mean reached 50 mm. A local
              downpour can pass that mark on a day when the area mean does not.
            </li>
            <li>
              CHIRPS daily values tend to read low on extreme days, so these counts are lower than
              rain gauge counts.
            </li>
            <li>
              A larger area spreads rain over more ground, so its area mean reaches 50 mm on fewer
              days. Counts are not comparable between areas or zones of very different size.
            </li>
            {groups && <li>{groups}</li>}
            <li>A year that is not complete is left out of the groups.</li>
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
        <HeavyRainBeat key={selected.properties.area_id} rain={current.rain} up={up?.rain} down={down?.rain} />
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
                  {zone.value !== null &&
                    zone.value > 0 &&
                    zones.every((item) => item.value !== null) && (
                    <span
                      className="category-fill"
                      style={{
                        width: `${(zone.value / Math.max(...zones.map((item) => item.value!))) * 100}%`,
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
      <HeavyRainBeat key={selected.properties.area_id} rain={current.rain} up={up?.rain} down={down?.rain} />
      {bridge}
    </>
  )
}

function Funding({
  current,
  up,
  down,
  hasZones,
  linked,
  onTab,
}: Pick<PanelProps, 'current' | 'up' | 'down' | 'hasZones' | 'linked' | 'onTab'>) {
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
  const offices = officeRows(features)
  const officeRest = officeNote(features)
  const places = placeRows(features)
  const unnamed = unnamedPlaceLine(places)
  // Zone contracts are shown once both zones have arrived with at least one contract between them.
  const zoneSpend =
    hasZones && up !== undefined && down !== undefined &&
    up.projects.features.length + down.projects.features.length > 0
      ? { up: up.projects.features, down: down.projects.features }
      : null
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
            Contract cost is the contract budget listed by DPWH. This data does not show what was paid.
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
        <h3>Which DPWH offices hold the contracts here?</h3>
        <p className="lede">{officeLede(features)}</p>
        {offices.top.length > 0 && (
          <>
            <p className="chart-label">Contract cost by DPWH office or region, as listed</p>
            <PlaceBars rows={[...offices.top, ...(offices.rest ? [offices.rest] : [])]} />
            <GroupTable
              name="DPWH office or region, as listed"
              rows={[
                ...offices.top,
                ...(offices.rest ? [offices.rest] : []),
                ...(offices.unlisted ? [offices.unlisted] : []),
              ]}
            />
          </>
        )}
        <ul className="caveats">
          <li>The office is the one listed in the DPWH record. Being listed is not a finding about the office.</li>
          {officeRest && <li>{officeRest}</li>}
          <li>
            In the DPWH data this field is named province. It holds the office, not a province.
          </li>
          <li>The coordinates are the project site, not the area the project protects.</li>
          <li>Contract cost is the contract budget listed by DPWH. This data does not show what was paid.</li>
          {offices.rest && (
            <li>
              Offices after the first {offices.top.length} by contract cost are grouped as one bar.
            </li>
          )}
        </ul>
      </section>

      <section className="beat">
        <h3>Where in the area were the contracts sited?</h3>
        <p className="lede">{placeLede(features)}</p>
        {places.named > 0 && (
          <>
            <PlaceBars rows={[...places.top, ...(places.rest ? [places.rest] : [])]} />
            <GroupTable
              name="Municipality, as listed"
              rows={[...places.top, ...(places.rest ? [places.rest] : []), ...(places.unnamed ? [places.unnamed] : [])]}
            />
          </>
        )}
        {unnamed && <p className="chart-note">{unnamed}</p>}
        <ul className="caveats">
          <li>The municipality is as listed by DPWH.</li>
          <li>The coordinates are the project site, not the area the project protects.</li>
          <li>
            The province field in the DPWH data holds the DPWH office, so places are not grouped by
            province. The beat above groups contracts by that office.
          </li>
          {places.rest && (
            <li>Places after the first {places.top.length} by contract cost are grouped as one bar.</li>
          )}
        </ul>
      </section>

      {hasZones && zoneSpend === null && (
        <section className="beat">
          <p className="empty">{ZONES_NOT_LOADED}</p>
        </section>
      )}
      {zoneSpend && (
        <section className="beat">
          <h3>How much was sited upstream, and how much downstream?</h3>
          <p className="lede">{zoneSpendLede(zoneSpend.up, zoneSpend.down, min_year, max_year)}</p>
          <p className="chart-label">Contract cost</p>
          <ZonePair
            rows={[
              { label: 'Upstream', color: UP_COLOR, value: sumAmount(zoneSpend.up), text: formatPhp(sumAmount(zoneSpend.up)) },
              { label: 'Downstream', color: DOWN_COLOR, value: sumAmount(zoneSpend.down), text: formatPhp(sumAmount(zoneSpend.down)) },
            ]}
          />
          <p className="chart-label">Contracts</p>
          <ZonePair
            rows={[
              { label: 'Upstream', color: UP_COLOR, value: zoneSpend.up.length, text: zoneSpend.up.length.toLocaleString('en-PH') },
              { label: 'Downstream', color: DOWN_COLOR, value: zoneSpend.down.length, text: zoneSpend.down.length.toLocaleString('en-PH') },
            ]}
          />
          <ul className="caveats">
            <li>
              Flood control works are usually sited along rivers and in built-up places, so a
              lower upstream share of contract cost is expected. It is not a finding.
            </li>
            <li>The zones differ in size, so the figures are not a rate.</li>
            <li>
              Each point is the project site, not the area the project protects. A site near the
              zone line can fall on either side.
            </li>
          </ul>
        </section>
      )}

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

/** The rows of a bar list as a table, the same rows the bars draw. */
function GroupTable({ name, rows }: { name: string; rows: { label: string; count: number; amount: number | null; noCost: boolean }[] }) {
  return (
    <details className="table-view">
      <summary>Show as table</summary>
      <table>
        <thead>
          <tr>
            <th>{name}</th>
            <th>Contracts</th>
            <th>Contract cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td>{row.count.toLocaleString('en-PH')}</td>
              <td>{row.noCost ? 'No contract cost on record' : formatPhp(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Contract cost per place, the same rows the lede reads. */
function PlaceBars({ rows }: { rows: { label: string; count: number; amount: number | null; noCost: boolean }[] }) {
  const complete = rows.every((row) => row.amount !== null)
  const max = complete ? Math.max(...rows.map((row) => row.amount!), 0) : null
  return (
    <ul className="category-bars place-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="category-name">{row.label}</span>
          <span className="category-track">
            {row.amount !== null && row.amount > 0 && max !== null && max > 0 && (
              <span className="category-fill" style={{ width: `${(row.amount / max) * 100}%` }} />
            )}
          </span>
          <span className="category-value">
            {row.noCost ? 'No contract cost on record' : formatPhp(row.amount)},{' '}
            {row.count.toLocaleString('en-PH')} {row.count === 1 ? 'contract' : 'contracts'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Upstream against downstream for one measure. Bars start at zero. */
function ZonePair({ rows }: { rows: { label: string; color: string; value: number | null; text: string }[] }) {
  const complete = rows.every((row) => row.value !== null)
  const max = complete ? Math.max(...rows.map((row) => row.value!), 0) : null
  return (
    <ul className="category-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="category-name">{row.label}</span>
          <span className="category-track">
            {row.value !== null && row.value > 0 && max !== null && max > 0 && (
              <span className="category-fill" style={{ width: `${(row.value / max) * 100}%`, background: row.color }} />
            )}
          </span>
          <span className="category-value">{row.text}</span>
        </li>
      ))}
    </ul>
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
          A side by side view needs both, so none is shown. Data that is not loaded is not a measured zero.
        </p>
        <Bridge to="For review" onTab={onTab}>
          What could a reviewer check next?
        </Bridge>
      </section>
    )
  }
  const loss = sumLoss(current.loss, min_year, max_year)
  const amount = sumAmount(features)
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
  const zoneLossTotal = zonesLoaded
    ? sumTotals([sumLoss(up!.loss, min_year, max_year), sumLoss(down!.loss, min_year, max_year)])
    : null
  const zoneAmountTotal = zonesLoaded
    ? sumAmount([...up!.projects.features, ...down!.projects.features])
    : null

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
            Contract cost is the contract budget listed by DPWH. This data does not show what was paid. The year is
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
                <th>Share of the loss</th>
                <th>Share of the contract cost</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => (
                <tr key={zone.label}>
                  <th>{zone.label}</th>
                  <td>{formatHa(sumLoss(zone.data.loss, min_year, max_year))}</td>
                  <td>
                    {share(
                      sumLoss(zone.data.loss, min_year, max_year),
                      zoneLossTotal,
                    ) ?? 'No value'}
                  </td>
                  <td>
                    {share(
                      sumAmount(zone.data.projects.features),
                      zoneAmountTotal,
                    ) ?? 'No value'}
                  </td>
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
              Shares are of the two zones together. The Funding tab shows the contract cost and
              count in each zone.
            </li>
            <li>
              Each point is the project site, not the area the project protects. A site near the
              zone line can fall on either side.
            </li>
            <li>DPWH only. DENR and LGU work upstream does not appear in this data.</li>
          </ul>
        </section>
      )}

      <section className="beat">
        <p className="finding">
          TANAW shows a spending pattern for review. It does not show cause, and it does not judge
          any project.
        </p>
        <Bridge to="For review" onTab={onTab}>
          What could a reviewer check next?
        </Bridge>
      </section>
    </>
  )
}
