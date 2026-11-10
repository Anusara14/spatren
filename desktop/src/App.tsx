import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './lib/api'
import { itemsOf, segmentsCsv, titleOf, who, type Item, type Package, type Transcript } from './lib/model'
import InterviewView from './InterviewView'
import Settings from './Settings'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string } | { kind: 'ok'; text: string }

export default function App() {
  const [packages, setPackages] = useState<Package[]>([])
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [showSettings, setShowSettings] = useState(false)
  const [queue, setQueue] = useState<{ done: number; total: number } | null>(null)

  const items = useMemo(() => itemsOf(packages), [packages])
  const groups = useMemo(() => ['All', ...new Set(items.map((i) => i.collector.group ?? 'No group'))], [items])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (i) =>
        (group === 'All' || (i.collector.group ?? 'No group') === group) &&
        (!q || `${titleOf(i.record)} ${who(i.collector)} ${i.collector.index_no ?? ''} ${i.record.notes ?? ''}`.toLowerCase().includes(q)),
    )
  }, [items, query, group])
  const current = items.find((i) => i.key === selected) ?? null

  const reload = useCallback(async () => {
    const pk = await api.listPackages()
    setPackages(pk)
    const all = itemsOf(pk)
    const loaded = await Promise.all(all.map(async (i) => [i.key, await api.readTranscript(i.pkg, i.record.record_id).catch(() => null)] as const))
    setTranscripts(Object.fromEntries(loaded.filter(([, t]) => t)) as Record<string, Transcript>)
  }, [])

  useEffect(() => void reload().catch((e) => setStatus({ kind: 'error', text: String(e) })), [reload])

  const importPaths = useCallback(
    async (paths: string[]) => {
      const zips = paths.filter((p) => p.toLowerCase().endsWith('.zip'))
      if (!zips.length) return setStatus({ kind: 'error', text: 'Drop the .zip files sent from the phones (Send recordings).' })
      let ok = 0
      const failed: string[] = []
      for (const [n, p] of zips.entries()) {
        setStatus({ kind: 'busy', text: `Importing ${n + 1} of ${zips.length}…` })
        try {
          await api.importZip(p)
          ok++
        } catch (e) {
          failed.push(`${p.split(/[\\/]/).pop()}: ${String(e)}`)
        }
      }
      await reload()
      setStatus(failed.length ? { kind: 'error', text: `Imported ${ok}. Failed: ${failed.join('; ')}` } : { kind: 'ok', text: `Imported ${ok} file${ok === 1 ? '' : 's'}.` })
    },
    [reload],
  )

  // Drag ZIPs onto the window from Downloads / LocalSend's folder.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') void importPaths(e.payload.paths)
    })
    return () => void un.then((f) => f())
  }, [importPaths])

  async function pickZips() {
    const picked = await open({ multiple: true, filters: [{ name: 'SPATREN recordings', extensions: ['zip'] }] })
    if (picked) await importPaths(Array.isArray(picked) ? picked : [picked])
  }

  const onTranscript = (item: Item, t: Transcript) => {
    setTranscripts((m) => ({ ...m, [item.key]: t }))
    void api.writeTranscript(item.pkg, item.record.record_id, t).catch((e) => setStatus({ kind: 'error', text: `Could not save: ${String(e)}` }))
  }

  async function transcribeAll(run: (item: Item) => Promise<Transcript>) {
    const todo = items.filter((i) => !transcripts[i.key])
    if (!todo.length) return setStatus({ kind: 'ok', text: 'Everything is already transcribed.' })
    setQueue({ done: 0, total: todo.length })
    let failed = 0
    for (const [n, item] of todo.entries()) {
      setSelected(item.key)
      try {
        onTranscript(item, await run(item))
      } catch {
        failed++
      }
      setQueue({ done: n + 1, total: todo.length })
    }
    setQueue(null)
    setStatus(failed ? { kind: 'error', text: `${failed} recording${failed === 1 ? '' : 's'} could not be transcribed. Open one to see why.` } : { kind: 'ok', text: 'All recordings transcribed.' })
  }

  async function exportCsv() {
    const rows = items.filter((i) => transcripts[i.key]).map((item) => ({ item, t: transcripts[item.key] }))
    if (!rows.length) return setStatus({ kind: 'error', text: 'Nothing transcribed yet.' })
    const path = await save({ defaultPath: 'spatren-transcripts.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!path) return
    await api.saveText(path, segmentsCsv(rows))
    setStatus({ kind: 'ok', text: `Saved ${rows.length} transcripts to ${path}` })
  }

  const done = items.filter((i) => transcripts[i.key]).length

  return (
    <div className="d-shell">
      <header className="d-top">
        <div className="d-brand"><img src="/mark-dark.svg" alt="" width={30} height={30} /> SPATREN <span>Desktop</span></div>
        <div className="d-actions">
          <button className="btn btn-lime btn-sm" onClick={() => void pickZips()}>Import ZIPs</button>
          <button className="btn btn-ghost btn-sm" disabled={!!queue || !items.length} onClick={() => void transcribeAll(transcribeItem)}>
            {queue ? `Transcribing ${queue.done}/${queue.total}…` : `Transcribe all (${items.length - done} left)`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv()}>Export CSV</button>
          <button className="btn btn-ghost btn-sm" aria-pressed={showSettings} onClick={() => setShowSettings((s) => !s)}>Settings</button>
        </div>
      </header>
      {status.kind !== 'idle' && (
        <div className={`d-status ${status.kind}`} role="status">
          {status.text}
          {status.kind !== 'busy' && <button className="link-btn" onClick={() => setStatus({ kind: 'idle' })}>Dismiss</button>}
        </div>
      )}

      <div className="d-body">
        <aside className="d-list">
          <input className="input" type="search" placeholder="Search topic, student, notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="d-chips">
            {groups.map((g) => <button key={g} className={`chip ${g === group ? 'chip-lime' : ''}`} onClick={() => setGroup(g)}>{g}</button>)}
          </div>
          <p className="tiny muted">{items.length} recordings · {done} transcribed</p>
          {!items.length && <div className="d-empty">Drag the <b>spatren-….zip</b> files from the phones onto this window, or use <b>Import ZIPs</b>.</div>}
          {shown.map((i) => (
            <button key={i.key} className={`d-row ${i.key === selected ? 'sel' : ''}`} onClick={() => setSelected(i.key)}>
              <b>{titleOf(i.record)}</b>
              <span>{who(i.collector)} · {i.collector.subgroup ?? i.collector.group ?? ''} · {new Date(i.record.recorded_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`chip ${transcripts[i.key] ? 'chip-lime' : ''}`}>{transcripts[i.key] ? (transcripts[i.key].edited_at ? 'Edited' : 'Transcribed') : 'Not transcribed'}</span>
            </button>
          ))}
        </aside>

        <main className="d-main">
          {showSettings ? (
            <Settings onClose={() => setShowSettings(false)} onStatus={(t, err) => setStatus({ kind: err ? 'error' : 'ok', text: t })} />
          ) : current ? (
            <InterviewView key={current.key} item={current} transcript={transcripts[current.key] ?? null} busy={!!queue}
              onTranscribe={async () => {
                try {
                  setStatus({ kind: 'busy', text: 'Transcribing… a 10-minute interview takes a few minutes.' })
                  onTranscript(current, await transcribeItem(current))
                  setStatus({ kind: 'ok', text: 'Transcribed. Check and correct the text, it saves as you type.' })
                } catch (e) {
                  setStatus({ kind: 'error', text: String(e) })
                }
              }}
              onEdit={(t) => onTranscript(current, t)}
              onStatus={(t, err) => setStatus({ kind: err ? 'error' : 'ok', text: t })}
            />
          ) : (
            <div className="d-empty big">Pick a recording on the left.</div>
          )}
        </main>
      </div>
    </div>
  )
}

/** Decode the phone's recording to 16 kHz WAV here, then let whisper.cpp transcribe it locally. */
async function transcribeItem(item: Item): Promise<Transcript> {
  const { toWav16k } = await import('./lib/audio')
  const { parseWhisper } = await import('./lib/model')
  const wav = await toWav16k(api.audioUrl(item.dir, item.audioFile))
  const json = await api.runWhisper(wav)
  return { model: 'whisper-small-sinhala (Aadhil96)', created_at: new Date().toISOString(), edited_at: null, segments: parseWhisper(json) }
}
