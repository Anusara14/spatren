import { useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'spatren.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref: ThemePref = readPref()
const resolve = (): Theme => (pref === 'system' ? (media.matches ? 'dark' : 'light') : pref)

function apply(): void {
  const t = resolve()
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#000000' : '#13283C')
  listeners.forEach((l) => l())
}

media.addEventListener('change', () => pref === 'system' && apply())
apply() // run at import, before first paint of the app

export function setThemePref(p: ThemePref): void {
  pref = p
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* private mode: still applies for this session */
  }
  apply()
}

export function useTheme(): { pref: ThemePref; theme: Theme } {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { pref, theme: resolve() }
}
