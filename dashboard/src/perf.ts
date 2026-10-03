// Timing marks, read with ?perf=1 in the page address. Off by default.
// The table is printed to the console once the map is idle with areas and points drawn.
const ON = new URLSearchParams(location.search).get('perf') === '1'

const seen = new Set<string>()

export function mark(name: string): void {
  if (!ON || seen.has(name)) return
  seen.add(name)
  performance.mark(`tanaw:${name}`)
}

export function report(): void {
  if (!ON) return
  const rows = performance
    .getEntriesByType('mark')
    .filter((m) => m.name.startsWith('tanaw:'))
    .map((m) => ({ mark: m.name.slice(6), ms: Math.round(m.startTime) }))
  console.table(rows)
}
