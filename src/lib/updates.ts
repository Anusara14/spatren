import { useEffect, useState } from 'react'
import { IS_NATIVE } from './native'

/**
 * Android app updates without reinstalling:
 *  - web code (almost every change): downloaded in the background via Capgo, used from the next start
 *  - native code (rare): a newer APK is announced with a download button
 * Self-hosted: /app-version.json and /ota/*.zip are published by scripts/ota.mjs with every Vercel build.
 * Capgo's own servers and stats are switched off in capacitor.config.ts.
 */
const MANIFEST_URL = 'https://spatren.vercel.app/app-version.json'

interface Manifest {
  build: number
  zip: string
  sha256: string
  minNative: number
  apk: { versionCode: number; versionName: string; url: string }
}

export type UpdateState = { kind: 'none' } | { kind: 'web'; id: string } | { kind: 'apk'; url: string; version: string }

let state: UpdateState = { kind: 'none' }
const listeners = new Set<(s: UpdateState) => void>()
const emit = (s: UpdateState) => {
  state = s
  listeners.forEach((l) => l(s))
}
let busy = false
let readyBuild = 0

function isManifest(m: unknown): m is Manifest {
  const x = m as Manifest
  return !!x && Number.isFinite(x.build) && typeof x.zip === 'string' && x.zip.startsWith('https://') && /^[0-9a-f]{64}$/.test(x.sha256)
}

async function check(): Promise<void> {
  if (busy || !navigator.onLine) return
  busy = true
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    const m: unknown = res.ok ? await res.json() : null
    if (!isManifest(m)) return
    const [{ App }, { CapacitorUpdater }] = await Promise.all([import('@capacitor/app'), import('@capgo/capacitor-updater')])
    const native = Number((await App.getInfo()).build) || 0
    if (m.apk?.versionCode > native && m.apk.url.startsWith('https://')) emit({ kind: 'apk', url: m.apk.url, version: m.apk.versionName })
    if (m.build > __BUILD__ && m.build !== readyBuild && native >= m.minNative) {
      // Checksum-verified download; a broken bundle that never calls notifyAppReady is rolled back automatically.
      const bundle = await CapacitorUpdater.download({ url: m.zip, version: String(m.build), checksum: m.sha256 })
      await CapacitorUpdater.next({ id: bundle.id })
      readyBuild = m.build
      if (state.kind !== 'apk') emit({ kind: 'web', id: bundle.id })
    }
  } catch {
    /* offline or server hiccup: try again on the next open */
  } finally {
    busy = false
  }
}

/** Call once at startup (Android app only). */
export async function startUpdates(): Promise<void> {
  if (!IS_NATIVE) return
  const { App } = await import('@capacitor/app')
  void check()
  await App.addListener('resume', () => void check())
}

/** Restart into the downloaded version now (otherwise it is used the next time the app starts). */
export async function restartIntoUpdate(id: string): Promise<void> {
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
  await CapacitorUpdater.set({ id })
}

export function useUpdate(): [UpdateState, () => void] {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return [s, () => emit({ kind: 'none' })]
}
