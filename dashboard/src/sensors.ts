// Live station data and the plain-language advice built from it, for the public /live-sensors page.

export type StationType = 'river' | 'street'
export type Level = 'ok' | 'watch' | 'warn' | 'danger'

export interface Reading {
  ts: string
  temp_c: number | null
  humidity_pct: number | null
  water_level_cm: number | null
  flood_depth_cm: number | null
  battery_v: number | null
}

export interface Station {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    station_id: string
    station_type: StationType
    area_id: string | null
    dry_baseline_cm: number | null
    latest: Reading | null
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchStations(): Promise<Station[]> {
  return (await get<{ features: Station[] }>('/stations')).features
}

export async function fetchReadings(stationId: string, hours = 24): Promise<Reading[]> {
  const body = await get<{ readings: Reading[] }>(
    `/stations/${encodeURIComponent(stationId)}/readings?hours=${hours}`,
  )
  return body.readings
}

// Shown only while no station has sent a reading. The page labels it as an example.
export const EXAMPLE_STATION: Station = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [121.09325, 14.636] },
  properties: {
    station_id: 'example',
    station_type: 'river',
    area_id: 'quezon-city',
    dry_baseline_cm: null,
    latest: {
      ts: new Date().toISOString(),
      temp_c: 23.1,
      humidity_pct: 58.4,
      water_level_cm: 0,
      flood_depth_cm: null,
      battery_v: null,
    },
  },
}

// Street alert levels from the station spec: 10 cm gutter, 30 cm not passable for cars,
// 50 cm dangerous for people.
export const STREET_LEVELS = [10, 30, 50]

// A reading older than this may no longer describe the street.
export const STALE_MINUTES = 15
export const OFFLINE_MINUTES = 120

export function minutesAgo(ts: string, now = Date.now()): number {
  return Math.max(0, (now - new Date(ts).getTime()) / 60000)
}

