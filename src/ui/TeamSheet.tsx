import { useMemo, useState } from 'react'
import { ago, clock, distanceMeters, formatDistance, freshness, groupColor, GROUP_COLORS, mapsLink, type Freshness } from '../lib/geo'
import type { MeetingPoint } from '../lib/meeting'
import { avatarUrl, nameOf, supabase, type Profile } from '../lib/supabase'
import type { Mate, TeamFeed } from '../lib/team'
import type { Fix } from '../lib/tracking'
import { IconBack, IconClose } from './icons'

const STATUS: Record<Freshness, string> = { live: 'Live', stale: 'Delayed', offline: 'No signal', stopped: 'Field Mode off', never: 'No location yet' }

interface Props {
  profile: Profile
  team: TeamFeed
  me: Fix | null
  myUid: string | null
  meeting: MeetingPoint[]
  onClose: () => void
  onShow: (lat: number, lng: number) => void
  onTrail: (coords: [number, number][]) => void
  onDropPin: () => void
}

export function Avatar({ m, size = 40 }: { m: { avatar?: string | null; grp?: string | null; nickname?: string | null; full_name?: string | null }; size?: number }) {
  const url = avatarUrl(m.avatar)
  return (
    <span className="avatar-sm" style={{ width: size, height: size, background: groupColor(m.grp) }}>
      {url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : nameOf(m).slice(0, 2).toUpperCase()}
    </span>
  )
}

