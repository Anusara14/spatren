import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ago, clock, distanceMeters, formatDistance, freshness, groupColor, mapsLink, type Freshness, GROUP_COLORS } from '../lib/geo'
import { nameOf, supabase, type SosRow, type TeamRow } from '../lib/supabase'
import { currentFix, type Fix } from '../lib/tracking'
import { useMeetingPoints, type MeetingPoint } from '../lib/meeting'
import MapView, { type MapMarker } from './MapView'

const STATUS_LABEL: Record<Freshness, string> = {
  live: 'Live', stale: 'Delayed', offline: 'No signal', stopped: 'Field Mode off', never: 'No location yet',
}
const todayIso = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
const initials = (name: string) => name.split(/[\s.]+/)[0]?.slice(0, 2).toUpperCase() ?? '?'

export default function Control() {
  const [team, setTeam] = useState<TeamRow[]>([])
  const [alerts, setAlerts] = useState<SosRow[]>([])
  const [recCount, setRecCount] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<string | null>(null) // index_no
  const [filter, setFilter] = useState<string>('All')
  const [me, setMe] = useState<Fix | null>(null)
  const [trail, setTrail] = useState<[number, number][]>([])
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: string } | null>(null)
  const meeting = useMeetingPoints(null, true)
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null)
  const [, tick] = useState(0)
  const knownAlerts = useRef(new Set<string>())

  const loadTeam = useCallback(async () => {
    const { data } = await supabase.from('team_status').select('*').order('grp').order('subgroup').order('full_name')
    if (data) setTeam(data as TeamRow[])
  }, [])

  const loadAlerts = useCallback(async () => {
    const { data } = await supabase.from('sos_alerts').select('*').neq('status', 'resolved').order('created_at', { ascending: false })
    if (!data) return
    const rows = data as SosRow[]
    const fresh = rows.filter((a) => a.status === 'open' && !knownAlerts.current.has(a.id))
    rows.forEach((a) => knownAlerts.current.add(a.id))
    setAlerts(rows) // show the banner first; the alarm must never be able to block it
    if (fresh.length) alarm() // includes alerts already open when the page loads
  }, [])

  const loadCounts = useCallback(async () => {
    const { data } = await supabase.from('records').select('user_id').gte('recorded_at', todayIso())
    const c: Record<string, number> = {}
    for (const r of (data ?? []) as { user_id: string }[]) c[r.user_id] = (c[r.user_id] ?? 0) + 1
    setRecCount(c)
  }, [])

  useEffect(() => {
    void loadTeam()
    void loadAlerts()
    void loadCounts()
    void currentFix().then(setMe)
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()

    const ch = supabase
      .channel('control-room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'locations' }, (p) => {
        const l = p.new as { user_id: string; lat: number; lng: number; accuracy: number; battery: number | null; charging: boolean | null; recorded_at: string; received_at: string }
        setTeam((rows) =>
          rows.map((r) =>
            r.user_id === l.user_id && (!r.recorded_at || l.recorded_at > r.recorded_at)
              ? { ...r, lat: l.lat, lng: l.lng, accuracy: l.accuracy, battery: l.battery, charging: l.charging, recorded_at: l.recorded_at, received_at: l.received_at, tracking: true }
              : r,
          ),
        )
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, () => void loadAlerts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => void loadTeam())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // (re)connected: catch up on anything missed while the socket was down
          void loadTeam()
          void loadAlerts()
        }
      })

    const slow = setInterval(() => {
      void loadTeam() // catches anything realtime missed (e.g. laptop slept)
      void loadCounts()
    }, 60_000)
    // SOS must never depend on realtime alone: poll it too.
    const sosPoll = setInterval(() => void loadAlerts(), 15_000)
    const fast = setInterval(() => tick((n) => n + 1), 10_000)
    return () => {
      void supabase.removeChannel(ch)
      clearInterval(slow)
      clearInterval(fast)
      clearInterval(sosPoll)
    }
  }, [loadTeam, loadAlerts, loadCounts])

  const byUser = useMemo(() => new Map(team.filter((r) => r.user_id).map((r) => [r.user_id!, r])), [team])
  const sosUsers = useMemo(() => new Set(alerts.filter((a) => a.status === 'open').map((a) => a.user_id)), [alerts])
  const visible = team.filter((r) => filter === 'All' || r.grp === filter)
  const sel = team.find((r) => r.index_no === selected) ?? null

  const counts = useMemo(() => {
    const c: Record<Freshness, number> = { live: 0, stale: 0, offline: 0, stopped: 0, never: 0 }
    for (const r of visible) c[freshness(r)]++
    return c
  }, [visible])

  const markers: MapMarker[] = visible
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.index_no,
      lat: r.lat!,
      lng: r.lng!,
      color: groupColor(r.grp),
      label: initials(nameOf(r)),
      className: `${freshness(r)} ${r.user_id && sosUsers.has(r.user_id) ? 'mk-sos' : ''}`,
      title: `${nameOf(r)} (${r.full_name}) · ${r.grp} ${r.subgroup} · ${ago(r.recorded_at)}`,
    }))

  async function select(index: string) {
    setSelected(index)
    const r = team.find((x) => x.index_no === index)
    if (r?.lat != null) setFocus({ lat: r.lat, lng: r.lng!, key: index + Date.now() })
    setTrail([])
  }

  async function showTrail() {
    if (!sel?.user_id) return
    const { data } = await supabase
      .from('locations')
      .select('lat,lng,recorded_at')
      .eq('user_id', sel.user_id)
      .gte('recorded_at', todayIso())
      .order('recorded_at')
      .limit(2000)
    setTrail(((data ?? []) as { lat: number; lng: number }[]).map((p) => [p.lng, p.lat]))
  }

  async function handle(a: SosRow, status: 'acknowledged' | 'resolved') {
    const { data: s } = await supabase.auth.getSession()
    await supabase.from('sos_alerts').update({ status, handled_at: new Date().toISOString(), handled_by: s.session?.user.id }).eq('id', a.id)
    void loadAlerts()
  }

  const openAlerts = alerts.filter((a) => a.status === 'open')
  const topAlert = openAlerts[0]
  const topAlertWho = topAlert ? byUser.get(topAlert.user_id) : undefined

  return (
    <div className="control">
      <div className="map-wrap">
        <MapView
          markers={markers}
          selectedId={selected}
          onSelect={(id) => void select(id)}
          me={me}
          trail={trail}
          focus={focus}
          meetingPoints={draft ? [...meeting, { id: 'draft', title: 'New meeting point', note: null, lat: draft.lat, lng: draft.lng, meet_at: null, target_group: null, active: true, created_at: '' }] : meeting}
          onMeetingClick={(m) => setFocus({ lat: m.lat, lng: m.lng, key: m.id + Date.now() })}
          onPick={picking ? (p) => { setDraft(p); setPicking(false) } : null}
          controlsBottom={topAlert ? '150px' : '24px'}
        />
        {picking && (
          <div className="pick-hint glass">
            <span>Tap the map where everyone should gather</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        )}
        <div className="map-overlay">
          <div className="legend glass">
            {Object.entries(GROUP_COLORS).map(([g, c]) => (
              <span key={g} className="row" style={{ gap: 6 }}><span className="dot" style={{ background: c }} />{g}</span>
            ))}
          </div>
          <div className="legend glass">
            <span className="row" style={{ gap: 6 }}><span className="dot live" />{counts.live} live</span>
            <span className="row" style={{ gap: 6 }}><span className="dot stale" />{counts.stale}</span>
            <span className="row" style={{ gap: 6 }}><span className="dot offline" />{counts.offline + counts.stopped}</span>
          </div>
        </div>
        {topAlert && (
          <div className="alarm">
            <div className="row between">
              <div>
                <b>SOS · {nameOf(topAlertWho)}</b>
                <p className="small" style={{ opacity: 0.9 }}>
                  {topAlertWho ? `${topAlertWho.grp} · ${topAlertWho.subgroup} · ` : ''}sent {clock(topAlert.created_at)} ({ago(topAlert.created_at)})
                  {topAlert.battery != null ? ` · battery ${topAlert.battery}%` : ''}
                  {topAlert.location_at ? ` · GPS from ${clock(topAlert.location_at)} (${ago(topAlert.location_at)})` : ' · no GPS fix'}
                  {openAlerts.length > 1 ? ` · +${openAlerts.length - 1} more` : ''}
                </p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              {topAlert.lat != null && (
                <button className="btn btn-sm" style={{ background: '#fff', color: 'var(--danger)' }} onClick={() => setFocus({ lat: topAlert.lat!, lng: topAlert.lng!, key: topAlert.id + Date.now() })}>
                  Show on map
                </button>
              )}
              {topAlert.lat != null && (
                <a className="btn btn-sm" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }} href={mapsLink(topAlert.lat, topAlert.lng!)} target="_blank" rel="noreferrer">
                  Directions
                </a>
              )}
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }} onClick={() => void handle(topAlert, 'acknowledged')}>
                Acknowledge
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="panel stack" style={{ gap: 12 }}>
        <div className="row between">
          <div>
            <h1 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>Live field map</h1>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void currentFix().then(setMe)}>Locate me</button>
        </div>

        <MeetingPanel meeting={meeting} draft={draft} me={me} onPick={() => { setDraft(null); setPicking(true) }} onClear={() => setDraft(null)} onShow={(m) => setFocus({ lat: m.lat, lng: m.lng, key: m.id + Date.now() })} />

        <div className="segmented" role="group" aria-label="Filter by group">
          {['All', ...Object.keys(GROUP_COLORS)].map((g) => (
            <button key={g} aria-pressed={filter === g} onClick={() => setFilter(g)}>{g.replace('Group ', 'G')}</button>
          ))}
        </div>

        {alerts.filter((a) => a.status === 'acknowledged').map((a) => (
          <div key={a.id} className="card-flat row between" style={{ background: 'var(--danger-wash)' }}>
            <span className="small"><b>SOS acknowledged</b> · {nameOf(byUser.get(a.user_id))} · {clock(a.created_at)}</span>
            <button className="btn btn-sm btn-danger" onClick={() => void handle(a, 'resolved')}>Resolve</button>
          </div>
        ))}

        {sel && (
          <div className="card stack" style={{ gap: 10, boxShadow: 'none', border: '1px solid var(--line)' }}>
            <div className="row between">
              <div className="row">
                <div className="avatar" style={{ background: groupColor(sel.grp) }}>{initials(nameOf(sel))}</div>
                <div>
                  <b>{nameOf(sel)}</b>
                  <p className="small muted mono">{sel.full_name} · {sel.index_no}</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="chip" style={{ background: groupColor(sel.grp), color: 'var(--navy)' }}>{sel.grp}</span>
              <span className="chip">{sel.subgroup}</span>
              <span className="chip">{sel.elective}</span>
            </div>
            <table className="t">
              <tbody>
                <tr><td className="muted">Status</td><td><span className="row" style={{ gap: 6 }}><span className={`dot ${freshness(sel)}`} />{sel.status !== 'approved' ? 'Not joined yet' : STATUS_LABEL[freshness(sel)]}</span></td></tr>
                <tr><td className="muted">Last location</td><td>{sel.recorded_at ? `${clock(sel.recorded_at)} · ${ago(sel.recorded_at)}` : '–'}</td></tr>
                <tr><td className="muted">Accuracy</td><td>{sel.accuracy != null ? `±${Math.round(sel.accuracy)} m` : '–'}</td></tr>
                <tr><td className="muted">Battery</td><td>{sel.battery != null ? `${sel.battery}%${sel.charging ? ' ⚡' : ''} (at ${clock(sel.recorded_at)})` : 'Not reported (iPhone or unsupported)'}</td></tr>
                <tr><td className="muted">From you</td><td>{me && sel.lat != null ? formatDistance(distanceMeters(me, { lat: sel.lat, lng: sel.lng! })) : me ? '–' : 'Tap "Locate me"'}</td></tr>
                <tr><td className="muted">Records today</td><td>{sel.user_id ? recCount[sel.user_id] ?? 0 : 0}</td></tr>
              </tbody>
            </table>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm grow" onClick={() => void showTrail()} disabled={!sel.user_id}>Today's trail</button>
              {sel.lat != null && (
                <a className="btn btn-primary btn-sm grow" href={mapsLink(sel.lat, sel.lng!)} target="_blank" rel="noreferrer">Directions</a>
              )}
            </div>
          </div>
        )}

        <TeamList rows={visible} selected={selected} onSelect={(i) => void select(i)} sosUsers={sosUsers} recCount={recCount} />
      </aside>
    </div>
  )
}

