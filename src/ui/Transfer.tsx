import { useEffect, useMemo, useState } from 'react'
import { db, type LocalRecord } from '../lib/db'
import { clock } from '../lib/geo'
import type { Profile } from '../lib/supabase'
import { IS_NATIVE, shareFile } from '../lib/native'
import { buildRecordingsZip } from '../lib/transfer'
import { IconBack, IconUpload } from './icons'

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`

function cachedProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem('spatren.profile') ?? 'null') as Profile | null
  } catch {
    return null
  }
}

interface Props {
  records: LocalRecord[]
  onBack: () => void
  onToast: (m: string) => void
}

// Voice recordings leave the phone here (they never go to the cloud): one ZIP + manifest via the share sheet.
export default function Transfer({ records, onBack, onToast }: Props) {
  const withAudio = useMemo(() => records.filter((r) => r.media.some((m) => m.type.startsWith('audio'))), [records])
  const fresh = withAudio.filter((r) => !r.exported)
  const [includeOld, setIncludeOld] = useState(false)
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const chosen = includeOld ? withAudio : fresh
  const size = chosen.reduce((n, r) => n + r.media.filter((m) => m.type.startsWith('audio')).reduce((a, m) => a + m.blob.size, 0), 0)

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => undefined)
  }, [records.length])

  async function exportZip() {
    if (!chosen.length) return
    setBusy(true)
    try {
      const p = cachedProfile()
      const res = await buildRecordingsZip(chosen, {
        index_no: p?.index_no ?? null, nickname: p?.nickname ?? null, full_name: p?.full_name ?? null, grp: p?.grp ?? null, subgroup: p?.subgroup ?? null,
      })
      const file = new File([res.bytes as Uint8Array<ArrayBuffer>], res.fileName, { type: 'application/zip' })
      let sent = false
      if (IS_NATIVE) {
        sent = await shareFile(res.bytes, res.fileName, 'SPATREN recordings')
        if (!sent) {
          setBusy(false)
          return // closed the share sheet: nothing was sent
        }
      } else if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'SPATREN recordings' })
          sent = true
        } catch (e: unknown) {
          if (e instanceof DOMException && e.name === 'AbortError') {
            setBusy(false)
            return // the student closed the share sheet: nothing was sent
          }
          throw e
        }
      } else {
        const url = URL.createObjectURL(file)
        Object.assign(document.createElement('a'), { href: url, download: res.fileName }).click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        sent = true
      }
      if (sent) {
        const at = new Date().toISOString()
        await db.transaction('rw', db.records, async () => {
          for (const id of res.recordIds) await db.records.update(id, { exported: at })
        })
        onToast(`${res.audioCount} recording${res.audioCount === 1 ? '' : 's'} packed (${mb(res.bytes.length)}). Keep them on the phone until the laptop has imported them.`)
      }
    } catch (e: unknown) {
      onToast(`Couldn't create the file: ${e instanceof Error ? e.message : 'unknown error'}. Free up phone storage and try again.`)
    }
    setBusy(false)
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <header className="kc-sub">
        <button className="glass-btn sm" aria-label="Back to Collect" onClick={onBack}><IconBack /></button>
        <h1 className="grow">Transfer recordings</h1>
      </header>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div><b>{fresh.length}</b><span>Not transferred</span></div>
          <div><b>{withAudio.length}</b><span>On this phone</span></div>
          <div><b>{usage ? mb(usage.used) : '–'}</b><span>App storage used</span></div>
        </div>
        <p className="small muted">
          Voice recordings stay on this phone (they are not uploaded). Send them to the group laptop at the end of each day; the desktop app
          transcribes and translates them there.
        </p>
        <label className="switch">
          <input type="checkbox" checked={includeOld} onChange={(e) => setIncludeOld(e.target.checked)} />
          <span className="switch-ui" aria-hidden="true" />
          Include recordings already transferred
        </label>
        <button className="btn btn-lime btn-block" style={{ height: 54 }} onClick={() => void exportZip()} disabled={busy || !chosen.length}>
          <IconUpload width={20} />
          {busy ? 'Packing…' : chosen.length ? `Send ${chosen.length} recording${chosen.length === 1 ? '' : 's'} · ${mb(size)}` : 'Nothing new to send'}
        </button>
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>How to send</h2>
        {IS_IOS ? (
          <ol className="steps">
            <li>Tap Send above. The share sheet opens.</li>
            <li><b>AirDrop</b> to a Mac, or choose <b>LocalSend</b> (free app) to send to a Windows laptop on the same Wi-Fi.</li>
            <li>No laptop nearby? Choose <b>Save to Files</b> and send it later.</li>
          </ol>
        ) : (
          <ol className="steps">
            <li>Tap Send above. The share sheet opens.</li>
            <li>Choose <b>LocalSend</b> (free app, same Wi-Fi) or <b>Quick Share</b> to send to the laptop.</li>
            <li>No laptop nearby? Choose <b>Files</b> or <b>Drive</b> to keep a copy and send it later.</li>
          </ol>
        )}
        <p className="tiny muted">Get LocalSend free from localsend.org on the phone and the laptop.</p>
      </section>

      {withAudio.length > 0 && (
        <div className="people">
          {withAudio.slice(0, 60).map((r) => (
            <div key={r.id} className="person-row">
              <div className="grow">
                <b>{r.title || String(r.data.form_title ?? r.kind)}</b>
                <p className="small muted tnum">
                  {new Date(r.recorded_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} {clock(r.recorded_at)} ·{' '}
                  {mb(r.media.filter((m) => m.type.startsWith('audio')).reduce((a, m) => a + m.blob.size, 0))}
                </p>
              </div>
              <span className={`chip ${r.exported ? 'chip-lime' : ''}`}>{r.exported ? 'Transferred' : 'On phone'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
