import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconGoogle } from './icons'

// Google sign-in ships later; until then students join with an anonymous account that can be
// upgraded in place (supabase.auth.linkIdentity) without losing anything they collected.
const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE === '1'

export default function Login() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function join() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      setError(navigator.onLine ? `Couldn't start: ${error.message}` : 'You are offline. Connect once to join; after that the app works offline.')
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      setError(error.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/logo-stacked.svg" alt="SPATREN" style={{ width: 132, height: 132, margin: '-24px 0 -18px -22px' }} />
        <h1 className="auth-hero">
          Fieldwork, <em>together</em>.
        </h1>
        <p className="muted">
          Share your live location with your coordinators during field sessions, record observations and interviews offline,
          and call for help in one press.
        </p>
        <button className="btn btn-lime btn-block" style={{ height: 56 }} onClick={() => void join()} disabled={busy}>
          {busy ? 'Starting…' : 'Join my field team'}
        </button>
        {GOOGLE_ENABLED && (
          <button className="btn google-btn btn-block" onClick={() => void google()} disabled={busy}>
            <IconGoogle /> Continue with Google
          </button>
        )}
        {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
        <p className="small muted">
          You'll confirm your university index number next. Use the same phone for the whole visit. Location is only shared
          while Field Mode is on.
        </p>
      </div>
    </div>
  )
}
