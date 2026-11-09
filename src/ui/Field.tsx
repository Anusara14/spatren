import { liveQuery } from 'dexie'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { db } from '../lib/db'
import { ago, clock, distanceMeters, formatDistance, freshness, groupColor, GROUP_COLORS, mapsLink } from '../lib/geo'
import { askNotificationPermission, useMeetingPoints, type MeetingPoint } from '../lib/meeting'
import { avatarUrl, nameOf, supabase, type Profile } from '../lib/supabase'
import { syncNow, useOnline, useOutbox } from '../lib/sync'
import { useTeam } from '../lib/team'
import { startTracking, stopTracking, useTracker } from '../lib/tracking'
import { IconClose, IconPlus, IconSync, IconUsers } from './icons'
import MapView, { type MapMarker } from './MapView'
import ProfileSheet from './ProfileSheet'
import Sos from './Sos'
import SwipeDock from './SwipeDock'
import TeamSheet from './TeamSheet'

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
const STANDALONE = window.matchMedia('(display-mode: standalone)').matches
const initials = (s: string) => s.split(/[\s.]+/)[0]?.slice(0, 2).toUpperCase() ?? '?'

type Sheet = null | 'details' | 'team' | 'profile' | 'meet'
type Focus = { lat: number; lng: number; zoom?: number; key: string }

interface FieldProps {
  profile: Profile
  onRecord: () => void
  onProfileChange: () => void
}

