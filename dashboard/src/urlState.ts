// The story's controls in the query string, so a shared link opens the same view. Keys are read
// once on load and written with replaceState, so a click never adds a history entry. The map
// camera stays in the hash (#zoom/lat/lon/bearing/pitch) and is kept on every write.

/** The query string as the page opened. Controls read their first value from here. */
const initial = new URLSearchParams(location.search)

/** A key from the link the page opened with, or null. */
export function readParam(key: string): string | null {
  return initial.get(key)
}

/** A key from the link, when it is one of the allowed values. Anything else falls back. */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = initial.get(key)
  return allowed.find((a) => a === value) ?? fallback
}

/**
 * Sets or drops keys in the current URL. A null value, or a value equal to its default, drops the
 * key, so a link carries only what differs from the default view.
 */
export function writeParams(updates: Record<string, string | null>): void {
  const params = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
    // A later read of the same key on this page load sees the new value.
    if (value === null || value === '') initial.delete(key)
    else initial.set(key, value)
  }
  const search = params.toString()
  const url = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
  if (url !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(history.state, '', url)
  }
}

/** Keys that belong to one area. Selecting another area drops them. */
export const AREA_KEYS = ['project', 'rainzone'] as const