export default function TeamSheet({ profile, team, me, myUid, meeting, onClose, onShow, onTrail, onDropPin }: Props) {
  const admin = profile.is_admin
  const [filter, setFilter] = useState('All')
  const [sel, setSel] = useState<Mate | null>(null)
  const shown = team.mates.filter((m) => m.user_id !== myUid && (filter === 'All' || m.grp === filter))
  const live = shown.filter((m) => freshness(m) === 'live').length
  const sosUsers = useMemo(() => new Set(team.alerts.filter((a) => a.status === 'open').map((a) => a.user_id)), [team.alerts])

  const bySub = useMemo(() => {
    const g = new Map<string, Mate[]>()
    for (const m of shown) {
      const key = admin ? `${m.grp} · ${m.subgroup}` : m.subgroup
      g.set(key, [...(g.get(key) ?? []), m])
    }
    return [...g].sort(([a], [b]) => a.localeCompare(b))
  }, [shown, admin])

  async function trail(m: Mate) {
    const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const { data } = await supabase.from('locations').select('lat,lng').eq('user_id', m.user_id).gte('recorded_at', since).order('recorded_at').limit(3000)
    onTrail(((data ?? []) as { lat: number; lng: number }[]).map((p) => [p.lng, p.lat]))
    if (m.lat != null) onShow(m.lat, m.lng!)
    onClose()
  }

  async function endMeeting(mp: MeetingPoint) {
    await supabase.from('meeting_points').update({ active: false }).eq('id', mp.id)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack team-sheet" onClick={(e) => e.stopPropagation()}>
        {sel ? (
          <>
            <div className="row between">
              <button className="glass-btn sm" aria-label="Back to list" onClick={() => setSel(null)}><IconBack /></button>
              <button className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <Avatar m={sel} size={64} />
              <div>
                <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{nameOf(sel)}</h2>
                <p className="small muted tnum">{sel.index_no} · {sel.full_name}</p>
                <p className="small muted">{sel.grp} · {sel.subgroup} · {sel.elective}</p>
              </div>
            </div>
            <div className="stat-row">
              <div><b><span className={`dot ${freshness(sel)}`} style={{ display: 'inline-block', marginRight: 6 }} />{STATUS[freshness(sel)]}</b><span>Status</span></div>
              <div><b>{sel.recorded_at ? clock(sel.recorded_at) : '–'}</b><span>{sel.recorded_at ? ago(sel.recorded_at) : 'Last seen'}</span></div>
              <div><b>{me && sel.lat != null ? formatDistance(distanceMeters(me, { lat: sel.lat, lng: sel.lng! })) : '–'}</b><span>From you</span></div>
              <div><b>{sel.battery != null ? `${sel.battery}%` : 'n/a'}</b><span>Battery</span></div>
            </div>
            {admin && <p className="small muted">{team.recCount[sel.user_id] ?? 0} records today{sel.accuracy != null ? ` · GPS ±${Math.round(sel.accuracy)} m` : ''}</p>}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-primary grow" disabled={sel.lat == null} onClick={() => { onShow(sel.lat!, sel.lng!); onClose() }}>Show on map</button>
              {sel.lat != null && <a className="btn btn-ghost grow" href={mapsLink(sel.lat, sel.lng!)} target="_blank" rel="noreferrer">Directions</a>}
              {admin && <button className="btn btn-ghost grow" onClick={() => void trail(sel)}>Today's trail</button>}
            </div>
          </>
        ) : (
          <>
            <div className="row between">
              <div>
                <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{admin ? 'Team' : `My group · ${profile.grp}`}</h2>
                <p className="small muted tnum">{live} live · {shown.length} joined{admin ? '' : ` · ${profile.subgroup} is your subgroup`}</p>
              </div>
              <button className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
            </div>

            {admin && (
              <>
                <div className="segmented" role="group" aria-label="Filter by group">
                  {['All', ...Object.keys(GROUP_COLORS)].map((g) => (
                    <button key={g} aria-pressed={filter === g} onClick={() => setFilter(g)}>{g.replace('Group ', 'G')}</button>
                  ))}
                </div>
                {team.alerts.filter((a) => a.status === 'acknowledged').map((a) => (
                  <div key={a.id} className="list-row" style={{ background: 'var(--danger-wash)', boxShadow: 'none' }}>
                    <span className="small grow"><b>SOS handled</b> · {nameOf(team.byUser.get(a.user_id))} · {clock(a.created_at)}</span>
                    <button className="btn btn-sm btn-danger" onClick={() => void team.handleAlert(a, 'resolved')}>Resolve</button>
                  </div>
                ))}
                <section className="meet-panel">
                  <div className="row between">
                    <b>Meeting points</b>
                    <button className="btn btn-lime btn-sm" onClick={onDropPin}>Drop a pin</button>
                  </div>
                  {meeting.length === 0 && <p className="small muted">Call a group, or everyone, to one spot. Their phones buzz and show directions.</p>}
                  {meeting.map((mp) => (
                    <div key={mp.id} className="row" style={{ gap: 8 }}>
                      <span className="meet-flag sm" aria-hidden="true" />
                      <div className="grow">
                        <b style={{ fontSize: 14 }}>{mp.title}</b>
                        <p className="small muted">{mp.target_group ?? 'Everyone'}{mp.meet_at ? ` · by ${clock(mp.meet_at)}` : ''} · {ago(mp.created_at)}</p>
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => { onShow(mp.lat, mp.lng); onClose() }}>Show</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void endMeeting(mp)}>End</button>
                    </div>
                  ))}
                </section>
              </>
            )}

            {shown.length === 0 && <p className="empty">{admin ? 'No one has joined yet.' : 'No one else from your group has joined yet.'}</p>}
            {bySub.map(([sub, people]) => (
              <div key={sub}>
                <p className="sub-head">{sub}</p>
                {people.map((m) => {
                  const f = freshness(m)
                  const sos = sosUsers.has(m.user_id)
                  return (
                    <button key={m.user_id} className="person" onClick={() => setSel(m)}>
                      <Avatar m={m} />
                      <div className="grow">
                        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{nameOf(m)} <span className="muted tnum" style={{ fontWeight: 400, fontSize: 12 }}>{m.index_no}</span></div>
                        <div className="small muted">
                          {STATUS[f]}{m.recorded_at ? ` · ${ago(m.recorded_at)}` : ''}
                          {me && m.lat != null ? ` · ${formatDistance(distanceMeters(me, { lat: m.lat, lng: m.lng! }))}` : ''}
                        </div>
                      </div>
                      {sos ? <span className="chip chip-danger">SOS</span> : <span className={`dot ${f}`} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
