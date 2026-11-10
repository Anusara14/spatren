import { useState } from 'react'
import { restartIntoUpdate, useUpdate } from '../lib/updates'
import { IconClose } from './icons'

/** Android app: "update ready" (web code, applied on restart) or "new app version" (APK download). */
export default function UpdateBanner() {
  const [u, dismiss] = useUpdate()
  const [busy, setBusy] = useState(false)
  if (u.kind === 'none') return null

  const open = async (url: string) => {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  }

  return (
    <div className="update-banner" role="status">
      <div className="grow">
        <b>{u.kind === 'web' ? 'Update ready' : `New app version ${u.version}`}</b>
        <span>{u.kind === 'web' ? 'Restart now, or it applies next time you open SPATREN.' : 'Download it once and install. Your data is kept.'}</span>
      </div>
      {u.kind === 'web' ? (
        <button className="btn btn-lime btn-sm" disabled={busy} onClick={() => { setBusy(true); void restartIntoUpdate(u.id).catch(() => setBusy(false)) }}>
          {busy ? '…' : 'Restart'}
        </button>
      ) : (
        <button className="btn btn-lime btn-sm" onClick={() => void open(u.url)}>Download</button>
      )}
      <button className="glass-btn sm" aria-label="Later" onClick={dismiss}><IconClose /></button>
    </div>
  )
}
