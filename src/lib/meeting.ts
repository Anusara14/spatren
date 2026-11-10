import { useEffect, useState } from 'react'
import { IS_NATIVE, nativeNotifState, nativeNotify, type NotifState } from './native'
import { supabase } from './supabase'

export interface MeetingPoint {
  id: string
  title: string
  note: string | null
  lat: number
  lng: number
  meet_at: string | null
  target_group: string | null
  active: boolean
  created_at: string
}

const CACHE = 'spatren.meeting'
const SEEN = 'spatren.meeting.seen'

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback
  } catch {
    return fallback
  }
}

// System notification through the service worker (works on Android Chrome, where `new Notification` throws).
export async function notify(title: string, body: string, tag: string): Promise<void> {
  try {
    navigator.vibrate?.([300, 120, 300])
    if (IS_NATIVE) return await nativeNotify(title, body)
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker?.ready
    if (reg) await reg.showNotification(title, { body, tag, icon: '/icon.svg', badge: '/icon.svg', requireInteraction: true })
    else new Notification(title, { body, tag, icon: '/icon.svg' })
  } catch {
    /* notifications are best-effort; the in-app banner always shows */
  }
}

/** Current notification permission; `ask` prompts if it hasn't been decided yet. */
export async function notificationState(ask = false): Promise<NotifState> {
  try {
    if (IS_NATIVE) return await nativeNotifState(ask)
    if (!('Notification' in window)) return 'denied'
    if (ask && Notification.permission === 'default') await Notification.requestPermission()
    return Notification.permission
  } catch {
    return 'denied'
  }
}

export async function askNotificationPermission(): Promise<NotifState> {
  return notificationState(true)
}

/** Active meeting points for this person (their group or everyone), live + cached for offline. */
export function useMeetingPoints(group: string | null, isAdmin: boolean): MeetingPoint[] {
  const [points, setPoints] = useState<MeetingPoint[]>(() => readJson<MeetingPoint[]>(CACHE, []))

  useEffect(() => {
    const relevant = (p: MeetingPoint) => isAdmin || !p.target_group || p.target_group === group
    const load = async () => {
      const { data } = await supabase.from('meeting_points').select('*').eq('active', true).order('created_at', { ascending: false })
      if (!data) return
      const list = (data as MeetingPoint[]).filter(relevant)
      setPoints(list)
      localStorage.setItem(CACHE, JSON.stringify(list))
      const seen = new Set(readJson<string[]>(SEEN, []))
      for (const p of list) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        if (!isAdmin) void notify(`Gather at: ${p.title}`, p.note || 'Open SPATREN for the location and directions.', `mp-${p.id}`)
      }
      localStorage.setItem(SEEN, JSON.stringify([...seen].slice(-50)))
    }
    void load()
    const ch = supabase
      .channel(`meeting-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_points' }, () => void load())
      .subscribe((s) => s === 'SUBSCRIBED' && void load())
    const poll = setInterval(() => void load(), 30_000) // never rely on realtime alone
    return () => {
      clearInterval(poll)
      void supabase.removeChannel(ch)
    }
  }, [group, isAdmin])

  return points
}
