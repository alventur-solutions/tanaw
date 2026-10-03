"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AreaData, AreaFeature, ProjectFeature } from "@/lib/api";
import {
  CATEGORIES,
  fetchAreas,
  fetchAreaData,
  formatPhp,
  STUDY_TYPE_LABEL,
} from "@/lib/api";
import type { ImageryCatalog, ImageryRelease } from "@/lib/imagery";
import {
  formatImageryDate,
  releasesAroundProject,
  releaseForYear,
  visibleReleases,
} from "@/lib/imagery";
import type { MapMode, MapSelection, MapStatus } from "@/components/area-map";

const AreaMap = dynamic(
  () => import("@/components/area-map").then((module) => module.AreaMap),
  {
    ssr: false,
    loading: () => (
      <div className="map-loading" role="status">
        Opening map…
      </div>
    ),
  },
);

function centerOf(area: AreaFeature): [number, number] {
  const bounds = {
    west: Infinity,
    east: -Infinity,
    south: Infinity,
    north: -Infinity,
  };
  function walk(value: unknown): void {
    if (
      Array.isArray(value) &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      bounds.west = Math.min(bounds.west, value[0]);
      bounds.east = Math.max(bounds.east, value[0]);
      bounds.south = Math.min(bounds.south, value[1]);
      bounds.north = Math.max(bounds.north, value[1]);
    } else if (Array.isArray(value)) value.forEach(walk);
  }
  if (area.geometry.type === "GeometryCollection") {
    walk(area.geometry.geometries);
  } else {
    walk(area.geometry.coordinates);
  }
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

function Icon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.7" cy="10.7" r="6.7" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

export function AtlasDashboard() {
  const [areas, setAreas] = useState<AreaFeature[]>([]);
  const [dataByArea, setDataByArea] = useState<Record<string, AreaData>>({});
  const [catalog, setCatalog] = useState<ImageryCatalog | null>(null);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<MapMode>("satellite");
  const [compare, setCompare] = useState(false);
  const [before, setBefore] = useState<ImageryRelease | null>(null);
  const [after, setAfter] = useState<ImageryRelease | null>(null);
  const [position, setPosition] = useState(50);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dataError, setDataError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [aboutOpen, setAboutOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const initialArea = useRef<string | null>(null);
  const initialProject = useRef<string | null>(null);
  const initialBefore = useRef<string | null>(null);
  const initialAfter = useRef<string | null>(null);
  const comparisonProjectId = useRef<string | null>(null);
  const restored = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setDataError("");
    try {
      const foundAreas = await fetchAreas();
      setAreas(foundAreas);
      const parentAreas = foundAreas.filter(
        (area) => area.properties.zone === null,
      );
      const results = await Promise.allSettled(
        parentAreas.map((area) => fetchAreaData(area)),
      );
      const next: Record<string, AreaData> = {};
      for (const result of results) {
        if (result.status === "fulfilled") {
          next[result.value.area.properties.area_id] = result.value;
        } else {
          setDataError(
            result.reason instanceof Error
              ? result.reason.message
              : "Some map data did not load.",
          );
        }
      }
      setDataByArea(next);
      if (parentAreas.length === 0)
        setDataError("The API has no study areas yet.");
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : "Could not load map data.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    initialArea.current = params.get("area");
    initialProject.current = params.get("project");
    initialBefore.current = params.get("before");
    initialAfter.current = params.get("after");
    const split = Number(params.get("split"));
    if (Number.isFinite(split)) setPosition(Math.max(0, Math.min(100, split)));
    void reload();
    fetch("/data/imagery-releases.json")
      .then((response) => {
        if (!response.ok) throw new Error("Archive dates are unavailable.");
        return response.json();
      })
      .then((value: ImageryCatalog) => setCatalog(value))
      .catch(() => setCatalog({ sourceUrl: "", releases: [] }));
  }, [reload]);

  const releases = useMemo(
    () => visibleReleases(catalog?.releases ?? []),
    [catalog],
  );
  useEffect(() => {
    if (!catalog?.releases.length) return;
    const older = releaseForYear(catalog.releases, 2020);
    const newer = releaseForYear(catalog.releases, 2024);
    const requestedBefore = catalog.releases.find(
      (item) => item.id === initialBefore.current,
    );
    const requestedAfter = catalog.releases.find(
      (item) => item.id === initialAfter.current,
    );
    setBefore(requestedBefore ?? older ?? null);
    setAfter(requestedAfter ?? newer ?? null);
  }, [catalog]);

  const parentAreas = useMemo(
    () => areas.filter((area) => area.properties.zone === null),
    [areas],
  );
  const allProjects = useMemo(() => {
    const unique = new Map<string, ProjectFeature>();
    Object.values(dataByArea).forEach(({ projects }) => {
      projects.features.forEach((feature) =>
        unique.set(feature.properties.component_id, feature),
      );
    });
    return [...unique.values()];
  }, [dataByArea]);
  const selectedArea = useMemo(
    () =>
      areas.find((area) => area.properties.area_id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );
  const selectedProject = useMemo(
    () =>
      allProjects.find(
        (feature) => feature.properties.component_id === selectedProjectId,
      ) ?? null,
    [allProjects, selectedProjectId],
  );
  const selectedProjectCategory = selectedProject
    ? CATEGORIES.find(
        (item) => item.key === selectedProject.properties.category,
      )
    : undefined;
  const selectedAreaData = selectedAreaId
    ? dataByArea[selectedAreaId]
    : undefined;
  const visibleProjects = useMemo(
    () =>
      category === "all"
        ? allProjects
        : allProjects.filter(
            (feature) => feature.properties.category === category,
          ),
    [allProjects, category],
  );

  const selectArea = useCallback((area: AreaFeature) => {
    setSelectedAreaId(area.properties.area_id);
    setSelectedProjectId(null);
    setMode("satellite");
    setSelection({
      kind: "area",
      id: area.properties.area_id,
      coordinates: centerOf(area),
    });
    setCompare(true);
    setSearchOpen(false);
  }, []);
  const selectProject = useCallback(
    (
      project: ProjectFeature,
      preserveSharedDates = false,
      preserveMapView = false,
    ) => {
      if (!preserveSharedDates) {
        initialBefore.current = null;
        initialAfter.current = null;
      }
      const owner = Object.keys(dataByArea).find((areaId) =>
        dataByArea[areaId].projects.features.some(
          (feature) =>
            feature.properties.component_id === project.properties.component_id,
        ),
      );
      setCategory("all");
      setMode("satellite");
      if (owner) setSelectedAreaId(owner);
      const [longitude, latitude] = project.geometry.coordinates;
      setSelectedProjectId(project.properties.component_id);
      setSelection({
        kind: "project",
        id: project.properties.component_id,
        name: project.properties.type_of_work || "Flood control project",
        coordinates: [longitude, latitude],
        preserveView: preserveMapView,
      });
      setCompare(true);
      setSearchOpen(false);
    },
    [dataByArea],
  );
  useEffect(() => {
    if (!selectedProjectId) {
      comparisonProjectId.current = null;
      return;
    }
    if (
      !selectedProject ||
      !catalog?.releases.length ||
      comparisonProjectId.current === selectedProjectId
    )
      return;

    comparisonProjectId.current = selectedProjectId;
    const window = releasesAroundProject(
      catalog.releases,
      selectedProject.properties.year,
      selectedProject.properties.start_date,
      selectedProject.properties.completion_date,
    );
    if (!initialBefore.current) setBefore(window.before);
    if (!initialAfter.current) setAfter(window.after);
  }, [catalog, selectedProject, selectedProjectId]);
  const selectMapLocation = useCallback((coordinates: [number, number]) => {
    setSelectedAreaId(null);
    setSelectedProjectId(null);
    setMode("satellite");
    setSelection({
      kind: "location",
      id: "map",
      name: "Selected map location",
      coordinates,
    });
    setCompare(true);
    setSearchOpen(false);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedAreaId(null);
    setSelectedProjectId(null);
    setSelection(null);
    setCompare(false);
  }, []);
  const updateMapStatus = useCallback(
    (status: MapStatus) => setMapStatus(status),
    [],
  );

  useEffect(() => {
    if (!restored.current) {
      if (initialArea.current) {
        const area = areas.find(
          (item) => item.properties.area_id === initialArea.current,
        );
        if (area) {
          setSelectedAreaId(area.properties.area_id);
          setSelection({
            kind: "area",
            id: area.properties.area_id,
            coordinates: centerOf(area),
          });
          setCompare(true);
        }
      }
      if (initialProject.current) {
        const project = allProjects.find(
          (item) => item.properties.component_id === initialProject.current,
        );
        if (project) selectProject(project, true);
      }
      if (loading) return;
      restored.current = true;
      return;
    }
    const params = new URLSearchParams();
    if (selectedAreaId) params.set("area", selectedAreaId);
    if (selectedProjectId) params.set("project", selectedProjectId);
    if (compare && before) params.set("before", before.id);
    if (compare && after) params.set("after", after.id);
    if (compare) params.set("split", String(position));
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, [
    areas,
    allProjects,
    loading,
    selectedAreaId,
    selectedProjectId,
    compare,
    before,
    after,
    position,
    selectProject,
  ]);

  const term = query.trim().toLocaleLowerCase();
  const areaResults = useMemo(
    () =>
      parentAreas
        .filter(
          (area) =>
            !term ||
            `${area.properties.name} ${STUDY_TYPE_LABEL[area.properties.study_type]}`
              .toLocaleLowerCase()
              .includes(term),
        )
        .slice(0, 5),
    [parentAreas, term],
  );
  const projectResults = useMemo(
    () =>
      term.length < 2
        ? []
        : allProjects
            .filter((feature) =>
              `${feature.properties.component_id} ${feature.properties.type_of_work ?? ""} ${feature.properties.municipality ?? ""} ${feature.properties.category} ${feature.properties.year}`
                .toLocaleLowerCase()
                .includes(term),
            )
            .slice(0, 7),
    [allProjects, term],
  );
  const beforeOptions =
    before && releases.every((item) => item.id !== before.id)
      ? [...releases, before].sort((a, b) => a.date.localeCompare(b.date))
      : releases;
  const afterOptions =
    after && releases.every((item) => item.id !== after.id)
      ? [...releases, after].sort((a, b) => a.date.localeCompare(b.date))
      : releases;

  return (
    <main className="map-app">
      <header className="map-header">
        <a className="brand" href="/" aria-label="TANAW map">
          <img src="/assets/Tanaw.png" width="36" height="36" alt="" />
          <span>TANAW</span>
        </a>
        <div className="map-search">
          <label className="search-box">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              placeholder="Find a place or project"
              aria-label="Find a study area or project"
              aria-expanded={searchOpen}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(true);
                  searchRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </label>
          {searchOpen && (
            <div className="search-results">
              {areaResults.length > 0 && (
                <div className="result-group">
                  <small>PLACES</small>
                  {areaResults.map((area) => (
                    <button
                      type="button"
                      key={area.properties.area_id}
                      onClick={() => {
                        selectArea(area);
                        setQuery(area.properties.name);
                      }}
                    >
                      <span className="result-marker area-marker" />
                      {area.properties.name}
                      <span className="result-type">
                        {STUDY_TYPE_LABEL[area.properties.study_type]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {projectResults.length > 0 && (
                <div className="result-group">
                  <small>PROJECTS</small>
                  {projectResults.map((feature) => (
                    <button
                      type="button"
                      key={feature.properties.component_id}
                      onClick={() => {
                        selectProject(feature);
                        setQuery(
                          feature.properties.type_of_work ||
                            feature.properties.component_id,
                        );
                      }}
                    >
                      <span
                        className="result-marker"
                        style={{
                          backgroundColor: CATEGORIES.find(
                            (item) => item.key === feature.properties.category,
                          )?.color,
                        }}
                      />
                      <span className="result-project-title">
                        {feature.properties.type_of_work ||
                          "Flood control project"}
                      </span>
                      <span className="result-type">
                        {feature.properties.municipality ||
                          feature.properties.component_id}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {term.length >= 2 &&
                !areaResults.length &&
                !projectResults.length && (
                  <p className="result-empty">
                    No matching places or projects.
                  </p>
                )}
              {!loading && !term && (
                <p className="result-empty">
                  Search an area, town or project type.
                </p>
              )}
            </div>
          )}
        </div>
        <nav className="header-actions" aria-label="Map display">
          <div className="basemap-switch" role="group" aria-label="Map style">
            <button
              type="button"
              aria-pressed={mode === "satellite"}
              onClick={() => setMode("satellite")}
            >
              Satellite
            </button>
            <button
              type="button"
              aria-pressed={mode === "streets"}
              onClick={() => {
                setMode("streets");
                setCompare(false);
              }}
            >
              Map
            </button>
          </div>
          <button
            className="about-button"
            type="button"
            onClick={() => setAboutOpen(true)}
          >
            About
          </button>
        </nav>
      </header>
      {searchOpen && (
        <button
          className="dismiss-search"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setSearchOpen(false)}
        />
      )}
      <section className="map-stage" aria-label="Project location map">
        <AreaMap
          areas={areas}
          projects={visibleProjects}
          selectedAreaId={selectedAreaId}
          selectedProjectId={selectedProjectId}
          selection={selection}
          category={category}
          mode={mode}
          compare={compare && mode === "satellite"}
          before={before}
          after={after}
          position={position}
          onSelectArea={selectArea}
          onSelectProject={(project, fromMarker) =>
            selectProject(project, false, Boolean(fromMarker))
          }
          onSelectLocation={selectMapLocation}
          onStatus={updateMapStatus}
        />
        {compare && mode === "satellite" && before && after && before.id !== after.id && (
          <ComparisonDivider
            position={position}
            setPosition={setPosition}
            before={before}
            after={after}
          />
        )}
        {dataError && (
          <div className="api-banner" role="status">
            <span>{dataError}</span>
            <button type="button" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        )}
        {!loading &&
          areas.length > 0 &&
          allProjects.length === 0 &&
          !dataError && (
            <div className="api-banner quiet">
              No project points are available for these areas.
            </div>
          )}
        <div
          className={`map-indicator ${mapStatus === "error" || dataError ? "has-error" : ""}`}
          role="status"
        >
          {dataError
            ? "Project data incomplete"
            : loading || mapStatus === "loading"
            ? "Loading map"
            : mapStatus === "error"
              ? "Map tiles unavailable"
              : `${allProjects.length.toLocaleString("en-PH")} project sites`}
        </div>
        <div className="category-control" aria-label="Filter project type">
          <button
            type="button"
            className={category === "all" ? "active" : ""}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All projects
          </button>
          {CATEGORIES.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={category === item.key}
              className={category === item.key ? "active" : ""}
              onClick={() =>
                setCategory(category === item.key ? "all" : item.key)
              }
            >
              <i style={{ backgroundColor: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
        {selection && (
          <aside
            className={`selection-card ${compare && mode === "satellite" ? "is-comparing" : ""}`}
            aria-label={
              selectedProject
                ? "Project details"
                : selectedArea
                  ? "Place details"
                  : "Selected map location"
            }
          >
            <button
              className="selection-close"
              type="button"
              aria-label="Clear selection"
              onClick={clearSelection}
            >
              ×
            </button>
            {selectedProject ? (
              <>
                <span className="card-kicker">DPWH PROJECT SITE</span>
                <h1>
                  {selectedProject.properties.type_of_work ||
                    CATEGORIES.find(
                      (item) =>
                        item.key === selectedProject.properties.category,
                    )?.label ||
                    "Flood control project"}
                </h1>
                <div className="project-facts">
                  {selectedProjectCategory && (
                    <span className="project-category">
                      <i
                        style={{ backgroundColor: selectedProjectCategory.color }}
                      />
                      {selectedProjectCategory.label}
                    </span>
                  )}
                  <span className="project-status">
                    {selectedProject.properties.completion_date
                      ? "Reported complete"
                      : "No completion date on record"}
                  </span>
                  <span>
                    {[
                      selectedProject.properties.municipality,
                      selectedProject.properties.province,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Location not reported"}
                  </span>
                  <span className="project-amount">
                    <small>Contract cost</small>
                    <strong>
                      {formatPhp(selectedProject.properties.amount_php)}
                    </strong>
                  </span>
                </div>
                <button
                  className="project-compare-button"
                  type="button"
                  aria-pressed={compare && mode === "satellite"}
                  onClick={() => {
                    const showing = compare && mode === "satellite";
                    setMode("satellite");
                    setCompare(!showing);
                  }}
                >
                  {compare && mode === "satellite"
                    ? "Hide site imagery"
                    : "Compare this site"}
                </button>
                <details className="card-details">
                  <summary>Project details</summary>
                  <dl className="project-detail-grid">
                    <div>
                      <dt>Funding year</dt>
                      <dd>{selectedProject.properties.year}</dd>
                    </div>
                    <div>
                      <dt>Completion</dt>
                      <dd>
                        {selectedProject.properties.completion_date
                          ? "Date recorded"
                          : "No date recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt>Approved budget</dt>
                      <dd>
                        {formatPhp(selectedProject.properties.abc_php)}
                      </dd>
                    </div>
                    <div>
                      <dt>Contractor</dt>
                      <dd>
                        {selectedProject.properties.contractor ?? "Not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>
                        {formatProjectDate(selectedProject.properties.start_date)}
                      </dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        {formatProjectDate(
                          selectedProject.properties.completion_date,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Project ID</dt>
                      <dd>
                        {selectedProject.properties.project_id ??
                          selectedProject.properties.component_id}
                      </dd>
                    </div>
                    <div>
                      <dt>Site coordinates</dt>
                      <dd>
                        {selectedProject.geometry.coordinates[1].toFixed(5)}, {" "}
                        {selectedProject.geometry.coordinates[0].toFixed(5)}
                      </dd>
                    </div>
                  </dl>
                  <p>
                    Source: {formatProjectSource(
                      selectedProject.properties.source,
                    )}.{" "}
                    The pin marks the work site, not the area it protects.
                  </p>
                </details>
                <details className="card-details">
                  <summary>About the imagery</summary>
                  <p>
                    Compare dates around the project period for visual context.
                    Small works may be hard to see from above, and imagery alone
                    cannot show whether a project achieved its purpose.
                  </p>
                </details>
              </>
            ) : selectedArea ? (
              <>
                <span className="card-kicker">
                  {STUDY_TYPE_LABEL[selectedArea.properties.study_type]}
                </span>
                <h1>{selectedArea.properties.name}</h1>
                <div className="project-facts">
                  <span>
                    {selectedArea.properties.area_ha?.toLocaleString("en-PH", {
                      maximumFractionDigits: 0,
                    }) ?? "Area not reported"}
                    {selectedArea.properties.area_ha === null ? "" : " ha"}
                  </span>
                  <span>
                    {selectedAreaData?.metrics.length
                      ? `${selectedAreaData.metrics.filter((row) => row.value !== null).length} yearly readings`
                      : "Tree cover history"}
                  </span>
                </div>
                <details className="card-details">
                  <summary>Area detail</summary>
                  <p>
                    Land figures come from annual Hansen tree cover loss. Each
                    year includes its data quality flag.
                  </p>
                </details>
              </>
            ) : (
              <>
                <span className="card-kicker">MAP LOCATION</span>
                <h1>Compare this place</h1>
                <p className="coordinates">
                  {selection.coordinates[1].toFixed(4)}° N,{" "}
                  {selection.coordinates[0].toFixed(4)}° E
                </p>
              </>
            )}
          </aside>
        )}
        <div className={`comparison-dock ${compare ? "is-comparing" : ""}`}>
          {compare && mode === "satellite" && (
            <div className="imagery-selectors">
              <label>
                <span>BEFORE</span>
                <select
                  aria-label="Older imagery date"
                  value={before?.id ?? ""}
                  disabled={!beforeOptions.length}
                  onChange={(event) =>
                    setBefore(
                      catalog?.releases.find(
                        (release) => release.id === event.target.value,
                      ) ?? null,
                    )
                  }
                >
                  {beforeOptions.map((release) => (
                    <option value={release.id} key={release.id}>
                      {formatImageryDate(release.date)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="swap-versions"
                aria-label="Swap before and after dates"
                onClick={() => {
                  setBefore(after);
                  setAfter(before);
                }}
              >
                ⇄
              </button>
              <label>
                <span>AFTER</span>
                <select
                  aria-label="Newer imagery date"
                  value={after?.id ?? ""}
                  disabled={!afterOptions.length}
                  onChange={(event) =>
                    setAfter(
                      catalog?.releases.find(
                        (release) => release.id === event.target.value,
                      ) ?? null,
                    )
                  }
                >
                  {afterOptions.map((release) => (
                    <option value={release.id} key={release.id}>
                      {formatImageryDate(release.date)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {compare && before && after && before.id === after.id && (
            <p className="same-date-warning">
              Choose two different dates to compare.
            </p>
          )}
          <div className="comparison-actions">
            <button
              type="button"
              className={`compare-toggle ${compare ? "active" : ""}`}
              onClick={() => {
                setMode("satellite");
                setCompare(!compare);
                if (!selection) {
                  const area = selectedArea ?? parentAreas[0];
                  if (area) selectArea(area);
                }
              }}
            >
              {compare ? "Exit comparison" : "Compare dates"}
            </button>
            <button
              type="button"
              className="archive-info"
              aria-label="About imagery dates"
              onClick={() => setAboutOpen(true)}
            >
              i
            </button>
          </div>
          {compare && mode === "satellite" && (
            <details className="imagery-note">
              <summary>About imagery dates</summary>
              <p>
                Dates show when imagery was published in the Esri Wayback
                archive, not necessarily when it was captured. Imagery is visual
                context; small works may not be visible.
              </p>
            </details>
          )}
        </div>
      </section>
      {aboutOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAboutOpen(false);
          }}
        >
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <button
              className="selection-close"
              aria-label="Close"
              onClick={() => setAboutOpen(false)}
            >
              ×
            </button>
            <span className="card-kicker">ABOUT TANAW</span>
            <h2 id="about-title">Projects on the map</h2>
            <p>
              Explore recorded flood control project sites and compare
              historical satellite imagery for a place.
            </p>
            <p>
              Archive dates mark Esri map releases. They may differ from the
              dates images were captured.
            </p>
            <button className="dialog-done" onClick={() => setAboutOpen(false)}>
              Back to map
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.7" cy="10.7" r="6.7" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function formatProjectDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatProjectSource(source: string) {
  const labels: Record<string, string> = {
    dpwh_flood_control: "DPWH flood control records",
    dpwh_transparency: "DPWH transparency records",
  };
  return labels[source] ?? source.replaceAll("_", " ");
}

function ComparisonDivider({
  position,
  setPosition,
  before,
  after,
}: {
  position: number;
  setPosition: (position: number) => void;
  before: ImageryRelease;
  after: ImageryRelease;
}) {
  return (
    <div
      className="comparison-divider"
      style={{ left: `${position}%` }}
    >
      <div className="comparison-divider-line" />
      <button
        type="button"
        className="comparison-divider-handle"
        role="slider"
        aria-label="Compare older imagery on the left with newer imagery on the right"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatImageryDate(before.date)} left, ${formatImageryDate(after.date)} right`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = event.currentTarget
            .closest(".map-stage")
            ?.getBoundingClientRect();
          if (!bounds || bounds.width === 0) return;
          setPosition(
            Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setPosition(Math.max(0, position - 3));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setPosition(Math.min(100, position + 3));
          } else if (event.key === "Home") {
            event.preventDefault();
            setPosition(0);
          } else if (event.key === "End") {
            event.preventDefault();
            setPosition(100);
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M6 4.5 2 9l4 4.5M12 4.5 16 9 12 13.5M2.5 9h13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
