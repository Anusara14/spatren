import { useCallback, useEffect, useMemo, useState } from 'react'
import { clock, groupColor } from '../lib/geo'
import { nameOf, supabase, type RecordRow, type SosRow, type TeamRow } from '../lib/supabase'
import { csvCell, download } from './export'
import WordCloud from './WordCloud'

interface Activity {
  user_id: string
  points: number
  first_at: string
  last_at: string
}

const dayBounds = (day: string): [string, string] => {
  const from = new Date(`${day}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return [from.toISOString(), to.toISOString()]
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function Summary() {
  const [day, setDay] = useState(localDay())
  const [team, setTeam] = useState<TeamRow[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [sos, setSos] = useState<SosRow[]>([])
  const [photos, setPhotos] = useState<{ url: string; rec: RecordRow }[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [from, to] = dayBounds(day)
    const [t, r, a, s] = await Promise.all([
      supabase.from('team_status').select('*'),
      supabase.from('records').select('*').gte('recorded_at', from).lt('recorded_at', to).order('recorded_at'),
      supabase.rpc('activity_between', { p_from: from, p_to: to }),
      supabase.from('sos_alerts').select('*').gte('created_at', from).lt('created_at', to),
    ])
    const recs = (r.data ?? []) as RecordRow[]
    setTeam((t.data ?? []) as TeamRow[])
    setRecords(recs)
    setActivity((a.data ?? []) as Activity[])
    setSos((s.data ?? []) as SosRow[])
    setLoading(false)

    const imgs = recs.flatMap((rec) => rec.media.filter((m) => m.type.startsWith('image')).map((m) => ({ path: m.path, rec }))).slice(-12).reverse()
    if (imgs.length) {
      const { data } = await supabase.storage.from('media').createSignedUrls(imgs.map((i) => i.path), 3600)
      setPhotos((data ?? []).flatMap((d, i) => (d.signedUrl ? [{ url: d.signedUrl, rec: imgs[i].rec }] : [])))
    } else setPhotos([])
  }, [day])

  useEffect(() => void load(), [load])

  const userGroup = useMemo(() => new Map(team.filter((r) => r.user_id).map((r) => [r.user_id!, r])), [team])
  const groups = useMemo(() => [...new Set(team.map((r) => r.grp))].sort(), [team])

  const stats = useMemo(() => {
    const media = records.flatMap((r) => r.media)
    return {
      active: activity.length,
      records: records.length,
      interviews: records.filter((r) => r.kind === 'interview').length,
      photos: media.filter((m) => m.type.startsWith('image')).length,
      audio: media.filter((m) => m.type.startsWith('audio')).length,
      sos: sos.length,
    }
  }, [records, activity, sos])

  const byGroup = groups.map((g) => {
    const members = team.filter((r) => r.grp === g)
    const ids = new Set(members.map((m) => m.user_id).filter(Boolean))
    return {
      g,
      total: members.length,
      active: activity.filter((a) => ids.has(a.user_id)).length,
      records: records.filter((r) => ids.has(r.user_id)).length,
    }
  })
  const byCategory = countBy(records.map((r) => r.category || r.kind))
  const bySubgroup = countBy(records.map((r) => userGroup.get(r.user_id)?.subgroup ?? 'Unknown'))
  const hours = Array.from({ length: 24 }, (_, h) => records.filter((r) => new Date(r.recorded_at).getHours() === h).length)
  const firstHour = Math.max(0, hours.findIndex((n) => n > 0) - 1)
  const lastHour = Math.min(23, 23 - [...hours].reverse().findIndex((n) => n > 0) + 1)
  const shownHours = records.length ? hours.slice(firstHour, lastHour + 1) : hours.slice(7, 19)
  const hourStart = records.length ? firstHour : 7
  const maxHour = Math.max(1, ...shownHours)
  const text = records.map((r) => `${r.title ?? ''} ${r.notes ?? ''}`).join(' ')

  function exportCsv() {
    const head = ['id', 'recorded_at', 'kind', 'category', 'title', 'notes', 'lat', 'lng', 'accuracy', 'index_no', 'name', 'nickname', 'group', 'subgroup', 'elective', 'media']
    const lines = records.map((r) => {
      const who = userGroup.get(r.user_id)
      return [r.id, r.recorded_at, r.kind, r.category, r.title, r.notes, r.lat, r.lng, r.accuracy, who?.index_no, who?.full_name, who?.nickname, who?.grp, who?.subgroup, who?.elective, r.media.map((m) => m.path).join(' | ')]
        .map(csvCell)
        .join(',')
    })
    download(`spatren-records-${day}.csv`, '﻿' + [head.join(','), ...lines].join('\n'), 'text/csv')
  }

  function exportGeoJson() {
    const fc = {
      type: 'FeatureCollection',
      features: records
        .filter((r) => r.lat != null)
        .map((r) => {
          const who = userGroup.get(r.user_id)
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
            properties: { id: r.id, recorded_at: r.recorded_at, kind: r.kind, category: r.category, title: r.title, notes: r.notes, accuracy: r.accuracy, group: who?.grp, subgroup: who?.subgroup, elective: who?.elective, index_no: who?.index_no, media: r.media.length },
          }
        }),
    }
    download(`spatren-records-${day}.geojson`, JSON.stringify(fc), 'application/geo+json')
  }

  async function exportTracks() {
    const [from, to] = dayBounds(day)
    const rows: { user_id: string; lat: number; lng: number; accuracy: number; battery: number | null; recorded_at: string }[] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('locations').select('user_id,lat,lng,accuracy,battery,recorded_at').gte('recorded_at', from).lt('recorded_at', to).order('recorded_at').range(page * 1000, page * 1000 + 999)
      rows.push(...((data ?? []) as typeof rows))
      if (!data || data.length < 1000) break
    }
    const lines = rows.map((p) => {
      const who = userGroup.get(p.user_id)
      return [p.recorded_at, who?.index_no, who?.grp, who?.subgroup, p.lat, p.lng, p.accuracy, p.battery].map(csvCell).join(',')
    })
    download(`spatren-tracks-${day}.csv`, ['recorded_at,index_no,group,subgroup,lat,lng,accuracy,battery', ...lines].join('\n'), 'text/csv')
  }

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 1100, margin: '0 auto' }}>
      <header className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28, letterSpacing: '-0.03em' }}>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
        </div>
        <div className="row">
          <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} style={{ minHeight: 44, padding: '8px 12px' }} />
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>{loading ? '…' : 'Refresh'}</button>
        </div>
      </header>

      <div className="kpi-grid">
        <Kpi value={`${stats.active}/${team.length}`} label="Students in the field" />
        <Kpi value={stats.records} label="Records collected" />
        <Kpi value={stats.interviews} label="Interviews" />
        <Kpi value={`${stats.photos} · ${stats.audio}`} label="Photos · audio clips" />
      </div>
      {stats.sos > 0 && <p className="card-flat" style={{ background: 'var(--danger-wash)', color: 'var(--danger)' }}><b>{stats.sos} SOS alert{stats.sos > 1 ? 's' : ''}</b> today: {sos.map((s) => `${nameOf(userGroup.get(s.user_id))} at ${clock(s.created_at)} (${s.status})`).join('; ')}</p>}

      <div className="grid-2">
        <section className="card stack">
          <h2 style={{ fontSize: 17 }}>Groups</h2>
          {byGroup.map((g) => (
            <div key={g.g} className="stack" style={{ gap: 6 }}>
              <div className="row between small">
                <span className="row" style={{ gap: 6, fontWeight: 600 }}><span className="dot" style={{ background: groupColor(g.g) }} />{g.g}</span>
                <span className="muted">{g.active}/{g.total} active · {g.records} records</span>
              </div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(g.active / Math.max(1, g.total)) * 100}%`, background: groupColor(g.g) }} /></div>
            </div>
          ))}
        </section>

        <section className="card stack">
          <h2 style={{ fontSize: 17 }}>Activity by hour</h2>
          <div className="hours">
            {shownHours.map((n, i) => <div key={i} title={`${hourStart + i}:00 · ${n} records`} style={{ height: `${(n / maxHour) * 100}%` }} />)}
          </div>
          <div className="row between small muted"><span>{hourStart}:00</span><span>{hourStart + shownHours.length - 1}:00</span></div>
        </section>

        <section className="card stack">
          <h2 style={{ fontSize: 17 }}>What was recorded</h2>
          <Bars data={byCategory} />
        </section>

        <section className="card stack">
          <h2 style={{ fontSize: 17 }}>By research theme</h2>
          <Bars data={bySubgroup} />
        </section>
      </div>

      <section className="card stack">
        <div className="row between">
          <h2 style={{ fontSize: 17 }}>Words from today's notes</h2>
          <span className="small muted">titles + notes · Sinhala/Tamil words included as typed</span>
        </div>
        <WordCloud text={text} />
      </section>

      {photos.length > 0 && (
        <section className="card stack">
          <h2 style={{ fontSize: 17 }}>Latest photos</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {photos.map((p) => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer" title={p.rec.title || p.rec.category || ''}>
                <img src={p.url} alt={p.rec.title || p.rec.category || 'field photo'} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 12 }} loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="card stack">
        <h2 style={{ fontSize: 17 }}>Export</h2>
        <p className="small muted">GeoJSON opens directly in QGIS. CSV opens in Excel (UTF-8, Sinhala/Tamil safe).</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={exportCsv} disabled={!records.length}>Records CSV</button>
          <button className="btn btn-lime btn-sm" onClick={exportGeoJson} disabled={!records.length}>Records GeoJSON</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void exportTracks()}>GPS tracks CSV</button>
        </div>
      </section>
    </div>
  )
}

function Kpi({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="kpi-card">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Bars({ data }: { data: [string, number][] }) {
  if (!data.length) return <p className="muted small">No records for this day yet.</p>
  const max = data[0][1]
  return (
    <div className="bars">
      {data.slice(0, 10).map(([k, n]) => (
        <div className="bar" key={k}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></div>
          <b style={{ textAlign: 'right' }}>{n}</b>
        </div>
      ))}
    </div>
  )
}

function countBy(xs: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])
}
