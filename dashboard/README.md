# TANAW dashboard

React, Vite, and MapLibre. Reads the TANAW API through the `/api` proxy in `vite.config.ts`.

1. Start the API from the repo root: `uvicorn api.main:app --reload`
2. Start the dashboard: `npm install` then `npm run dev` in `dashboard/`
3. Open http://localhost:5173

Every number on the page comes from the API. Nothing is mocked.

## Credits

The dark console look and the before and after imagery viewer follow the open source
ghostwatch project by Xavier M. Puspus (MIT). `public/data/wayback.json` is the Esri World
Imagery Wayback release list, thinned to about one release every 150 days. Imagery tiles load
straight from Esri (Esri, Maxar, Earthstar Geographics).