export function agoText(ts: string, now = Date.now()): string {
  const minutes = minutesAgo(ts, now)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.round(minutes)} min ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)} hr ago`
  return new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Heat index in °C (NOAA Rothfusz), the measure PAGASA uses for its heat warnings. */
export function heatIndex(tempC: number, humidity: number): number {
  const t = (tempC * 9) / 5 + 32
  const simple = 0.5 * (t + 61 + (t - 68) * 1.2 + humidity * 0.094)
  if ((simple + t) / 2 < 80) return tempC
  let hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * humidity -
    0.22475541 * t * humidity -
    0.00683783 * t * t -
    0.05481717 * humidity * humidity +
    0.00122874 * t * t * humidity +
    0.00085282 * t * humidity * humidity -
    0.00000199 * t * t * humidity * humidity
  if (humidity < 13 && t >= 80 && t <= 112) {
    hi -= ((13 - humidity) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17)
  } else if (humidity > 85 && t >= 80 && t <= 87) {
    hi += ((humidity - 85) / 10) * ((87 - t) / 5)
  }
  return ((hi - 32) * 5) / 9
}

export type IconName =
  | 'home'
  | 'phone'
  | 'car'
  | 'wade'
  | 'waves'
  | 'bag'
  | 'umbrella'
  | 'drop'
  | 'sun'
  | 'check'

export interface Action {
  icon: IconName
  text: string
  // The same advice in Filipino.
  fil: string
  level: Level
}

export interface Status {
  level: Level
  headline: string
  detail: string
}

export interface WaterStatus extends Status {
  value: number
  label: string
}

/** What the water reading means for someone on that street or near that river. */
export function waterStatus(station: Station, history: Reading[]): WaterStatus | null {
  const latest = station.properties.latest
  if (!latest) return null
  if (station.properties.station_type === 'street') {
    const depth = latest.flood_depth_cm
    if (depth === null) return null
    const value = Math.max(0, depth)
    const [gutter, cars, people] = STREET_LEVELS
    const base = { value, label: 'Flood depth on the street' }
    if (value >= people)
      return {
        ...base,
        level: 'danger',
        headline: 'Dangerous for people',
        detail: `Water is ${people} cm deep or more. Do not walk or drive through it.`,
      }
    if (value >= cars)
      return {
        ...base,
        level: 'warn',
        headline: 'Not passable for cars',
        detail: `Water is ${cars} cm deep or more. Small cars can stall here.`,
      }
    if (value >= gutter)
      return {
        ...base,
        level: 'watch',
        headline: 'Water at gutter level',
        detail: 'The street is wet and the gutter is full. Walk with care.',
      }
    return { ...base, level: 'ok', headline: 'Street is clear', detail: 'No flood water on the road.' }
  }
  const level = latest.water_level_cm
  if (level === null) return null
  const change = riseLastHour(history, 'water_level_cm')
  const base = { value: level, label: 'River water level' }
  // River stations have no alert levels set yet, so the advice follows how fast the river rises.
  if (change !== null && change >= 30)
    return {
      ...base,
      level: 'warn',
      headline: 'River rising fast',
      detail: `Up ${Math.round(change)} cm in the last hour. Stay away from the riverbank.`,
    }
  if (change !== null && change >= 10)
    return {
      ...base,
      level: 'watch',
      headline: 'River is rising',
      detail: `Up ${Math.round(change)} cm in the last hour. Keep watching for updates.`,
    }
  if (change !== null && change <= -10)
    return {
      ...base,
      level: 'ok',
      headline: 'River is going down',
      detail: `Down ${Math.round(-change)} cm in the last hour.`,
    }
  if (change === null)
    return {
      ...base,
      level: 'ok',
      headline: 'No trend yet',
      detail: 'There is less than an hour of readings, so TANAW cannot tell yet if the river is rising.',
    }
  return {
    ...base,
    level: 'ok',
    headline: 'River is steady',
    detail: 'No sharp rise in the water level.',
  }
}

/** Change over the last hour, or null when there is not an hour of readings. */
export function riseLastHour(
  history: Reading[],
  field: 'water_level_cm' | 'flood_depth_cm',
): number | null {
  const rows = history.filter((r) => r[field] !== null)
  if (rows.length < 2) return null
  const last = rows[rows.length - 1]
  const cutoff = new Date(last.ts).getTime() - 60 * 60000
  const before = [...rows].reverse().find((r) => new Date(r.ts).getTime() <= cutoff)
  if (!before) return null
  return (last[field] as number) - (before[field] as number)
}

export interface HeatStatus extends Status {
  value: number
}

// PAGASA heat index classes.
export function heatStatus(reading: Reading): HeatStatus | null {
  if (reading.temp_c === null || reading.humidity_pct === null) return null
  const value = heatIndex(reading.temp_c, reading.humidity_pct)
  if (value >= 42)
    return {
      value,
      level: 'danger',
      headline: value >= 52 ? 'Extreme danger from heat' : 'Danger from heat',
      detail: 'Heat cramps and heat exhaustion are likely. Heat stroke is possible.',
    }
  if (value >= 33)
    return {
      value,
      level: 'warn',
      headline: 'Extreme caution: very hot',
      detail: 'Heat cramps and heat exhaustion are possible with long time outdoors.',
    }
  if (value >= 27)
    return {
      value,
      level: 'watch',
      headline: 'Warm',
      detail: 'Long time in the sun can tire you out.',
    }
  return { value, level: 'ok', headline: 'Comfortable', detail: 'The air feels mild.' }
}

const RANK: Record<Level, number> = { ok: 0, watch: 1, warn: 2, danger: 3 }

export function worst(levels: Level[]): Level {
  return levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok')
}

export const OVERALL: Record<Level, { headline: string; fil: string }> = {
  ok: { headline: 'Safe to go out', fil: 'Ligtas lumabas' },
  watch: { headline: 'Go out with care', fil: 'Mag-ingat sa paglabas' },
  warn: { headline: 'Avoid this area if you can', fil: 'Iwasan muna ang lugar' },
  danger: { headline: 'Stay safe, stay away', fil: 'Delikado, lumayo muna' },
}

/** Things a person can do now, most urgent first. */
export function actions(
  station: Station,
  water: WaterStatus | null,
  heat: HeatStatus | null,
  month = new Date().getMonth(),
): Action[] {
  const list: Action[] = []
  const latest = station.properties.latest
  const street = station.properties.station_type === 'street'

  if (water?.level === 'danger') {
    list.push({
      icon: 'home',
      text: 'Stay indoors or move to higher ground.',
      fil: 'Manatili sa loob o lumikas sa mataas na lugar.',
      level: 'danger',
    })
    list.push({
      icon: 'phone',
      text: 'If you are trapped by water, call 911.',
      fil: 'Kung na-trap sa baha, tumawag sa 911.',
      level: 'danger',
    })
  }
  if (street && water && water.value >= STREET_LEVELS[1]) {
    list.push({
      icon: 'car',
      text: 'Cars cannot pass. Take another route.',
      fil: 'Hindi madaanan ng sasakyan. Humanap ng ibang daan.',
      level: 'warn',
    })
  }
  if (street && water && water.value >= STREET_LEVELS[0]) {
    list.push({
      icon: 'wade',
      text: 'Wear boots and avoid wading. Flood water can carry leptospirosis.',
      fil: 'Magsuot ng bota at iwasang lumusong sa baha. May panganib ng leptospirosis.',
      level: 'watch',
    })
  }
  if (!street && water && water.level !== 'ok') {
    list.push({
      icon: 'waves',
      text: 'Stay away from the riverbank and do not cross the river.',
      fil: 'Lumayo sa pampang at huwag tumawid sa ilog.',
      level: water.level,
    })
    list.push({
      icon: 'bag',
      text: 'Keep a go bag ready in case you need to leave.',
      fil: 'Ihanda ang go bag kung sakaling kailangang lumikas.',
      level: 'watch',
    })
  }

  const humid = (latest?.humidity_pct ?? 0) >= 85
  const rainySeason = month >= 5 && month <= 10
  if (humid || rainySeason) {
    list.push({
      icon: 'umbrella',
      text: humid
        ? 'The air is very humid and rain may come. Bring an umbrella.'
        : 'It is rainy season. Bring an umbrella just in case.',
      fil: 'Magdala ng payong.',
      level: humid ? 'watch' : 'ok',
    })
  }
  if (heat && heat.level !== 'ok') {
    if (!humid && !rainySeason) {
      list.push({
        icon: 'umbrella',
        text: 'Bring an umbrella or a hat for shade.',
        fil: 'Magdala ng payong o sumbrero bilang panangga sa araw.',
        level: heat.level,
      })
    }
    list.push({
      icon: 'drop',
      text: 'Drink water often, even if you are not thirsty.',
      fil: 'Uminom ng maraming tubig kahit hindi nauuhaw.',
      level: heat.level,
    })
    if (heat.level !== 'watch') {
      list.push({
        icon: 'sun',
        text: 'Avoid the sun from 10 AM to 4 PM. Check on children and older people.',
        fil: 'Iwasan ang araw mula 10 AM hanggang 4 PM. Bantayan ang mga bata at nakatatanda.',
        level: heat.level,
      })
    }
  }

  if (water?.level === 'ok' && (!heat || heat.level === 'ok')) {
    list.push({
      icon: 'check',
      text: street ? 'The street is passable. Have a safe trip.' : 'No action needed right now.',
      fil: street ? 'Madadaanan ang kalye. Ingat sa biyahe.' : 'Walang kailangang gawin sa ngayon.',
      level: 'ok',
    })
  }
  return list.sort((a, b) => RANK[b.level] - RANK[a.level])
}

/** 14.636 becomes 14° 38' 10" N. */
export function dms(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value)
  const degrees = Math.floor(abs)
  const minutesFull = (abs - degrees) * 60
  const minutes = Math.floor(minutesFull)
  const seconds = Math.round((minutesFull - minutes) * 60)
  return `${degrees}° ${String(minutes).padStart(2, '0')}' ${String(seconds).padStart(2, '0')}" ${value >= 0 ? positive : negative}`
}

export const LEVEL_COLOR: Record<Level, string> = {
  ok: '#1a8a5a',
  watch: '#c58a00',
  warn: '#d0581c',
  danger: '#c42b2b',
}
