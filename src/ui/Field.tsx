import { liveQuery } from 'dexie'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { db } from '../lib/db'
import { ago, clock, distanceMeters, formatDistance, freshness, groupColor, groupsOf, mapsLink, regionFor } from '../lib/geo'
import { ratingCounts, ratingOf, useExperiences, type Experience, type ExperienceRange } from '../lib/experience'
import { askNotificationPermission, useMeetingPoints, type MeetingPoint } from '../lib/meeting'
import { avatarUrl, nameOf, supabase, type Profile } from '../lib/supabase'
import { syncNow, useOnline, useOutbox } from '../lib/sync'
import { useTeam, type Mate } from '../lib/team'
import { startTracking, stopTracking, useTracker } from '../lib/tracking'
import { IconClose, IconFlag, IconPlus, IconSearch, IconSmile, IconSync, IconUsers } from './icons'
import { ExperienceSheet, FindPanel } from './MapTools'
import { lazy, Suspense } from 'react'
import type { MapMarker } from './MapView'
import InstallHint from './InstallHint'
import ProfileSheet from './ProfileSheet'
import Sos from './Sos'
import SwipeDock from './SwipeDock'
import TeamSheet from './TeamSheet'

const MapView = lazy(() => import('./MapView'))
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
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
  const [finding, setFinding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expOn, setExpOn] = useState(false)
  const [expRange, setExpRange] = useState<ExperienceRange>('today')
  const [expSel, setExpSel] = useState<Experience | null>(null)
  const exps = useExperiences(expOn, expRange)
  const region = useMemo(() => regionFor(profile.batch_place), [profile.batch_place])
  const canPin = profile.is_admin || (!!profile.is_leader && !!profile.grp)
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

  const people: MapMarker[] = team.mates
    .filter((m) => m.user_id !== myUid && m.lat != null && m.lng != null)
    .map((m) => ({
      id: m.user_id,
      lat: m.lat!,
      lng: m.lng!,
      color: groupColor(m.grp),
      label: initials(nameOf(m)),
      name: nameOf(m),
      avatar: avatarUrl(m.avatar),
      className: `${freshness(m)} ${sosUsers.has(m.user_id) ? 'mk-sos' : ''} ${m.is_leader ? 'mk-leader' : ''}`,
      title: `${nameOf(m)}${m.is_leader ? ' (leader)' : ''} · ${[m.grp, m.subgroup].filter(Boolean).join(' ')} · ${ago(m.recorded_at)}`,
    }))
  // Experience pins: coloured by rating, prefixed ids so a tap opens the experience instead of the team.
  const expMarkers: MapMarker[] = expOn
    ? exps.items.filter((x) => x.lat != null && x.lng != null).map((x) => {
        const r = ratingOf(x.rating)
        return { id: `exp:${x.id}`, lat: x.lat!, lng: x.lng!, color: r?.color ?? '#9AA5B1', label: r?.emoji ?? '•', className: 'mk-exp', title: `${r?.label ?? 'Experience'} · ${x.title ?? ''} · ${x.author ?? ''}` }
      })
    : []
  const markers = [...people, ...expMarkers]

  function findPerson(m: Mate) {
    setFinding(false)
    if (m.lat == null || m.lng == null) return setNotice(`${nameOf(m)} hasn't shared a location yet.`)
    setSelectedId(m.user_id)
    setFocus({ lat: m.lat, lng: m.lng, zoom: 18, key: `find-${m.user_id}-${Date.now()}` })
    setNotice(`${nameOf(m)} · ${freshness(m) === 'live' ? 'live now' : `last seen ${ago(m.recorded_at)}`}`)
  }
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

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
      <Suspense fallback={<div className="map map-loading" />}>
      <MapView
        me={t.fix}
        markers={markers}
        selectedId={selectedId}
        region={region}
        onSelect={(id) => {
          if (id.startsWith('exp:')) return setExpSel(exps.items.find((x) => `exp:${x.id}` === id) ?? null)
          setSelectedId(id)
          setSheet('team')
        }}
        trail={otherTrail ?? trail}
        focus={focus}
        meetingPoints={meeting}
        onMeetingClick={(m) => { setDismissed((d) => d.filter((x) => x !== m.id)); show(m.lat, m.lng) }}
        onCenter={picking ? (c) => { pickCenter.current = c } : null}
        controlsBottom="calc(178px + var(--tab-b))"
        topControl={
          <>
            <Sos name={`${nameOf(profile)} (${profile.index_no ?? ''})`} variant="fab" />
            {canPin && !picking && (
              <button className="glass-btn pin-btn" aria-label={profile.is_admin ? 'Drop a meeting pin' : 'Call my group to a meeting pin'} title="Drop a meeting pin" onClick={startPick}>
                <IconFlag />
              </button>
            )}
          </>
        }
      />
      </Suspense>

      <header className="title-overlay">
        <h1>{profile.batch_place || 'Field visit'}</h1>
        <p>Hi {nameOf(profile)} · {profile.is_admin ? 'Coordinator' : profile.is_leader ? `${profile.grp ?? 'Group'} leader` : profile.subgroup ?? profile.grp ?? ''}</p>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="chip glass-chip chip-btn" onClick={() => setSheet('team')}>
            <IconUsers width={15} height={15} />
            {profile.is_admin ? 'Team' : profile.grp ?? 'My group'} · {liveMates} live
          </button>
          <button className="chip glass-chip chip-btn" aria-label="Find someone on the map" onClick={() => setFinding(true)}>
            <IconSearch width={15} height={15} /> Find
          </button>
          <button className={`chip glass-chip chip-btn ${expOn ? 'chip-on' : ''}`} aria-pressed={expOn} onClick={() => setExpOn((v) => !v)}>
            <IconSmile width={15} height={15} /> Experiences{expOn ? ` · ${exps.items.length}` : ''}
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
              {alertWho ? [alertWho.grp, alertWho.subgroup].filter(Boolean).map((x) => `${x} · `).join('') : ''}sent {clock(openAlert.created_at)} ({ago(openAlert.created_at)})
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

      {finding && <FindPanel mates={team.mates.filter((m) => m.user_id !== myUid)} onPick={findPerson} onClose={() => setFinding(false)} />}

      {expOn && !picking && (
        <div className="exp-legend glass" role="group" aria-label="Experience map">
          <div className="exp-range segmented">
            {([['today', 'Today'], ['3days', '3 days'], ['all', 'All']] as [ExperienceRange, string][]).map(([v, label]) => (
              <button key={v} aria-pressed={expRange === v} onClick={() => setExpRange(v)}>{label}</button>
            ))}
          </div>
          <div className="exp-counts">
            {ratingCounts(exps.items).map(({ rating, count }) => (
              <span key={rating.value} title={rating.label} style={{ ['--r' as string]: rating.color }}><i aria-hidden="true">{rating.emoji}</i>{count}</span>
            ))}
          </div>
          {exps.error && <p className="tiny" style={{ color: 'var(--danger)' }}>{exps.error}</p>}
          {!exps.error && !exps.items.length && <p className="tiny muted">No experiences yet. Share one from Collect, Share an experience.</p>}
        </div>
      )}

      {notice && <p className="map-toast" role="status">{notice}</p>}
      {t.error && !picking && !notice && <p className="map-toast">{t.error}</p>}
      {!picking && !openAlert && !banner && <div className="install-float"><InstallHint /></div>}

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
      {sheet === 'meet' && draft && (
        <MeetingForm at={draft} groups={profile.is_admin ? groupsOf(team.mates) : null} myGroup={profile.grp}
          onClose={() => { setSheet(null); setDraft(null) }} onSent={(lat, lng) => show(lat, lng)} />
      )}
      {expSel && <ExperienceSheet x={expSel} onClose={() => setExpSel(null)} />}

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

interface MeetingFormProps {
  at: { lat: number; lng: number }
  /** admins pick who to call (null for a group leader, who always calls their own group) */
  groups: string[] | null
  myGroup: string | null
  onClose: () => void
  onSent: (lat: number, lng: number) => void
}

function MeetingForm({ at, groups, myGroup, onClose, onSent }: MeetingFormProps) {
  const [title, setTitle] = useState('Meet here')
  const [note, setNote] = useState('')
  const [time, setTime] = useState('')
  const [target, setTarget] = useState(groups ? '' : myGroup ?? '')
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
          {groups ? (
            <div className="segmented seg-scroll" role="radiogroup">
              {['', ...groups].map((g) => (
                <button type="button" key={g || 'all'} role="radio" aria-checked={target === g} aria-pressed={target === g} onClick={() => setTarget(g)}>{g ? g.replace(/^Group\s*/i, 'G') : 'Everyone'}</button>
              ))}
            </div>
          ) : (
            <p className="small">Your group · {myGroup ?? 'no group'}</p>
          )}
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
