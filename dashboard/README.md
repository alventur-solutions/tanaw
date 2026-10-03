# TANAW dashboard

React, Vite, and MapLibre. In local development, Vite proxies `/api` to FastAPI on
port 8000. Production builds use `VITE_API_BASE_URL` to call the API Lambda Function URL.

1. Start the API from the repo root: `uvicorn api.main:app --reload`
2. Start the dashboard: `npm install` then `npm run dev` in `dashboard/`
3. Open http://localhost:5173

For a production build, set `VITE_API_BASE_URL` to the deployed API Function URL
before running `npm run build`. The value is compiled into the static JavaScript;
it is a public endpoint, not a secret.

Every number on the page comes from the API. Nothing is mocked.

## Credits

The before and after imagery viewer follows the open source ghostwatch project by
Xavier M. Puspus (MIT). The visual direction is white minimalism: white surfaces, hairline
rules, Inter Tight, one blue accent, and pill controls. The logo mark in
`public/assets/tanaw-mark.png` is the TANAW logo from `client/public/assets/`, cropped and
resized. `public/data/wayback.json` is the Esri World
Imagery Wayback release list, thinned to about one release every 150 days. Imagery tiles load
straight from Esri (Esri, Maxar, Earthstar Geographics).
