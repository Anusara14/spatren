// Anuradhapura District, padded a little so the edge of the district stays reachable.
export const DISTRICT_BOUNDS: [[number, number], [number, number]] = [[79.75, 7.75], [81.15, 9.0]]
export const ANURADHAPURA_CENTER: [number, number] = [80.4037, 8.3114]

export const GROUP_COLORS: Record<string, string> = {
  'Group 1': '#BED43D',
  'Group 2': '#4FA3D9',
  'Group 3': '#E8875B',
}
export const groupColor = (g: string | null | undefined) => (g && GROUP_COLORS[g]) || '#8A9BA8'

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`)

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  return new Date(iso).toLocaleDateString()
}

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'

export type Freshness = 'live' | 'stale' | 'offline' | 'stopped' | 'never'

// Never present old data as current: status is derived from the point's own timestamp.
export function freshness(row: { recorded_at: string | null; tracking: boolean | null }, now = Date.now()): Freshness {
  if (!row.recorded_at) return 'never'
  const age = now - new Date(row.recorded_at).getTime()
  if (age < 2 * 60_000) return 'live' // points arriving beat a lagging tracking flag
  if (!row.tracking) return 'stopped'
  if (age < 15 * 60_000) return 'stale'
  return 'offline'
}

export const mapsLink = (lat: number, lng: number) => `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`
