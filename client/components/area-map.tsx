"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { GeoJSON, MapContainer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Feature, Geometry } from "geojson";
import type { AreaFeature, ProjectFeature } from "@/lib/api";
import { CATEGORIES } from "@/lib/api";
import type { ImageryRelease } from "@/lib/imagery";

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const STREETS =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const ESRI =
  'Imagery © <a href="https://www.esri.com/">Esri</a>, Vantor, Earthstar Geographics, GIS User Community';
export type MapMode = "satellite" | "streets";
export type MapStatus = "loading" | "ready" | "error";
export type MapSelection =
  | { kind: "area"; id: string; coordinates: [number, number] }
  | {
      kind: "project";
      id: string;
      name: string;
      coordinates: [number, number];
      preserveView?: boolean;
    }
  | {
      kind: "location";
      id: string;
      name: string;
      coordinates: [number, number];
    };

type Props = {
  areas: AreaFeature[];
  projects: ProjectFeature[];
  selectedAreaId: string | null;
  selectedProjectId: string | null;
  selection: MapSelection | null;
  category: string;
  mode: MapMode;
  compare: boolean;
  before: ImageryRelease | null;
  after: ImageryRelease | null;
  position: number;
  onSelectArea: (area: AreaFeature) => void;
  onSelectProject: (project: ProjectFeature, fromMarker?: boolean) => void;
  onSelectLocation: (coordinates: [number, number]) => void;
  onStatus: (status: MapStatus) => void;
};

function ImageryLayers({
  mode,
  compare,
  before,
  after,
  position,
  onStatus,
}: Props) {
  const map = useMap();
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;
  const divider = useRef(position);
  divider.current = position;

  useEffect(() => {
    const pane = map.getPane("comparison") ?? map.createPane("comparison");
    pane.style.zIndex = "250";
    pane.style.pointerEvents = "none";
    let disposed = false;
    let failed = false;
    const layers: L.TileLayer[] = [];
    const loaded = new Set<L.TileLayer>();
    statusCallback.current("loading");

    function tileLayer(
      url: string,
      attribution: string,
      paneName = "tilePane",
      allowWaybackZoomFallback = false,
    ) {
      const layer = L.tileLayer(url, {
        pane: paneName,
        maxZoom: 19,
        ...(allowWaybackZoomFallback ? { maxNativeZoom: 19 } : {}),
        attribution,
        keepBuffer: 2,
      });
      layers.push(layer);
      layer.on("loading", () => {
        loaded.delete(layer);
        if (!disposed && !failed) statusCallback.current("loading");
      });
      layer.on("tileerror", (event: L.TileErrorEvent) => {
        if (allowWaybackZoomFallback) {
          const urlZoom = Number(
            /\/tile\/\d+\/(\d+)\//.exec(event.tile.src)?.[1],
          );
          const requestedZoom = Number.isFinite(urlZoom)
            ? urlZoom
            : event.coords.z;
          const maxNativeZoom = layer.options.maxNativeZoom ?? 19;

          // Some Wayback releases omit the sharpest tiles in a location. Use
          // the available z17 tile there instead of leaving half the map blank.
          if (requestedZoom > maxNativeZoom) return;
          if (requestedZoom > 17 && maxNativeZoom > 17) {
            layer.options.maxNativeZoom = 17;
            loaded.delete(layer);
            if (!disposed) {
              statusCallback.current("loading");
              requestAnimationFrame(() => {
                if (!disposed) layer.redraw();
              });
            }
            return;
          }
        }
        failed = true;
        if (!disposed) statusCallback.current("error");
      });
      layer.on("load", () => {
        loaded.add(layer);
        if (!disposed && !failed && loaded.size === layers.length) {
          statusCallback.current("ready");
        }
      });
      return layer;
    }

    if (compare && before && after) {
      tileLayer(before.tileUrl, ESRI, "tilePane", true);
      tileLayer(after.tileUrl, ESRI, "comparison", true);
    } else {
      const streets = mode === "streets";
      tileLayer(
        streets ? STREETS : SATELLITE,
        streets
          ? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://carto.com/attributions">CARTO</a>'
          : ESRI,
      );
    }
    layers.forEach((layer) => layer.addTo(map));
    const timeout = setTimeout(() => {
      if (!disposed && loaded.size !== layers.length)
        statusCallback.current("error");
    }, 20000);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      layers.forEach((layer) => layer.remove());
    };
  }, [map, mode, compare, before, after]);

  useEffect(() => {
    const clip = () => {
      const pane = map.getPane("comparison");
      if (!pane) return;
      if (!compare) {
        pane.style.clip = "";
        return;
      }
      const size = map.getSize();
      const northwest = map.containerPointToLayerPoint([0, 0]);
      const southeast = map.containerPointToLayerPoint([size.x, size.y]);
      const x = map.containerPointToLayerPoint([
        (size.x * divider.current) / 100,
        0,
      ]).x;
      pane.style.clip = `rect(${northwest.y}px, ${southeast.x}px, ${southeast.y}px, ${x}px)`;
    };
    const frame = requestAnimationFrame(clip);
    map.on("move zoom zoomanim resize", clip);
    return () => {
      cancelAnimationFrame(frame);
      map.off("move zoom zoomanim resize", clip);
    };
  }, [map, compare, position, before, after]);
  return null;
}

