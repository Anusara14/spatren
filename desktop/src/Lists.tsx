import { save } from '@tauri-apps/plugin-dialog'
import { useMemo, useState } from 'react'
import * as api from './lib/api'
import { qualityIssues, quotes, search, type Code, type Hit, type Transcripts } from './lib/analysis'
import { clock, rowsCsv, speakerName, titleOf, who, type Item } from './lib/model'

type Open = (item: Item, ms?: number) => void

function HitRow({ hit, onOpen, codes, query }: { hit: Hit; onOpen: Open; codes?: Map<string, Code>; query?: string }) {
  const { item, seg } = hit
  return (
    <button className="d-hit" onClick={() => onOpen(item, seg.start)}>
      <span className="tiny muted">
        {titleOf(item.record)} · {who(item.collector)} · {item.collector.subgroup ?? item.collector.group ?? ''} · {clock(seg.start)}
        {seg.speaker ? ` · ${speakerName(seg.speaker)}` : ''}
      </span>
      <span className="d-hit-text">{query ? highlight(seg.text, query) : seg.text}</span>
      {seg.en && <span className="d-en">{query ? highlight(seg.en, query) : seg.en}</span>}
      {codes && (seg.codes?.length ?? 0) > 0 && (
        <span className="d-codes">
          {seg.codes!.map((id) => <span key={id} className="d-code static" style={{ borderColor: codes.get(id)?.color }}>{codes.get(id)?.name ?? 'Deleted code'}</span>)}
        </span>
      )}
    </button>
  )
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0 || !q.trim()) return text
  const n = q.trim().length
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>
}

export function SearchView({ items, ts, onOpen }: { items: Item[]; ts: Transcripts; onOpen: Open }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => search(items, ts, q), [items, ts, q])
  return (
    <div className="d-view">
      <header className="stack" style={{ gap: 8 }}>
        <h1>Search transcripts</h1>
        <input className="input" type="search" autoFocus placeholder="Type a Sinhala or English word, e.g. වැව or tank" value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim() && <p className="tiny muted">{hits.length >= 300 ? 'First 300 matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`} · click one to hear it</p>}
      </header>
      <div className="d-hits">{hits.map((h) => <HitRow key={`${h.item.key}-${h.index}`} hit={h} onOpen={onOpen} query={q} />)}</div>
    </div>
  )
}

export function QuotesView({ items, ts, codes, onOpen, onStatus }: { items: Item[]; ts: Transcripts; codes: Code[]; onOpen: Open; onStatus: (t: string, e?: boolean) => void }) {
  const all = useMemo(() => quotes(items, ts), [items, ts])
  const byId = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes])
  async function exportCsv() {
    const path = await save({ defaultPath: 'spatren-quotes.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!path) return
    const csv = rowsCsv(
      ['quote', 'english', 'speaker', 'codes', 'topic', 'collector', 'index_no', 'group', 'subgroup', 'recorded_at', 'time', 'lat', 'lng'],
      all.map(({ item, seg }) => [seg.text, seg.en ?? '', speakerName(seg.speaker), (seg.codes ?? []).map((id) => byId.get(id)?.name ?? id).join('; '), titleOf(item.record),
        who(item.collector), item.collector.index_no, item.collector.group, item.collector.subgroup, item.record.recorded_at, clock(seg.start), item.record.location?.lat, item.record.location?.lng]),
    )
    await api.saveText(path, csv)
    onStatus(`Saved ${all.length} quotes to ${path}`)
  }
  return (
    <div className="d-view">
      <header className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Quote bank</h1>
          <p className="small muted">Lines starred (★) in any transcript. Use them in reports with the speaker, place and time.</p>
        </div>
        <button className="btn btn-ghost btn-sm" disabled={!all.length} onClick={() => void exportCsv()}>Export CSV</button>
      </header>
      {!all.length && <div className="d-empty">No quotes yet. Open a transcript and press ★ next to a strong line.</div>}
      <div className="d-hits">{all.map((h) => <HitRow key={`${h.item.key}-${h.index}`} hit={h} onOpen={onOpen} codes={byId} />)}</div>
    </div>
  )
}

export function QualityView({ items, ts, onOpen }: { items: Item[]; ts: Transcripts; onOpen: Open }) {
  const issues = useMemo(() => qualityIssues(items, ts), [items, ts])
  const fixes = issues.filter((i) => i.severity === 'fix').length
  return (
    <div className="d-view">
      <header className="stack" style={{ gap: 4 }}>
        <h1>Data quality</h1>
        <p className="small muted">
          Sort these out while you're still in the field: a missing consent or a 30-second recording can still be redone today.
          {issues.length ? ` ${fixes} to fix, ${issues.length - fixes} to check.` : ''}
        </p>
      </header>
      {!items.length && <div className="d-empty">Import recordings to check them.</div>}
      {items.length > 0 && !issues.length && <div className="d-empty">No problems found.</div>}
      <div className="d-hits">
        {issues.map((i, n) => (
          <button key={n} className="d-hit" onClick={() => onOpen(i.item)}>
            <span className={`chip ${i.severity === 'fix' ? 'chip-warn' : ''}`}>{i.severity === 'fix' ? 'Fix' : 'Check'}</span>
            <span className="d-hit-text">{i.text}</span>
            <span className="tiny muted">{titleOf(i.item.record)} · {who(i.item.collector)} · {new Date(i.item.record.recorded_at).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
