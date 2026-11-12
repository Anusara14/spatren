import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './lib/api'
import type { Project, Transcripts } from './lib/analysis'
import { itemsOf, segmentsCsv, titleOf, who, type Item, type Package, type Transcript } from './lib/model'
import CodesView from './CodesView'
import InterviewView from './InterviewView'
import { QualityView, QuotesView, SearchView } from './Lists'
import Settings from './Settings'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string } | { kind: 'ok'; text: string }
type View = 'recordings' | 'search' | 'quotes' | 'codes' | 'quality' | 'settings'
const VIEWS: [View, string][] = [['recordings', 'Recordings'], ['search', 'Search'], ['quotes', 'Quotes'], ['codes', 'Codes'], ['quality', 'Quality']]
const WATCH_KEY = 'spatren.desktop.watch'
// Same rule as package_id in lib.rs: the file name's first 100 characters, unsafe ones replaced.
export const packageId = (path: string): string =>
  Array.from((path.split(/[\\/]/).pop() ?? '').replace(/\.zip$/i, '')).slice(0, 100).join('').replace(/[^A-Za-z0-9_-]/g, '_')
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } },
  set: (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* not remembered */ } },
}

function validProject(v: unknown): v is Project {
  return !!v && typeof v === 'object' && Array.isArray((v as Project).codes) &&
    (v as Project).codes.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.color === 'string')
}

