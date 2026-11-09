import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { ago, clock, distanceMeters, formatDistance, groupColor, mapsLink } from '../lib/geo'
import { askNotificationPermission, useMeetingPoints, type MeetingPoint } from '../lib/meeting'
import type { Profile } from '../lib/supabase'
import { syncNow, useOnline, useOutbox } from '../lib/sync'
import { startTracking, stopTracking, useTracker } from '../lib/tracking'
import { IconChevrons, IconClose, IconPlus, IconSync, IconWalk } from './icons'
import MapView from './MapView'
import Sos from './Sos'

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
const STANDALONE = window.matchMedia('(display-mode: standalone)').matches

interface FieldProps {
  profile: Profile
  onRecord: () => void
}

export default function Field({ profile, onRecord }: FieldProps) {
  const t = useTracker()
  const online = useOnline()
  const outbox = useOutbox()
  const [trail, setTrail] = useState<[number, number][]>([])
  const [sheet, setSheet] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [, tick] = useState(0)
  const meeting = useMeetingPoints(profile.grp, profile.is_admin)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [mpFocus, setMpFocus] = useState<{ lat: number; lng: number; zoom?: number; key: string } | null>(null)
  const banner = meeting.find((m) => !dismissed.includes(m.id)) ?? null

  useEffect(() => {
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

  // Recentre once when a first fix arrives, not on every fix.
  const hasFix = !!t.fix
  const meFocus = useMemo(
    () => (t.fix ? { lat: t.fix.lat, lng: t.fix.lng, zoom: 16.4, key: 'me' } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasFix],
  )
  const focus = mpFocus ?? meFocus
  const showMeeting = (m: MeetingPoint) => setMpFocus({ lat: m.lat, lng: m.lng, zoom: 17, key: m.id + Date.now() })


  const pending = outbox.points + outbox.sos + outbox.records
  const status = t.active
    ? t.fix
      ? `Sharing · ±${t.fix.accuracy} m · ${ago(t.fix.at)}`
      : 'Finding GPS…'
    : 'Field Mode off'

  async function manualSync() {
    setSyncing(true)
    await syncNow()
    setSyncing(false)
  }

  return (
    <div className="immersive">
      <MapView me={t.fix} trail={trail} focus={focus} meetingPoints={meeting} onMeetingClick={(m) => { setDismissed((d) => d.filter((x) => x !== m.id)); showMeeting(m) }} controlsBottom="calc(176px + var(--safe-b))" />

      <header className="title-overlay">
        <h1>Anuradhapura</h1>
        <p>{profile.full_name?.split(' ')[0]} · {profile.elective}</p>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <span className="chip glass-chip"><span className="dot" style={{ background: groupColor(profile.grp) }} />{profile.grp} · {profile.subgroup}</span>
          {!online && <span className="chip glass-chip"><span className="dot offline" />Offline</span>}
          {pending > 0 && <span className="chip glass-chip">{pending} waiting to upload</span>}
        </div>
      </header>

      <div className="top-right">
        <Sos name={profile.full_name ?? profile.index_no ?? 'student'} variant="fab" />
      </div>

      {banner && (
        <div className="meet-banner" role="alert">
          <span className="meet-flag" aria-hidden="true" />
          <div className="grow">
            <b>Gather: {banner.title}</b>
            <p>
              {t.fix ? `${formatDistance(distanceMeters(t.fix, banner))} away` : 'Location pinned'}
              {banner.meet_at ? ` · by ${clock(banner.meet_at)}` : ''}
              {banner.note ? ` · ${banner.note}` : ''}
            </p>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn btn-sm btn-lime" onClick={() => showMeeting(banner)}>Show</button>
              <a className="btn btn-sm btn-ghost" href={mapsLink(banner.lat, banner.lng)} target="_blank" rel="noreferrer">Directions</a>
              <button className="btn btn-sm btn-ghost" onClick={() => setDismissed((d) => [...d, banner.id])}>OK</button>
            </div>
          </div>
        </div>
      )}

      {t.error && <p className="map-toast">{t.error}</p>}

      <div className="dock">
        <button
          className={`dock-main ${t.active ? 'on' : ''}`}
          onClick={() => {
            if (!t.active) void askNotificationPermission() // so meeting calls can reach a backgrounded phone
            void (t.active ? stopTracking() : startTracking())
          }}
          aria-pressed={t.active}
          aria-label={t.active ? 'Stop Field Mode' : 'Start Field Mode'}
        >
          <IconWalk width={30} height={30} />
        </button>
        <button className="dock-pill" onClick={() => setSheet(true)} aria-label="Field Mode details">
          <span className="dock-text">
            <b>{t.active ? 'Field Mode on' : 'Start Field Mode'}</b>
            <span>{t.active ? status : 'Share your location'}</span>
          </span>
          <IconChevrons width={22} height={22} className="dock-chev" />
        </button>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{profile.full_name}</h2>
              <button className="glass-btn sm" onClick={() => setSheet(false)} aria-label="Close"><IconClose /></button>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="chip" style={{ background: groupColor(profile.grp), color: 'var(--navy)' }}>{profile.grp}</span>
              <span className="chip">{profile.subgroup}</span>
              <span className="chip">{profile.elective}</span>
              <span className="chip mono">{profile.index_no}</span>
            </div>
            <div className="stat-row">
              <div><b>{t.fix ? `±${t.fix.accuracy} m` : '–'}</b><span>GPS accuracy</span></div>
              <div><b>{t.fix ? clock(t.fix.at) : '–'}</b><span>Last fix</span></div>
              <div>
                <b>{t.battery != null ? `${t.battery}%` : 'n/a'}</b>
                <span>Battery</span>
              </div>
              <div><b>{t.active ? (t.wakeLock ? 'Awake' : 'May sleep') : '–'}</b><span>Screen</span></div>
            </div>
            <p className="small muted">
              {IS_IOS
                ? 'iPhone: keep SPATREN open with the screen on. Tracking pauses while the phone is locked; your trail fills in when you come back.'
                : 'Keep SPATREN open while walking. Points are saved on your phone when there is no signal and uploaded later.'}
              {IS_IOS && !STANDALONE && ' Add it to your Home Screen (Share → Add to Home Screen) so your data is never cleared.'}
            </p>
            <div className="row">
              <button className="btn btn-primary grow" onClick={() => { setSheet(false); onRecord() }}><IconPlus width={20} /> New record</button>
              <button className="btn btn-ghost grow" onClick={() => void manualSync()} disabled={!online || syncing}>
                <IconSync width={18} /> {syncing ? 'Uploading…' : pending ? `Upload ${pending}` : 'All uploaded'}
              </button>
            </div>
            <button className={`btn btn-block ${t.active ? 'btn-ghost' : 'btn-lime'}`} onClick={() => void (t.active ? stopTracking() : startTracking())}>
              {t.active ? 'Stop sharing my location' : 'Start Field Mode'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
