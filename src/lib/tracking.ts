import { useEffect, useState } from 'react'
import { db, type PendingPoint } from './db'
import { distanceMeters } from './geo'
import { BackgroundGeolocation, IS_NATIVE } from './native'
import { supabase } from './supabase'
import { markStopPending, syncNow } from './sync'

// ponytail: fixed cadence; make these per-project settings if battery tests say so
const SAVE_EVERY_MS = 30_000
const SAVE_MIN_MOVE_M = 25
const MAX_ACCURACY_M = 250
const TRAIL_KEEP_MS = 3 * 24 * 3600_000
const KEY = 'spatren.tracking'

export interface Fix {
  lat: number
  lng: number
  accuracy: number
  at: string
}

export interface TrackerState {
  active: boolean
  fix: Fix | null
  error: string | null
  wakeLock: boolean
  battery: number | null
}

type BatteryLike = { level: number; charging: boolean }

let state: TrackerState = { active: false, fix: null, error: null, wakeLock: false, battery: null }
const listeners = new Set<(s: TrackerState) => void>()
let watchId: number | null = null
let nativeWatcher: string | null = null // Android app: foreground-service watcher (keeps going with the screen off)
let heartbeat: number | null = null
let wakeLock: WakeLockSentinel | null = null
let lastSaved: { t: number; lat: number; lng: number } | null = null
let battery: BatteryLike | null = null
let wanted = false // guards double-taps and start/stop races across the awaits below
let ticks = 0

function set(patch: Partial<TrackerState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l(state))
}

export function useTracker(): TrackerState {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

export const getLastFix = (): Fix | null => state.fix

async function readBattery(): Promise<void> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    battery = (await nav.getBattery?.()) ?? null // not available on iOS Safari / Firefox
  } catch {
    battery = null
  }
}

async function acquireWakeLock(): Promise<void> {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => set({ wakeLock: false }))
      set({ wakeLock: true })
    }
  } catch {
    set({ wakeLock: false })
  }
}

function onVisibility(): void {
  if (state.active && document.visibilityState === 'visible') {
    void acquireWakeLock()
    void syncNow()
  }
}

const onPosition = (p: GeolocationPosition): Promise<void> =>
  onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: new Date(p.timestamp).toISOString() })

async function onFix(fix: Fix): Promise<void> {
  set({ fix, error: null, battery: battery ? Math.round(battery.level * 100) : null })
  if (fix.accuracy > MAX_ACCURACY_M) return

  const now = new Date(fix.at).getTime()
  const moved = lastSaved ? distanceMeters(lastSaved, fix) : Infinity
  if (lastSaved && now - lastSaved.t < SAVE_EVERY_MS && moved < SAVE_MIN_MOVE_M) return
  lastSaved = { t: now, lat: fix.lat, lng: fix.lng }

  const point: PendingPoint = {
    client_id: crypto.randomUUID(),
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    battery: battery ? Math.round(battery.level * 100) : null,
    charging: battery ? battery.charging : null,
    recorded_at: fix.at,
  }
  // Saved locally first: this works with no signal; the outbox uploads the trail when back online.
  await db.transaction('rw', db.points, db.trail, async () => {
    await db.points.add(point)
    await db.trail.add(point)
  })
  if (navigator.onLine) void syncNow()
}

function onError(e: GeolocationPositionError): void {
  const msg =
    e.code === e.PERMISSION_DENIED
      ? 'Location permission denied. Allow location for this site in your browser settings.'
      : e.code === e.POSITION_UNAVAILABLE
        ? 'GPS signal unavailable. Move to open sky.'
        : 'Waiting for GPS…'
  set({ error: msg })
}

export async function startTracking(): Promise<void> {
  if (wanted) return
  if (!('geolocation' in navigator)) {
    set({ error: 'This browser has no GPS access.' })
    return
  }
  wanted = true
  localStorage.setItem(KEY, '1')
  await readBattery()
  if (!wanted) return // stopped while we were waiting
  if (IS_NATIVE) {
    try {
      const id = await BackgroundGeolocation.addWatcher(
        { backgroundTitle: 'SPATREN is sharing your location', backgroundMessage: 'Field Mode is on. Stop it from the app.', requestPermissions: true, stale: false },
        (loc, err) => {
          if (err) {
            set({ error: err.code === 'NOT_AUTHORIZED' ? 'Location permission denied. Allow location for SPATREN in Settings.' : 'Waiting for GPS…' })
            if (err.code === 'NOT_AUTHORIZED') void BackgroundGeolocation.openSettings()
            return
          }
          if (loc) void onFix({ lat: loc.latitude, lng: loc.longitude, accuracy: Math.round(loc.accuracy), at: new Date(loc.time ?? Date.now()).toISOString() })
        },
      )
      if (!wanted) return void BackgroundGeolocation.removeWatcher({ id })
      nativeWatcher = id
    } catch {
      wanted = false
      localStorage.removeItem(KEY)
      set({ error: 'Could not start location. Turn on Location in your phone settings.' })
      return
    }
  } else {
    watchId = navigator.geolocation.watchPosition((p) => void onPosition(p), onError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 60_000,
    })
  }
  // Some phones only report on movement; poll so a stationary student still shows as live.
  heartbeat = window.setInterval(() => {
    const age = state.fix ? Date.now() - new Date(state.fix.at).getTime() : Infinity
    if (age > SAVE_EVERY_MS && !IS_NATIVE) {
      navigator.geolocation.getCurrentPosition((p) => void onPosition(p), onError, {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 30_000,
      })
    }
    // Re-assert "tracking on" every ~5 min so a start made offline still reaches the server.
    if (ticks++ % 10 === 0) void supabase.rpc('set_tracking', { p_on: true })
    void syncNow()
  }, SAVE_EVERY_MS)
  document.addEventListener('visibilitychange', onVisibility)
  set({ active: true })
  localStorage.removeItem('spatren.stopPending') // a newer start wins over an un-sent stop
  void supabase.rpc('set_tracking', { p_on: true })
  if (!IS_NATIVE) await acquireWakeLock() // the Android app tracks with the screen off; the web needs it on
  if (!wanted) return void stopTracking()
  void db.trail.where('recorded_at').below(new Date(Date.now() - TRAIL_KEEP_MS).toISOString()).delete()
}

export async function stopTracking(): Promise<void> {
  wanted = false
  ticks = 0
  if (watchId !== null) navigator.geolocation.clearWatch(watchId)
  if (nativeWatcher !== null) void BackgroundGeolocation.removeWatcher({ id: nativeWatcher })
  nativeWatcher = null
  if (heartbeat !== null) clearInterval(heartbeat)
  watchId = heartbeat = null
  lastSaved = null
  document.removeEventListener('visibilitychange', onVisibility)
  await wakeLock?.release().catch(() => undefined)
  wakeLock = null
  localStorage.removeItem(KEY)
  set({ active: false, wakeLock: false })
  const { error } = await supabase.rpc('set_tracking', { p_on: false })
  if (error) markStopPending() // offline: retried on the next sync
  void syncNow()
}

export const wasTracking = (): boolean => localStorage.getItem(KEY) === '1'

// One-off fix for forms / SOS when Field Mode is off.
export function currentFix(timeout = 15_000): Promise<Fix | null> {
  if (state.fix && Date.now() - new Date(state.fix.at).getTime() < 60_000) return Promise.resolve(state.fix)
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          at: new Date(p.timestamp).toISOString(),
        }),
      () => resolve(state.fix),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout },
    )
  })
}