function MapEvents({ onSelectLocation }: Pick<Props, "onSelectLocation">) {
  const onSelect = useRef(onSelectLocation);
  onSelect.current = onSelectLocation;
  const map = useMapEvents({
    click: (event) =>
      onSelect.current([
        Number(event.latlng.lng.toFixed(6)),
        Number(event.latlng.lat.toFixed(6)),
      ]),
  });
  useEffect(() => {
    map.attributionControl.setPrefix(false);
    const zoom = L.control.zoom({ position: "bottomright" }).addTo(map);
    const scale = L.control
      .scale({ position: "bottomright", imperial: false })
      .addTo(map);
    const resize = new ResizeObserver(() =>
      map.invalidateSize({ animate: false }),
    );
    resize.observe(map.getContainer());
    return () => {
      zoom.remove();
      scale.remove();
      resize.disconnect();
    };
  }, [map]);
  return null;
}

function MapFocus({ areas, selection }: Pick<Props, "areas" | "selection">) {
  const map = useMap();
  const overviewFitted = useRef(false);
  useEffect(() => {
    if (!areas.length || overviewFitted.current) return;
    const bounds = L.latLngBounds([]);
    areas.forEach((area) => {
      const geometry = L.geoJSON(area as Feature<Geometry>).getBounds();
      if (geometry.isValid()) bounds.extend(geometry);
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 7, animate: false });
    }
    overviewFitted.current = true;
  }, [areas, map]);
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === "project" && selection.preserveView) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 0.65;
    if (selection.kind === "area") {
      const area = areas.find(
        (item) => item.properties.area_id === selection.id,
      );
      if (area) {
        const bounds = L.geoJSON(area as Feature<Geometry>).getBounds();
        if (bounds.isValid()) {
          map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 12, duration });
        }
      }
    } else {
      const zoom =
        selection.kind === "project" ? Math.max(map.getZoom(), 15) : map.getZoom();
      map.flyTo([selection.coordinates[1], selection.coordinates[0]], zoom, {
        duration,
      });
    }
  }, [selection, areas, map]);
  return null;
}

