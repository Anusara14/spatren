import { useEffect, useMemo, useRef, useState } from 'react'
import { mediaLinks, ratingOf, type Experience } from '../lib/experience'
import { ago, clock, freshness, groupColor, mapsLink } from '../lib/geo'
import { avatarUrl, nameOf } from '../lib/supabase'
import type { Mate } from '../lib/team'
import { IconClose, IconSearch } from './icons'
import { matchesPerson } from '../lib/people'

interface FindProps {
  mates: Mate[]
  onPick: (m: Mate) => void
  onClose: () => void
}

/** Search people on the map; picking one flies the map to them. Students search their group, admins the batch. */
export function FindPanel({ mates, onPick, onClose }: FindProps) {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const hits = useMemo(() => (q.trim() ? mates.filter((m) => matchesPerson(m, q)).slice(0, 30) : []), [mates, q])

  return (
    <div className="find-panel glass" role="dialog" aria-label="Find someone on the map">
      <div className="find-bar">
        <IconSearch width={18} height={18} aria-hidden="true" />
        <input
          ref={input}
          className="find-input"
          type="search"
          inputMode="search"
          aria-label="Name or index number"
          placeholder="First name, last name or index"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) onPick(hits[0])
            if (e.key === 'Escape') onClose()
          }}
        />
        <button className="glass-btn sm" aria-label="Close search" onClick={onClose}><IconClose width={16} height={16} /></button>
      </div>
      {q.trim() && (
        <div className="find-results" role="listbox">
          {hits.length === 0 && <p className="small muted find-empty">No one in {mates.length ? 'your list' : 'the team yet'} matches “{q.trim()}”.</p>}
          {hits.map((m) => {
            const f = freshness(m)
            const url = avatarUrl(m.avatar)
            return (
              <button key={m.user_id} role="option" aria-selected="false" className="find-row" onClick={() => onPick(m)}>
                <span className="avatar-sm" style={{ width: 34, height: 34, background: groupColor(m.grp) }}>
                  {url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : nameOf(m).slice(0, 2).toUpperCase()}
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b>{nameOf(m)}</b> {m.is_leader && <span className="role-tag">Leader</span>}
                  <span className="small muted find-sub">{m.full_name} · {m.index_no}{m.grp ? ` · ${m.grp}` : ''}</span>
                </span>
                <span className="small muted tnum">{m.lat == null ? 'No location' : f === 'live' ? 'Live' : ago(m.recorded_at)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** One experience pin: rating, place, note, photos and voice note, who and when. */
export function ExperienceSheet({ x, onClose }: { x: Experience; onClose: () => void }) {
  const [links, setLinks] = useState<{ url: string; type: string }[] | null>(null)
  useEffect(() => {
    let alive = true
    void mediaLinks(x.media).then((l) => alive && setLinks(l)).catch(() => alive && setLinks([]))
    return () => {
      alive = false
    }
  }, [x])
  const r = ratingOf(x.rating)
  const photos = links?.filter((l) => l.type.startsWith('image')) ?? []
  const voice = links?.find((l) => l.type.startsWith('audio'))
  const pending = x.media.some((m) => m.path.startsWith('device://'))

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Experience">
        <div className="row between">
          <span className="exp-badge" style={{ ['--r' as string]: r?.color ?? '#9AA5B1' }}>{r ? `${r.emoji} ${r.label}` : 'No rating'}</span>
          <button className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>
        <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{x.title || 'An experience'}</h2>
        <p className="small muted">{x.author ?? 'A classmate'}{x.grp ? ` · ${x.grp}` : ''}{x.subgroup ? ` ${x.subgroup}` : ''} · {clock(x.recorded_at)} ({ago(x.recorded_at)})</p>
        {x.notes && <p>{x.notes}</p>}
        {links === null && x.media.length > 0 && <p className="small muted">Loading photos…</p>}
        {photos.length > 0 && (
          <div className="exp-photos">
            {photos.map((p) => <img key={p.url} src={p.url} alt={x.title ? `Photo at ${x.title}` : 'Photo'} loading="lazy" />)}
          </div>
        )}
        {voice && <audio controls preload="none" src={voice.url} style={{ width: '100%' }} />}
        {pending && <p className="tiny muted">Some files are still on the student's phone.</p>}
        {x.lat != null && <a className="btn btn-ghost btn-block" href={mapsLink(x.lat, x.lng!)} target="_blank" rel="noreferrer">Directions</a>}
      </div>
    </div>
  )
}
