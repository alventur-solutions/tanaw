import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App'
import LiveSensors from './LiveSensors'
import { mark } from './perf'

// Bundle the worker and its imports so both map views can load it from CloudFront.
setWorkerUrl(workerUrl)

mark('start')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.replace(/\/$/, '') === '/live-sensors' ? <LiveSensors /> : <App />}
  </StrictMode>,
)