// The one map in the app. Students see themselves + their group; admins see everyone and get the control tools.
export default function Field({ profile, onRecord, onProfileChange }: FieldProps) {
  const t = useTracker()
  const online = useOnline()
  const outbox = useOutbox()
  const team = useTeam(profile)
  const meeting = useMeetingPoints(profile.grp, profile.is_admin)
  const [myUid, setMyUid] = useState<string | null>(null)
  const [trail, setTrail] = useState<[number, number][]>([])
  const [otherTrail, setOtherTrail] = useState<[number, number][] | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null)
  const pickCenter = useRef<{ lat: number; lng: number } | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMyUid(data.user?.id ?? null))
    const id = setInterval(() => tick((n) => n + 1), 10_000) // refresh "x ago" labels
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
    const sub = liveQuery(() => db.trail.where('recorded_at').above(since).sortBy('recorded_at')).subscribe({
      next: (pts) => setTrail(pts.map((p) => [p.lng, p.lat])),
    })
    return () => sub.unsubscribe()
  }, [])

  // Recentre once when the first fix arrives, not on every fix.
  const hasFix = !!t.fix
  useEffect(() => {
    if (t.fix) setFocus({ lat: t.fix.lat, lng: t.fix.lng, zoom: 16.4, key: 'me' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFix])

  const show = (lat: number, lng: number) => setFocus({ lat, lng, zoom: 17, key: `${lat},${lng},${Date.now()}` })
  const sosUsers = useMemo(() => new Set(team.alerts.filter((a) => a.status === 'open').map((a) => a.user_id)), [team.alerts])

  const markers: MapMarker[] = team.mates
    .filter((m) => m.user_id !== myUid && m.lat != null && m.lng != null)
    .map((m) => ({
      id: m.user_id,
      lat: m.lat!,
      lng: m.lng!,
      color: groupColor(m.grp),
      label: initials(nameOf(m)),
      avatar: avatarUrl(m.avatar),
      className: `${freshness(m)} ${sosUsers.has(m.user_id) ? 'mk-sos' : ''}`,
      title: `${nameOf(m)} · ${m.grp} ${m.subgroup} · ${ago(m.recorded_at)}`,
    }))

  const pending = outbox.points + outbox.sos + outbox.records
  const status = t.active ? (t.fix ? `Sharing · ±${t.fix.accuracy} m · ${ago(t.fix.at)}` : 'Finding GPS…') : 'Field Mode off'
  const liveMates = team.mates.filter((m) => m.user_id !== myUid && freshness(m) === 'live').length
  const banner = meeting.find((m) => !dismissed.includes(m.id)) ?? null
  const openAlert = team.alerts.find((a) => a.status === 'open') ?? null
  const alertWho = openAlert ? team.byUser.get(openAlert.user_id) : undefined

  function toggleTracking() {
    if (!t.active) void askNotificationPermission() // so meeting calls can reach a backgrounded phone
    void (t.active ? stopTracking() : startTracking())
  }

  async function manualSync() {
    setSyncing(true)
    await syncNow()
    setSyncing(false)
  }

  function startPick() {
    setSheet(null)
    setPicking(true)
    pickCenter.current = null
  }

  return (
    <div className="immersive">
      <MapView
        me={t.fix}
        markers={markers}
        onSelect={() => setSheet('team')}
        trail={otherTrail ?? trail}
        focus={focus}
        meetingPoints={meeting}
        onMeetingClick={(m) => { setDismissed((d) => d.filter((x) => x !== m.id)); show(m.lat, m.lng) }}
        onCenter={picking ? (c) => { pickCenter.current = c } : null}
        controlsBottom="calc(176px + var(--safe-b))"
        topControl={<Sos name={`${nameOf(profile)} (${profile.index_no ?? ''})`} variant="fab" />}
      />

      <header className="title-overlay">
        <h1>Anuradhapura</h1>
        <p>Hi {nameOf(profile)} · {profile.is_admin ? 'Coordinator' : profile.subgroup}</p>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="chip glass-chip chip-btn" onClick={() => setSheet('team')}>
            <IconUsers width={15} height={15} />
            {profile.is_admin ? 'Team' : profile.grp} · {liveMates} live
          </button>
          {!online && <span className="chip glass-chip"><span className="dot offline" />Offline</span>}
          {pending > 0 && <span className="chip glass-chip">{pending} to upload</span>}
          {otherTrail && <button className="chip glass-chip chip-btn" onClick={() => setOtherTrail(null)}>Hide trail <IconClose width={13} height={13} /></button>}
        </div>
      </header>

      <button className="profile-btn" aria-label="Profile and settings" onClick={() => setSheet('profile')} style={{ background: groupColor(profile.grp) }}>
        {avatarUrl(profile.avatar) ? <img src={avatarUrl(profile.avatar)!} alt="" referrerPolicy="no-referrer" /> : initials(nameOf(profile))}
      </button>

      {openAlert && (
        <div className="sos-banner" role="alert">
          <div className="grow">
            <b>SOS · {nameOf(alertWho)}</b>
            <p>
              {alertWho ? `${alertWho.grp} · ${alertWho.subgroup} · ` : ''}sent {clock(openAlert.created_at)} ({ago(openAlert.created_at)})
              {openAlert.battery != null ? ` · battery ${openAlert.battery}%` : ''}
              {openAlert.location_at ? ` · GPS ${ago(openAlert.location_at)}` : ' · no GPS'}
            </p>
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {openAlert.lat != null && <button className="btn btn-sm sos-btn-light" onClick={() => show(openAlert.lat!, openAlert.lng!)}>Show</button>}
              {openAlert.lat != null && <a className="btn btn-sm sos-btn-ghost" href={mapsLink(openAlert.lat, openAlert.lng!)} target="_blank" rel="noreferrer">Directions</a>}
              <button className="btn btn-sm sos-btn-ghost" onClick={() => void team.handleAlert(openAlert, 'acknowledged')}>Acknowledge</button>
            </div>
          </div>
        </div>
      )}

      {!openAlert && banner && !picking && (
        <div className="meet-banner" role="status">
          <span className="meet-flag" aria-hidden="true" />
          <div className="grow">
            <b>Gather: {banner.title}</b>
            <p>
              {t.fix ? `${formatDistance(distanceMeters(t.fix, banner))} away` : 'Location pinned'}
              {banner.meet_at ? ` · by ${clock(banner.meet_at)}` : ''}
              {banner.note ? ` · ${banner.note}` : ''}
            </p>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn btn-sm btn-lime" onClick={() => show(banner.lat, banner.lng)}>Show</button>
              <a className="btn btn-sm btn-ghost" href={mapsLink(banner.lat, banner.lng)} target="_blank" rel="noreferrer">Directions</a>
              <button className="btn btn-sm btn-ghost" onClick={() => setDismissed((d) => [...d, banner.id])}>OK</button>
            </div>
          </div>
        </div>
      )}

      {t.error && !picking && <p className="map-toast">{t.error}</p>}

      {picking ? (
        <>
          <div className="pick-hint glass" role="status">Move the map so the flag sits on the meeting place</div>
          <div className="pick-bar">
            <button className="btn btn-ghost grow" onClick={() => setPicking(false)}>Cancel</button>
            <button className="btn btn-lime grow" onClick={() => {
              const c = pickCenter.current ?? (t.fix ? { lat: t.fix.lat, lng: t.fix.lng } : null)
              if (!c) return
              setDraft(c)
              setPicking(false)
              setSheet('meet')
            }}>Place pin here</button>
          </div>
        </>
      ) : (
        <SwipeDock active={t.active} status={status} onToggle={toggleTracking} onOpen={() => setSheet('details')} />
      )}

      {sheet === 'team' && (
        <TeamSheet profile={profile} team={team} me={t.fix} myUid={myUid} meeting={meeting} onClose={() => setSheet(null)}
          onShow={show} onTrail={setOtherTrail} onDropPin={startPick} />
      )}
      {sheet === 'profile' && <ProfileSheet profile={profile} onClose={() => setSheet(null)} onChanged={onProfileChange} />}
      {sheet === 'meet' && draft && <MeetingForm at={draft} onClose={() => { setSheet(null); setDraft(null) }} onSent={(lat, lng) => show(lat, lng)} />}

      {sheet === 'details' && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>Field Mode</h2>
              <button className="glass-btn sm" onClick={() => setSheet(null)} aria-label="Close"><IconClose /></button>
            </div>
            <div className="stat-row">
              <div><b>{t.fix ? `±${t.fix.accuracy} m` : '–'}</b><span>GPS accuracy</span></div>
              <div><b>{t.fix ? clock(t.fix.at) : '–'}</b><span>Last fix</span></div>
              <div><b>{t.battery != null ? `${t.battery}%` : 'n/a'}</b><span>Battery</span></div>
              <div><b>{t.active ? (t.wakeLock ? 'Awake' : 'May sleep') : '–'}</b><span>Screen</span></div>
            </div>
            <p className="small muted">
              {IS_IOS
                ? 'iPhone: keep SPATREN open with the screen on. Tracking pauses while the phone is locked; your trail fills in when you come back.'
                : 'Keep SPATREN open while walking. Points are saved on your phone when there is no signal and uploaded later.'}
              {IS_IOS && !STANDALONE && ' Add it to your Home Screen (Share → Add to Home Screen) so your data is never cleared.'}
            </p>
            <div className="row">
              <button className="btn btn-primary grow" onClick={() => { setSheet(null); onRecord() }}><IconPlus width={20} /> Collect</button>
              <button className="btn btn-ghost grow" onClick={() => void manualSync()} disabled={!online || syncing}>
                <IconSync width={18} /> {syncing ? 'Uploading…' : pending ? `Upload ${pending}` : 'All uploaded'}
              </button>
            </div>
            <button className={`btn btn-block ${t.active ? 'btn-ghost' : 'btn-lime'}`} onClick={toggleTracking}>
              {t.active ? 'Stop sharing my location' : 'Start Field Mode'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MeetingForm({ at, onClose, onSent }: { at: { lat: number; lng: number }; onClose: () => void; onSent: (lat: number, lng: number) => void }) {
  const [title, setTitle] = useState('Meet here')
  const [note, setNote] = useState('')
  const [time, setTime] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send(e: FormEvent) {
    e.preventDefault()
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
      title: title.trim() || 'Meet here', note: note.trim() || null, lat: at.lat, lng: at.lng, meet_at, target_group: target || null,
    })
    setBusy(false)
    if (error) return setErr(`Could not send: ${navigator.onLine ? error.message : 'you are offline'}`)
    onSent(at.lat, at.lng)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet stack" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="row between">
          <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>Send meeting pin</h2>
          <button type="button" className="glass-btn sm" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <p className="small muted tnum">Pin at {at.lat.toFixed(5)}, {at.lng.toFixed(5)}</p>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Place, e.g. Bus stand" maxLength={120} required />
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} />
        <div className="field">
          <label>Who should come</label>
          <div className="segmented" role="radiogroup">
            {['', ...Object.keys(GROUP_COLORS)].map((g) => (
              <button type="button" key={g || 'all'} role="radio" aria-checked={target === g} aria-pressed={target === g} onClick={() => setTarget(g)}>{g ? g.replace('Group ', 'G') : 'Everyone'}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="mt">Be there by (optional)</label>
          <input id="mt" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {err && <p className="small" style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="btn btn-lime btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send to phones'}</button>
      </form>
    </div>
  )
}

export type { MeetingPoint }
