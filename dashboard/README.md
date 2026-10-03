# TANAW dashboard

React, Vite, and MapLibre. Reads the TANAW API through the `/api` proxy in `vite.config.ts`.

1. Start the API from the repo root: `uvicorn api.main:app --reload`
2. Start the dashboard: `npm install` then `npm run dev` in `dashboard/`
3. Open http://localhost:5173

Every number on the page comes from the API. Nothing is mocked.
