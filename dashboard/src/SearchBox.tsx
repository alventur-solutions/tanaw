import { useEffect, useRef, useState } from 'react'

// Place search on OpenStreetMap data through the public Photon geocoder (photon.komoot.io).
// Results are limited to the Philippines and ranked toward the study areas.

const PHOTON = 'https://photon.komoot.io/api/'
const PHILIPPINES = '116.9,4.5,126.7,21.2'

export interface Place {
  name: string
  detail: string
  center: [number, number]
  // [west, north, east, south], when the place has an extent.
  extent: [number, number, number, number] | null
}

interface PhotonFeature {
  properties: Record<string, string | number | number[] | undefined>
  geometry: { coordinates: [number, number] }
}

function toPlace(feature: PhotonFeature): Place {
  const p = feature.properties
  const parts = [p.street, p.district, p.city, p.county, p.state].filter(
    (part): part is string => typeof part === 'string',
  )
  const name = typeof p.name === 'string' ? p.name : (parts.shift() ?? 'Unnamed place')
  return {
    name,
    detail: [...new Set(parts)].filter((part) => part !== name).slice(0, 3).join(', '),
    center: feature.geometry.coordinates,
    extent: Array.isArray(p.extent) ? (p.extent as [number, number, number, number]) : null,
  }
}

export default function SearchBox({ onPick }: { onPick: (place: Place) => void }) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [active, setActive] = useState(0)
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setPlaces([])
      setState('idle')
      return
    }
    const abort = new AbortController()
    // Wait for a pause in typing before asking the geocoder.
    const timer = setTimeout(() => {
      setState('loading')
      const params = new URLSearchParams({
        q: text,
        limit: '6',
        lang: 'en',
        lat: '14.65',
        lon: '121.08',
        bbox: PHILIPPINES,
      })
      fetch(`${PHOTON}?${params}`, { signal: abort.signal })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json()
        })
        .then((body: { features: PhotonFeature[] }) => {
          const found = body.features.map(toPlace)
          setPlaces(found)
          setActive(0)
          setState(found.length ? 'idle' : 'empty')
          setOpen(true)
        })
        .catch((error: Error) => {
          if (error.name !== 'AbortError') setState('error')
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [query])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const pick = (place: Place) => {
    setQuery(place.name)
    setOpen(false)
    onPick(place)
  }

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(places.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter' && places[active]) {
      pick(places[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const message =
    state === 'loading' && places.length === 0
      ? 'Searching.'
      : state === 'empty'
        ? 'No place found in the Philippines. Try a barangay, street, or city name.'
        : state === 'error'
          ? 'Search is not answering. Check the connection and try again.'
          : null

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        value={query}
        placeholder="Search a place, street, or barangay"
        aria-label="Search a place"
        role="combobox"
        aria-expanded={open && places.length > 0}
        aria-controls="search-results"
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (places.length > 0 || message) && (
        <ul id="search-results" role="listbox">
          {places.map((place, index) => (
            <li key={`${place.name}-${place.center.join()}`} role="option" aria-selected={index === active}>
              <button onClick={() => pick(place)} onMouseEnter={() => setActive(index)}>
                <strong>{place.name}</strong>
                {place.detail && <span>{place.detail}</span>}
              </button>
            </li>
          ))}
          {message && <li className="search-message">{message}</li>}
          <li className="search-credit">Search by Photon on OpenStreetMap data</li>
        </ul>
      )}
    </div>
  )
}
