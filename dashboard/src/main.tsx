import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App'
import LiveSensors from './LiveSensors'
import { mark } from './perf'

mark('start')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.replace(/\/$/, '') === '/live-sensors' ? <LiveSensors /> : <App />}
  </StrictMode>,
)