interface TeamListProps {
  rows: TeamRow[]
  selected: string | null
  onSelect: (index: string) => void
  sosUsers: Set<string>
  recCount: Record<string, number>
}

function TeamList({ rows, selected, onSelect, sosUsers, recCount }: TeamListProps) {
  const groups = new Map<string, Map<string, TeamRow[]>>()
  for (const r of rows) {
    const g = groups.get(r.grp) ?? new Map<string, TeamRow[]>()
    g.set(r.subgroup, [...(g.get(r.subgroup) ?? []), r])
    groups.set(r.grp, g)
  }
  return (
    <div>
      {[...groups].map(([grp, subs]) => {
        const all = [...subs.values()].flat()
        const live = all.filter((r) => freshness(r) === 'live').length
        const recs = all.reduce((n, r) => n + (r.user_id ? recCount[r.user_id] ?? 0 : 0), 0)
        return (
          <section key={grp}>
            <div className="group-head">
              <span className="dot" style={{ background: groupColor(grp), width: 12, height: 12 }} />
              {grp}
              <span className="muted small" style={{ fontWeight: 500 }}>· {live}/{all.length} live · {recs} records today</span>
            </div>
            {[...subs].map(([sub, people]) => (
              <div key={sub}>
                <div className="sub-head">{sub}</div>
                {people.map((r) => {
                  const f = freshness(r)
                  const sos = r.user_id && sosUsers.has(r.user_id)
                  return (
                    <button key={r.index_no} className="person" aria-selected={selected === r.index_no} onClick={() => onSelect(r.index_no)}>
                      <div className="avatar" style={{ background: sos ? 'var(--danger)' : groupColor(r.grp), opacity: f === 'live' || sos ? 1 : 0.55 }}>
                        {initials(nameOf(r))}
                      </div>
                      <div className="grow">
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{nameOf(r)} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{r.full_name}</span></div>
                        <div className="small muted">
                          {r.status !== 'approved' ? 'Not joined' : `${STATUS_LABEL[f]}${r.recorded_at ? ` · ${ago(r.recorded_at)}` : ''}`}
                          {r.battery != null && r.status === 'approved' ? ` · ${r.battery}%` : ''}
                        </div>
                      </div>
                      {sos ? <span className="chip chip-danger">SOS</span> : <span className={`dot ${r.status === 'approved' ? f : 'never'}`} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

// Loud enough to hear across a room: three beeps plus a system notification.
function alarm(): void {
  try {
    beep()
  } catch {
    /* audio blocked until the admin interacts with the page */
  }
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      // Android Chrome throws here (needs a service worker notification); the banner + beep still work.
      new Notification('SPATREN · SOS alert', { body: 'A student has sent an emergency alert. Open the live map.', icon: '/icon.svg', requireInteraction: true })
    }
  } catch {
    /* ignore */
  }
  try {
    navigator.vibrate?.([400, 150, 400])
  } catch {
    /* ignore */
  }
}

function beep(): void {
  {
    const ctx = new AudioContext()
    void ctx.resume()
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      o.connect(g).connect(ctx.destination)
      const t = ctx.currentTime + i * 0.45
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.start(t)
      o.stop(t + 0.36)
    }
  }
}

interface MeetingPanelProps {
  meeting: MeetingPoint[]
  draft: { lat: number; lng: number } | null
  me: Fix | null
  onPick: () => void
  onClear: () => void
  onShow: (m: MeetingPoint) => void
}

function MeetingPanel({ meeting, draft, me, onPick, onClear, onShow }: MeetingPanelProps) {
  const [title, setTitle] = useState('Meet here')
  const [note, setNote] = useState('')
  const [time, setTime] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send() {
    if (!draft) return
    setBusy(true)
    setErr(null)
    let meet_at: string | null = null
    if (time) {
      const [h, m] = time.split(':').map(Number)
      const d = new Date()
      d.setHours(h, m, 0, 0)
      meet_at = d.toISOString()
    }
    const { error } = await supabase.from('meeting_points').insert({
      title: title.trim() || 'Meet here', note: note.trim() || null, lat: draft.lat, lng: draft.lng, meet_at, target_group: target || null,
    })
    setBusy(false)
    if (error) return setErr(`Could not send: ${error.message}`)
    setNote('')
    setTime('')
    onClear()
  }

  async function end(m: MeetingPoint) {
    await supabase.from('meeting_points').update({ active: false }).eq('id', m.id)
  }

  return (
    <section className="meet-panel">
      <div className="row between">
        <b>Meeting points</b>
        {!draft && <button className="btn btn-lime btn-sm" onClick={onPick}>Drop a pin</button>}
      </div>
      {draft && (
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name, e.g. Bus stand, Lunch" maxLength={120} />
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} />
          <div className="row">
            <label className="grow small muted">By (optional)<input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            <label className="grow small muted">Who
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Everyone</option>
                {Object.keys(GROUP_COLORS).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          </div>
          {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
          <div className="row">
            <button className="btn btn-primary btn-sm grow" onClick={() => void send()} disabled={busy}>{busy ? 'Sending…' : 'Send to phones'}</button>
            <button className="btn btn-ghost btn-sm" onClick={onClear}>Discard</button>
          </div>
        </div>
      )}
      {meeting.map((m) => (
        <div key={m.id} className="list-row">
          <span className="meet-flag sm" aria-hidden="true" />
          <div className="grow">
            <b style={{ fontSize: 14 }}>{m.title}</b>
            <p className="small muted">
              {m.target_group ?? 'Everyone'}{m.meet_at ? ` · by ${clock(m.meet_at)}` : ''} · sent {ago(m.created_at)}
              {me ? ` · ${formatDistance(distanceMeters(me, m))} from you` : ''}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => onShow(m)}>Show</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void end(m)}>End</button>
        </div>
      ))}
      {!meeting.length && !draft && <p className="small muted">Drop a pin to call a group, or everyone, to one spot. Their phones buzz and show directions.</p>}
    </section>
  )
}
