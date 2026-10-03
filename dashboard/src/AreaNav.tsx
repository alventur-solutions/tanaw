import { useEffect, useMemo, useRef, useState } from 'react'
import { STUDY_TYPE_GROUP, STUDY_TYPE_ORDER, formatHa, regionOf, shortName } from './api'
import type { AreaFeature } from './api'

interface Props {
  // Top-level areas only.
  areas: AreaFeature[]
  selectedId: string | null
  onSelect: (areaId: string | null) => void
  // Called when an item is hovered or focused, so its data can load before the click.
  onPreview?: (areaId: string) => void
}

// One compact menu for any number of areas: grouped by study type, filtered as you type.
export default function AreaNav({ areas, selectedId, onSelect, onPreview }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const selected = areas.find((a) => a.properties.area_id === selectedId) ?? null

  const groups = useMemo(() => {
    const text = query.trim().toLowerCase()
    return STUDY_TYPE_ORDER.map((type) => ({
      type,
      items: areas
        .filter((a) => a.properties.study_type === type)
        .filter((a) => {
          const region = regionOf(a.properties.area_id) ?? ''
          return !text || `${shortName(a)} ${region}`.toLowerCase().includes(text)
        })
        .sort((a, b) => shortName(a).localeCompare(shortName(b))),
    })).filter((group) => group.items.length > 0)
  }, [areas, query])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const pick = (areaId: string | null) => {
    setOpen(false)
    setQuery('')
    onSelect(areaId)
  }

  return (
    <nav className="area-nav" aria-label="Study areas" ref={box}>
      <button className={selectedId === null ? 'active' : ''} onClick={() => pick(null)}>
        All areas
      </button>
      <div className="area-menu">
        <button
          className={`area-menu-trigger${selected ? ' active' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          disabled={areas.length === 0}
        >
          <span>{selected ? shortName(selected) : `Choose an area (${areas.length})`}</span>
        </button>
        {open && (
          <div
            className="area-menu-panel"
            onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          >
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Filter by name or island group"
              aria-label="Filter study areas"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="area-menu-list" role="listbox" aria-label="Study areas">
              {groups.map((group) => (
                <section key={group.type}>
                  <h4>{STUDY_TYPE_GROUP[group.type]}</h4>
                  {group.items.map((area) => (
                    <button
                      key={area.properties.area_id}
                      role="option"
                      aria-selected={area.properties.area_id === selectedId}
                      className={area.properties.area_id === selectedId ? 'active' : ''}
                      onClick={() => pick(area.properties.area_id)}
                      onMouseEnter={() => onPreview?.(area.properties.area_id)}
                      onFocus={() => onPreview?.(area.properties.area_id)}
                    >
                      <strong>{shortName(area)}</strong>
                      <span>
                        {regionOf(area.properties.area_id) ?? ''}
                        {regionOf(area.properties.area_id) ? ', ' : ''}
                        {formatHa(area.properties.area_ha)}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
              {groups.length === 0 && <p className="empty">No study area matches that name.</p>}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