export default function App() {
  const [packages, setPackages] = useState<Package[]>([])
  const [transcripts, setTranscripts] = useState<Transcripts>({})
  const [project, setProject] = useState<Project>({ codes: [] })
  const [loaded, setLoaded] = useState(false)
  const [modelReady, setModelReady] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [seekTo, setSeekTo] = useState<{ ms: number; n: number } | null>(null)
  const [view, setView] = useState<View>('recordings')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [queue, setQueue] = useState<{ done: number; total: number; eta: number; now: string } | null>(null)
  const [watchDir, setWatchDir] = useState(store.get(WATCH_KEY))
  const [dragging, setDragging] = useState(false)
  const stopQueue = useRef(false)
  const projectLoaded = useRef(false)
  const zipFailures = useRef(new Map<string, number>())
  const importing = useRef(false)

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
  const say = useCallback((text: string, error?: boolean) => setStatus({ kind: error ? 'error' : 'ok', text }), [])

  // Good news fades on its own; errors stay until dismissed.
  useEffect(() => {
    if (status.kind !== 'ok') return
    const t = setTimeout(() => setStatus((s) => (s === status ? { kind: 'idle' } : s)), 6000)
    return () => clearTimeout(t)
  }, [status])

  const reload = useCallback(async () => {
    const pk = await api.listPackages()
    setPackages(pk)
    const loadedTs = await Promise.all(itemsOf(pk).map(async (i) => [i.key, await api.readTranscript(i.pkg, i.record.record_id).catch(() => null)] as const))
    setTranscripts(Object.fromEntries(loadedTs.filter(([, t]) => t)) as Transcripts)
  }, [])
  const refreshModel = useCallback(() => void api.modelStatus().then((m) => setModelReady(m.installed && m.engine)).catch(() => setModelReady(false)), [])

  useEffect(() => {
    void reload().catch((e) => say(String(e), true)).finally(() => setLoaded(true))
    refreshModel()
  }, [reload, refreshModel, say])

  // The codebook. A damaged project.json is kept aside as project.damaged.json, never silently overwritten.
  useEffect(() => {
    void (async () => {
      const text = await api.readAppFile('project.json')
      if (text) {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(text)
        } catch {
          /* handled below */
        }
        if (validProject(parsed)) setProject(parsed)
        else {
          await api.writeAppFile('project.damaged.json', text)
          say('The codebook file was damaged; a copy was saved as project.damaged.json and a new codebook started.', true)
        }
      }
      projectLoaded.current = true
    })().catch((e) => say(`Couldn't read the codebook: ${String(e)}`, true))
  }, [say])
  useEffect(() => {
    if (!projectLoaded.current) return
    const t = setTimeout(() => void api.writeAppFile('project.json', JSON.stringify(project)).catch((e) => say(`Couldn't save the codebook: ${String(e)}`, true)), 400)
    return () => clearTimeout(t)
  }, [project, say])

  const importPaths = useCallback(
    async (paths: string[], quiet = false) => {
      const zips = paths.filter((p) => p.toLowerCase().endsWith('.zip'))
      if (!zips.length) return quiet ? undefined : say('Drop the .zip files sent from the phones (Send recordings).', true)
      let ok = 0
      const failed: string[] = []
      for (const [n, p] of zips.entries()) {
        setStatus({ kind: 'busy', text: `Importing ${n + 1} of ${zips.length}…` })
        try {
          await api.importZip(p)
          ok++
        } catch (e) {
          // A ZIP LocalSend is still writing fails too: the watcher retries, and gives up only after 3 failures.
          zipFailures.current.set(p, (zipFailures.current.get(p) ?? 0) + 1)
          failed.push(`${p.split(/[\\/]/).pop()}: ${String(e)}`)
        }
      }
      await reload()
      setStatus(failed.length ? { kind: 'error', text: `Imported ${ok}. Failed: ${failed.join('; ')}` } : { kind: 'ok', text: `Imported ${ok} file${ok === 1 ? '' : 's'}.` })
    },
    [reload, say],
  )

  // Drag ZIPs onto the window from Downloads / LocalSend's folder.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'enter' || e.payload.type === 'over') setDragging(true)
      else setDragging(false)
      if (e.payload.type === 'drop') void importPaths(e.payload.paths)
    })
    return () => void un.then((f) => f()).catch(() => undefined)
  }, [importPaths])

  // Watched folder: import new ZIPs as LocalSend (or anything else) drops them there.
  const knownIds = useRef(new Set<string>())
  knownIds.current = new Set(packages.map((p) => p.id))
  useEffect(() => {
    store.set(WATCH_KEY, watchDir)
    if (!watchDir) return
    let alive = true
    const tick = async () => {
      if (importing.current) return // a slow import is still unpacking: never start the same file twice
      importing.current = true
      try {
        const fresh = (await api.listZips(watchDir)).filter((p) => !knownIds.current.has(packageId(p)) && (zipFailures.current.get(p) ?? 0) < 3)
        if (alive && fresh.length) await importPaths(fresh, true)
      } catch (e) {
        if (alive) say(`Can't read the watched folder: ${String(e)}`, true)
      } finally {
        importing.current = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), 8000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [watchDir, importPaths, say])

  const pickZips = useCallback(async () => {
    const picked = await open({ multiple: true, filters: [{ name: 'SPATREN recordings', extensions: ['zip'] }] })
    if (picked) await importPaths(Array.isArray(picked) ? picked : [picked])
  }, [importPaths])

  const onTranscript = useCallback((item: Item, t: Transcript) => {
    setTranscripts((m) => ({ ...m, [item.key]: t }))
    void api.writeTranscript(item.pkg, item.record.record_id, t).catch((e) => setStatus({ kind: 'error', text: `Could not save: ${String(e)}` }))
  }, [])

  async function transcribeAll() {
    if (!modelReady) return setView('settings')
    const todo = items.filter((i) => !transcripts[i.key])
    if (!todo.length) return say('Everything is already transcribed.')
    stopQueue.current = false
    const secs = (i: Item) => i.record.interview?.audio_seconds ?? 600
    let left = todo.reduce((n, i) => n + secs(i), 0)
    let failed = 0
    let done = 0
    // The open interview stays open: students keep correcting one transcript while others are made.
    for (const item of todo) {
      if (stopQueue.current) break
      setQueue({ done, total: todo.length, eta: left * RATE, now: titleOf(item.record) })
      try {
        onTranscript(item, await transcribeItem(item))
      } catch {
        failed++
      }
      done++
      left -= secs(item)
    }
    setQueue(null)
    if (stopQueue.current) return say(`Stopped after ${done} of ${todo.length}. Press Transcribe all to continue.`)
    say(failed ? `${failed} recording${failed === 1 ? '' : 's'} could not be transcribed. Open one to see why.` : 'All recordings transcribed.', failed > 0)
  }

  async function exportCsv() {
    const rows = items.filter((i) => transcripts[i.key]).map((item) => ({ item, t: transcripts[item.key] }))
    if (!rows.length) return say('Nothing transcribed yet.', true)
    const path = await save({ defaultPath: 'spatren-transcripts.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!path) return
    const names = new Map(project.codes.map((c) => [c.id, c.name]))
    try {
      await api.saveText(path, segmentsCsv(rows, (id) => names.get(id) ?? id))
      say(`Saved ${rows.length} transcripts to ${path}`)
    } catch (e) {
      say(`Couldn't save: ${String(e)}. Is the file open in Excel?`, true)
    }
  }

  const openItem = useCallback((item: Item, ms?: number) => {
    setView('recordings')
    setSelected(item.key)
    setSeekTo(ms == null ? null : { ms, n: Date.now() })
  }, [])

  // Keyboard: Ctrl+1..5 switch views, Ctrl+F searches transcripts, Ctrl+O imports.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= VIEWS.length) {
        e.preventDefault()
        setView(VIEWS[n - 1][0])
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setView('search')
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void pickZips()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickZips])

  const done = items.filter((i) => transcripts[i.key]).length
  const mins = (s: number) => (s < 90 ? 'about a minute' : `about ${Math.round(s / 60)} min`)

  return (
    <div className="d-shell">
      <header className="d-top">
        <div className="d-brand"><img src="/mark-dark.svg" alt="" width={30} height={30} /> SPATREN <span>Desktop</span><em className="d-beta" title="Beta: a demo version for trying out transcription and analysis">Beta</em></div>
        <nav className="d-nav" aria-label="Views">
          {VIEWS.map(([v, label], i) => (
            <button key={v} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined} title={`${label} (Ctrl+${i + 1})`} onClick={() => setView(v)}>{label}</button>
          ))}
        </nav>
        <div className="d-actions">
          <button className="btn btn-lime btn-sm" title="Import ZIPs (Ctrl+O)" onClick={() => void pickZips()}>Import</button>
          {queue ? (
            <button className="btn btn-ghost btn-sm d-queue" title={`Now: ${queue.now}`} onClick={() => { stopQueue.current = true }}>
              <span className="d-spin" aria-hidden="true" /> Stop {queue.done + 1}/{queue.total} · {mins(queue.eta)}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={!items.length || done === items.length} onClick={() => void transcribeAll()}>
              Transcribe all{items.length - done ? ` (${items.length - done})` : ''}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" disabled={!done} onClick={() => void exportCsv()}>Export CSV</button>
          <button className="btn btn-ghost btn-sm" aria-pressed={view === 'settings'} onClick={() => setView(view === 'settings' ? 'recordings' : 'settings')}>
            Settings{modelReady === false ? <i className="d-dot" aria-label="needs setup" /> : null}
          </button>
        </div>
      </header>
      {queue && <div className="d-progress" role="progressbar" aria-label="Transcribing" aria-valuenow={queue.done} aria-valuemax={queue.total}><i style={{ width: `${(queue.done / queue.total) * 100}%` }} /></div>}
      {status.kind !== 'idle' && (
        <div className={`d-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
          <span>{status.kind === 'busy' && <span className="d-spin" aria-hidden="true" />} {status.text}</span>
          {status.kind !== 'busy' && <button className="link-btn" onClick={() => setStatus({ kind: 'idle' })}>Dismiss</button>}
        </div>
      )}

      <div className={`d-body ${view === 'recordings' ? '' : 'wide'}`}>
        {view === 'recordings' && (
          <aside className="d-list" aria-label="Recordings">
            <input className="input" type="search" aria-label="Filter recordings" placeholder="Filter by topic, student, notes" value={query} onChange={(e) => setQuery(e.target.value)} />
            {groups.length > 2 && (
              <div className="d-chips" role="group" aria-label="Group">
                {groups.map((g) => <button key={g} className={`chip ${g === group ? 'chip-lime' : ''}`} aria-pressed={g === group} onClick={() => setGroup(g)}>{g}</button>)}
              </div>
            )}
            {loaded && items.length > 0 && <p className="tiny muted">{items.length} recordings · {done} transcribed{shown.length !== items.length ? ` · ${shown.length} shown` : ''}</p>}
            {!loaded && [0, 1, 2].map((n) => <div key={n} className="d-row d-skeleton" aria-hidden="true" />)}
            {loaded && !items.length && (
              <div className="d-empty">
                <b>Get started</b>
                <ol className="steps small">
                  <li className={modelReady ? 'done' : ''}>{modelReady ? 'Sinhala model installed' : <>Add the Sinhala model in <button className="link-btn" onClick={() => setView('settings')}>Settings</button></>}</li>
                  <li>Drag the <b>spatren-….zip</b> files from the phones onto this window, or press <b>Import</b>.</li>
                  <li>Open a recording and press <b>Transcribe</b>.</li>
                </ol>
              </div>
            )}
            {loaded && items.length > 0 && !shown.length && <p className="small muted">No recordings match.</p>}
            {shown.map((i) => {
              const t = transcripts[i.key]
              return (
                <button key={i.key} className={`d-row ${i.key === selected ? 'sel' : ''}`} aria-current={i.key === selected ? 'true' : undefined} onClick={() => openItem(i)}>
                  <b>{titleOf(i.record)}</b>
                  <span>{who(i.collector)} · {i.collector.subgroup ?? i.collector.group ?? ''} · {new Date(i.record.recorded_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={`chip ${t ? 'chip-lime' : ''}`}>{t ? (t.edited_at ? 'Edited' : 'Transcribed') : 'Not transcribed'}</span>
                </button>
              )
            })}
          </aside>
        )}

        <main className="d-main">
          {view === 'settings' && (
            <Settings watchDir={watchDir} onWatchDir={setWatchDir} onModelChange={refreshModel} onClose={() => setView('recordings')} onStatus={say} />
          )}
          {view === 'search' && <SearchView items={items} ts={transcripts} onOpen={openItem} />}
          {view === 'quotes' && <QuotesView items={items} ts={transcripts} codes={project.codes} onOpen={openItem} onStatus={say} />}
          {view === 'codes' && <CodesView items={items} ts={transcripts} project={project} onProject={setProject} onStatus={say} />}
          {view === 'quality' && <QualityView items={items} ts={transcripts} onOpen={openItem} />}
          {view === 'recordings' &&
            (current ? (
              <InterviewView key={current.key} item={current} transcript={transcripts[current.key] ?? null} codes={project.codes} busy={!!queue} seekTo={seekTo}
                onTranscribe={async () => {
                  if (!modelReady) {
                    setView('settings')
                    return say('Add the Sinhala model first.', true)
                  }
                  const had = transcripts[current.key]
                  if (had?.edited_at && !(await ask('Transcribing again replaces your corrections, speakers, quotes and codes on this recording. Continue?', { title: 'Transcribe again', kind: 'warning' }))) return
                  try {
                    setStatus({ kind: 'busy', text: `Transcribing ${titleOf(current.record)}… ${mins((current.record.interview?.audio_seconds ?? 600) * RATE)}.` })
                    onTranscript(current, await transcribeItem(current))
                    say('Transcribed. Check and correct the text, it saves as you type.')
                  } catch (e) {
                    say(String(e), true)
                  }
                }}
                onEdit={(t) => onTranscript(current, t)}
                onStatus={say}
              />
            ) : (
              <div className="d-empty big">{items.length ? 'Pick a recording on the left.' : 'Recordings you import appear on the left.'}</div>
            ))}
        </main>
      </div>
      {dragging && <div className="d-drop" aria-hidden="true"><b>Drop ZIPs to import</b></div>}
    </div>
  )
}

/** Seconds of transcription per second of audio on a typical laptop (measured: ~0.3 on an i7; slower machines more). */
const RATE = 0.4

/** Decode the phone's recording to 16 kHz WAV here, then let whisper.cpp transcribe it locally. */
async function transcribeItem(item: Item): Promise<Transcript> {
  const { toWav16k } = await import('./lib/audio')
  const { parseWhisper } = await import('./lib/model')
  let wav: Uint8Array
  try {
    wav = await toWav16k(api.audioUrl(item.dir, item.audioFile))
  } catch {
    throw new Error("This recording's audio couldn't be opened. It may be damaged: send it again from the phone.")
  }
  const segments = parseWhisper(await api.runWhisper(wav))
  return { model: 'whisper-small-sinhala (Aadhil96)', created_at: new Date().toISOString(), edited_at: null, segments, machine_text: segments.map((s) => s.text).join(' ') }
}
