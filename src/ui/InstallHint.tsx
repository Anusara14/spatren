import { useEffect, useState } from 'react'
import { IconClose } from './icons'

const KEY = 'spatren.installHint'
const SNOOZE_MS = 3 * 24 * 3600_000

export const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const IS_STANDALONE =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: PromptEvent | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as PromptEvent
})

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < SNOOZE_MS
  } catch {
    return false
  }
}

const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
)

/**
 * iPhone: Safari can delete a website's saved data after 7 days of not opening it; a Home-Screen app is exempt,
 * runs full screen and can receive notifications. So until installed, show how. Android/Chrome: one-tap install.
 */
export default function InstallHint({ compact = false }: { compact?: boolean }) {
  const [show, setShow] = useState(!IS_STANDALONE && !snoozed())
  const [canPrompt, setCanPrompt] = useState(!!deferred)

  useEffect(() => {
    const on = () => setCanPrompt(true)
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])

  if (!show || (!IS_IOS && !canPrompt)) return null
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* private mode */
    }
    setShow(false)
  }

  return (
    <div className={`install-hint ${compact ? 'compact' : ''}`} role="note">
      <img src="/icon-180.png" alt="" width={44} height={44} />
      <div className="grow">
        <b>Install SPATREN</b>
        {IS_IOS ? (
          <p>
            Tap <span className="kbd"><ShareGlyph /></span> then <b>Add to Home Screen</b>, and open SPATREN from there. It keeps your recordings safe,
            runs full screen and can show alerts.
          </p>
        ) : (
          <p>Install it as an app: full screen, works offline, and your data is kept safe.</p>
        )}
        {!IS_IOS && canPrompt && (
          <button className="btn btn-lime btn-sm" style={{ marginTop: 8 }} onClick={async () => {
            await deferred?.prompt()
            deferred = null
            setShow(false)
          }}>Install app</button>
        )}
      </div>
      <button className="glass-btn sm" aria-label="Not now" onClick={dismiss}><IconClose /></button>
    </div>
  )
}
