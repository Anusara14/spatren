import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sosAlarm } from './alarm'
import { nameOf, supabase, type Profile, type SosRow } from './supabase'

export interface Mate {
  index_no: string
  full_name: string
  nickname: string | null
  grp: string
  subgroup: string
  elective: string | null
  user_id: string
  avatar: string | null
  tracking: boolean | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  battery: number | null
  recorded_at: string | null
}

export interface TeamFeed {
  mates: Mate[]
  alerts: SosRow[]
  recCount: Record<string, number>
  byUser: Map<string, Mate>
  reload: () => void
  handleAlert: (a: SosRow, status: 'acknowledged' | 'resolved') => Promise<void>
}

const todayIso = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString()

/**
 * Who is on the map. Students: themselves + their own group (enforced by the group_status() function).
 * Admins: everyone, plus SOS alerts and today's record counts. Realtime for admins, polling for everyone.
 */
export function useTeam(profile: Profile): TeamFeed {
  const [mates, setMates] = useState<Mate[]>([])
  const [alerts, setAlerts] = useState<SosRow[]>([])
  const [recCount, setRecCount] = useState<Record<string, number>>({})
  const knownAlerts = useRef(new Set<string>())
  const matesRef = useRef(mates)
  matesRef.current = mates
  const admin = profile.is_admin

  const loadMates = useCallback(async () => {
    const { data } = await supabase.rpc('group_status')
    if (data) setMates(data as Mate[])
  }, [])

  const loadAlerts = useCallback(async () => {
    if (!admin) return
    const { data } = await supabase.from('sos_alerts').select('*').neq('status', 'resolved').order('created_at', { ascending: false })
    if (!data) return
    const rows = data as SosRow[]
    const fresh = rows.filter((a) => a.status === 'open' && !knownAlerts.current.has(a.id))
    rows.forEach((a) => knownAlerts.current.add(a.id))
    setAlerts(rows) // banner first; the alarm must never block it
    if (fresh.length) sosAlarm(nameOf(matesRef.current.find((m) => m.user_id === fresh[0].user_id)))
  }, [admin])

  const loadCounts = useCallback(async () => {
    if (!admin) return
    const { data } = await supabase.from('records').select('user_id').gte('recorded_at', todayIso())
    const c: Record<string, number> = {}
    for (const r of (data ?? []) as { user_id: string }[]) c[r.user_id] = (c[r.user_id] ?? 0) + 1
    setRecCount(c)
  }, [admin])

  const reload = useCallback(() => {
    void loadMates()
    void loadAlerts()
    void loadCounts()
  }, [loadMates, loadAlerts, loadCounts])

  useEffect(() => {
    reload()
    const poll = setInterval(() => void loadMates(), admin ? 60_000 : 20_000)
    const sosPoll = admin ? setInterval(() => void loadAlerts(), 15_000) : null // SOS never relies on realtime alone
    const counts = admin ? setInterval(() => void loadCounts(), 60_000) : null
    let ch: ReturnType<typeof supabase.channel> | null = null
    if (admin) {
      ch = supabase
        .channel('team-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, (p) => {
          const l = p.new as { user_id: string; lat: number; lng: number; accuracy: number; battery: number | null; recorded_at: string }
          setMates((rows) => rows.map((r) => (r.user_id === l.user_id && (!r.recorded_at || l.recorded_at > r.recorded_at) ? { ...r, ...l, tracking: true } : r)))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => void loadAlerts())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => void loadMates())
        .subscribe((s) => s === 'SUBSCRIBED' && reload())
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    }
    return () => {
      clearInterval(poll)
      if (sosPoll) clearInterval(sosPoll)
      if (counts) clearInterval(counts)
      if (ch) void supabase.removeChannel(ch)
    }
  }, [admin, reload, loadMates, loadAlerts, loadCounts])

  const handleAlert = useCallback(
    async (a: SosRow, status: 'acknowledged' | 'resolved') => {
      const { data: s } = await supabase.auth.getSession()
      await supabase.from('sos_alerts').update({ status, handled_at: new Date().toISOString(), handled_by: s.session?.user.id }).eq('id', a.id)
      void loadAlerts()
    },
    [loadAlerts],
  )

  const byUser = useMemo(() => new Map(mates.map((m) => [m.user_id, m])), [mates])
  return { mates, alerts, recCount, byUser, reload, handleAlert }
}
