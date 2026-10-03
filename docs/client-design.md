# Client direction

The main screen is a light, full-screen map. A planner can select a place or project site, inspect its recorded fields, and compare two dates in satellite imagery.

- White canvas and controls, dark green text, TANAW green (`#087443`) and blue (`#086aa5`).
- Archivo for headings, Hanken Grotesk for interface text, IBM Plex Mono for dates and small labels.
- Search stays in the top bar. Area boundaries and category-colored project pins sit on the map. Selecting a place or site opens a small detail card. A draggable divider and two archive dates stay near the bottom.
- Leaflet and React Leaflet follow the map approach in [Ghostwatch's map](https://github.com/xmpuspus/ghostwatch/blob/main/web/src/components/map/ProjectMap.tsx) and [imagery comparison](https://github.com/xmpuspus/ghostwatch/blob/main/web/src/components/satellite/WaybackComparison.tsx).
- Study areas, project points and tree-cover metrics come from the TANAW API. Esri Wayback supplies the historical imagery archive dates and tiles.

Keep the screen map-first with short labels. Show data source and interpretation details in the selected place or project card. State missing information plainly. Do not invent values, project locations, sensor readings, or image capture dates.