function ProjectLayer({
  projects,
  category,
  selectedProjectId,
  onSelectProject,
}: Pick<
  Props,
  "projects" | "category" | "selectedProjectId" | "onSelectProject"
>) {
  const map = useMap();
  const select = useRef(onSelectProject);
  select.current = onSelectProject;
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const points =
      category === "all"
        ? projects
        : projects.filter(
            (project) => project.properties.category === category,
          );
    for (const project of points) {
      const color =
        CATEGORIES.find((item) => item.key === project.properties.category)
          ?.color ?? "#2878b5";
      const selected = project.properties.component_id === selectedProjectId;
      const point: L.LatLngExpression = [
        project.geometry.coordinates[1],
        project.geometry.coordinates[0],
      ];
      const markerOptions: L.CircleMarkerOptions = {
        color: "#17332b",
        weight: selected ? 2.5 : 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
        bubblingMouseEvents: false,
      };
      const halo = L.circleMarker(point, {
        ...markerOptions,
        radius: selected ? 11 : 8.5,
      });
      const marker = L.circleMarker(point, {
        radius: selected ? 6 : 4.5,
        color: "#ffffff",
        weight: selected ? 2.5 : 2,
        fillColor: color,
        fillOpacity: 1,
        bubblingMouseEvents: false,
      });
      halo.on("click", () => select.current(project, true)).addTo(group);
      marker.on("click", () => select.current(project, true)).addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [map, projects, category, selectedProjectId]);
  return null;
}

function areaStyle(feature?: Feature<Geometry>) {
  const selected = Boolean(feature?.properties?.selected);
  return {
    color: selected ? "#087443" : "#ffffff",
    weight: selected ? 2.5 : 1.5,
    opacity: 0.94,
    fillColor: "#087443",
    fillOpacity: selected ? 0.11 : 0.035,
  };
}

function zoneStyle(feature?: Feature<Geometry>): L.PathOptions {
  return {
    color: feature?.properties?.zone === "up" ? "#b8742f" : "#0f9e90",
    weight: 2,
    opacity: 0.95,
    dashArray: "6 5",
    fill: false,
  };
}

export function AreaMap(props: Props) {
  const {
    areas,
    projects,
    selectedAreaId,
    selection,
    category,
    mode,
    compare,
    before,
    after,
    position,
    onSelectArea,
    onSelectProject,
    onSelectLocation,
    onStatus,
  } = props;
  const areaCallback = useRef(onSelectArea);
  areaCallback.current = onSelectArea;
  const parentAreas = useMemo(
    () =>
      areas
        .filter((area) => area.properties.zone === null)
        // Draw larger boundaries first so a smaller overlapping area receives the click.
        .sort(
          (a, b) =>
            (b.properties.area_ha ?? Number.POSITIVE_INFINITY) -
            (a.properties.area_ha ?? Number.POSITIVE_INFINITY),
        ),
    [areas],
  );
  const shownAreas = useMemo(
    () =>
      parentAreas.map((area) => ({
        ...area,
        properties: {
          ...area.properties,
          selected: area.properties.area_id === selectedAreaId,
        },
      })),
    [parentAreas, selectedAreaId],
  );
  const shownZones = useMemo(
    () =>
      selectedAreaId
        ? areas.filter(
            (area) =>
              area.properties.zone !== null &&
              area.properties.area_id.startsWith(`${selectedAreaId}__`),
          )
        : [],
    [areas, selectedAreaId],
  );
  const onEachArea = useCallback(
    (feature: Feature<Geometry>, layer: L.Layer) => {
      layer.on("click", (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event.originalEvent);
        const area = areas.find(
          (item) => item.properties.area_id === feature.properties?.area_id,
        );
        if (area) areaCallback.current(area);
      });
    },
    [areas],
  );

  return (
    <MapContainer
      className="map-canvas"
      center={[12.8797, 121.774]}
      zoom={6}
      minZoom={5}
      maxZoom={19}
      zoomControl={false}
      attributionControl
      preferCanvas
    >
      <ImageryLayers {...props} />
      <MapEvents onSelectLocation={onSelectLocation} />
      <MapFocus areas={parentAreas} selection={selection} />
      {shownAreas.map((area) => (
        <GeoJSON
          key={area.properties.area_id}
          data={area as Feature<Geometry>}
          style={areaStyle}
          onEachFeature={onEachArea}
        />
      ))}
      {shownZones.map((area) => (
        <GeoJSON
          key={area.properties.area_id}
          data={area as Feature<Geometry>}
          style={zoneStyle}
          interactive={false}
        />
      ))}
      <ProjectLayer
        projects={projects}
        category={category}
        selectedProjectId={props.selectedProjectId}
        onSelectProject={onSelectProject}
      />
    </MapContainer>
  );
}
