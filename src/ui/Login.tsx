import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconGoogle } from './icons'

function friendly(message: string): string {
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'Google sign-in is not switched on yet. Use "Join without Google" for now, or ask the class rep.'
  return message
}

export default function Login() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'google' | 'anon' | null>(null)

  async function google() {
    setBusy('google')
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      setError(navigator.onLine ? friendly(error.message) : 'You are offline. Connect once to sign in; after that the app works offline.')
      setBusy(null)
    }
  }

  // Fallback: an anonymous account on this phone only. It can be linked to Google later without losing data.
  async function join() {
    setBusy('anon')
    setError(null)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      setError(navigator.onLine ? `Couldn't start: ${error.message}` : 'You are offline. Connect once to join; after that the app works offline.')
      setBusy(null)
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
          Share your live location with your coordinators during field sessions, collect surveys offline, and call for help in
          one press.
        </p>
        <button className="btn google-btn btn-block" style={{ height: 56 }} onClick={() => void google()} disabled={!!busy}>
          <IconGoogle /> {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <button className="btn btn-ghost btn-block" onClick={() => void join()} disabled={!!busy}>
          {busy === 'anon' ? 'Starting…' : 'Join without Google'}
        </button>
        {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
        <p className="small muted">
          With Google you can sign in again on any phone. Without Google, your account lives only in this browser. You'll
          confirm your university index next. Location is shared only while Field Mode is on.
        </p>
      </div>
    </div>
  )
}
