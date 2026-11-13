import { useState } from 'react'
import { backupAllToDocuments, fullBackup, lastBackup, restoreFromCloud, restoreFromFiles, type RestoreResult } from '../lib/backup'
import { IS_NATIVE, shareFile } from '../lib/native'

const summary = (r: RestoreResult) => {
  const parts = [`${r.added} brought back`]
  if (r.updated) parts.push(`${r.updated} completed with recordings`)
  if (r.skipped) parts.push(`${r.skipped} already here`)
  if (r.forms) parts.push(`${r.forms} form${r.forms === 1 ? '' : 's'}`)
  if (r.bad.length) parts.push(`couldn't read: ${r.bad.slice(0, 3).join(', ')}${r.bad.length > 3 ? '…' : ''}`)
  return parts.join(' · ')
}

/** Profile → Backup & restore: keep everything safe across a reinstall or a new phone. */
export default function BackupSection() {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const last = lastBackup()

  async function run(label: string, job: () => Promise<string>) {
    setBusy(label)
    setMsg(null)
    try {
      setMsg(await job())
    } catch (e) {
      setMsg(`Didn't finish: ${e instanceof Error ? e.message : 'unknown error'}. Nothing on the phone was removed.`)
    } finally {
      setBusy(null)
    }
  }

  const saveFile = () => run('save', async () => {
    const { bytes, fileName, records } = await fullBackup()
    if (IS_NATIVE) {
      if (!(await shareFile(bytes, fileName, 'SPATREN backup'))) return 'Not saved (share closed).'
    } else {
      const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: 'application/zip' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'SPATREN backup' })
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return 'Not saved (share closed).'
          throw e
        }
      } else {
        const url = URL.createObjectURL(file)
        Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
    }
    return `Backup of ${records} record${records === 1 ? '' : 's'} with recordings and photos. Keep it in Files, Drive or on a laptop.`
  })

  const fromCloud = () => run('cloud', async () => `From your account: ${summary(await restoreFromCloud((d, t) => setBusy(`cloud ${d}/${t}`)))}.`)

  const fromFiles = (files: FileList | null) => {
    if (!files?.length) return
    void run('files', async () => {
      const r = await restoreFromFiles([...files])
      if (IS_NATIVE) void backupAllToDocuments()
      return `From backup files: ${summary(r)}.`
    })
  }

  return (
    <section className="stack" style={{ gap: 8 }}>
      <h3 className="section-title" style={{ margin: 0 }}>Backup &amp; restore</h3>
      <p className="small muted">
        {IS_NATIVE
          ? 'Every record you save is also copied to the phone’s Documents/SPATREN folder, which stays even if the app is removed.'
          : 'Recordings stay on this device. Save a backup file now and then so nothing is lost if the browser data is cleared.'}
        {last ? ` Last copy: ${new Date(last).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}
      </p>
      <button className="btn btn-lime btn-sm" disabled={!!busy} onClick={() => void saveFile()}>{busy === 'save' ? 'Preparing…' : 'Save a full backup file'}</button>
      <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void fromCloud()}>{busy?.startsWith('cloud') ? `Downloading ${busy.slice(6)}…` : 'Restore from my account'}</button>
      <label className={`btn btn-ghost btn-sm ${busy ? 'disabled' : ''}`}>
        {busy === 'files' ? 'Restoring…' : 'Restore from backup files…'}
        <input type="file" multiple hidden disabled={!!busy} onChange={(e) => { fromFiles(e.target.files); e.target.value = '' }} />
      </label>
      <p className="tiny muted">After reinstalling: sign in (your uploaded records and photos come back by themselves), then pick the files in Documents/SPATREN or your backup file to bring back recordings and forms. Restoring never deletes or overwrites anything.</p>
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  )
}
