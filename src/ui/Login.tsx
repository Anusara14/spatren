import { useState, type FormEvent } from 'react'
import { emailForIndex, supabase } from '../lib/supabase'
import { IconGoogle } from './icons'
import InstallHint, { IS_IOS, IS_STANDALONE } from './InstallHint'
import { StackedLogo } from './Theme'

type Mode = 'login' | 'signup'

const SIGNUP_MESSAGES: Record<string, string> = {
  invalid_format: 'Index numbers look like 242343J: six digits and a capital letter.',
  not_in_roster: "That index isn't on the class list. Check it, or ask the class rep.",
  weak_password: 'Use a password of at least 6 characters.',
  already_claimed: 'That index is already linked to another account (maybe Google). Log in with that, or ask the class rep to reset it.',
  account_exists: 'You already have an account. Switch to Log in.',
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Wrong index or password. New here? Switch to Sign up.'
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'Google sign-in is not available right now. Use your index and password.'
  return message
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [index, setIndex] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
  }

  async function google() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      setError(navigator.onLine ? friendly(error.message) : 'You are offline. Connect once to sign in; after that the app works offline.')
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!navigator.onLine) return setError('You are offline. Connect once to sign in; after that the app works offline.')
    const idx = index.trim().toUpperCase()
    if (!/^\d{6}[A-Z]$/.test(idx)) return setError(SIGNUP_MESSAGES.invalid_format)
    if (mode === 'signup' && password !== confirm) return setError("The two passwords don't match.")
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.functions.invoke<{ status: string; message?: string }>('signup-index', {
          body: { index: idx, password, name },
        })
        const status = data?.status
        if (error || !status || status === 'error') throw new Error(data?.message ?? error?.message ?? 'Sign-up failed. Try again.')
        if (status !== 'approved' && status !== 'pending') throw new Error(SIGNUP_MESSAGES[status] ?? status)
      }
      const { error } = await supabase.auth.signInWithPassword({ email: emailForIndex(idx), password })
      if (error) throw new Error(friendly(error.message))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <StackedLogo style={{ width: 120, height: 120, margin: '-22px 0 -18px -20px' }} />
        <h1 className="auth-hero">
          Fieldwork, <em>together</em>.
        </h1>

        <div className="segmented" role="tablist" aria-label="Account">
          <button role="tab" aria-selected={mode === 'login'} aria-pressed={mode === 'login'} onClick={() => switchTo('login')}>Log in</button>
          <button role="tab" aria-selected={mode === 'signup'} aria-pressed={mode === 'signup'} onClick={() => switchTo('signup')}>Sign up</button>
        </div>

        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <div className="field">
            <label htmlFor="li-idx">University index</label>
            <input id="li-idx" className="input mono" placeholder="242343J" value={index} maxLength={7} autoCapitalize="characters" autoComplete="username" required
              onChange={(e) => setIndex(e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </div>
          <div className="field">
            <label htmlFor="li-pw">Password</label>
            <input id="li-pw" className="input" type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === 'signup' && (
            <>
              <div className="field">
                <label htmlFor="li-pw2">Confirm password</label>
                <input id="li-pw2" className="input" type="password" minLength={6} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="li-name">Surname or nickname <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <input id="li-name" className="input" placeholder="e.g. Ranasinghe or Anusara" value={name} onChange={(e) => setName(e.target.value)} />
                <p className="small muted">Adding it gets you approved instantly. Without it, the class rep approves you.</p>
              </div>
            </>
          )}
          {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="btn btn-lime btn-block" style={{ height: 54 }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <div className="or"><span>or</span></div>
        {IS_IOS && IS_STANDALONE && (
          <p className="small muted">On iPhone, Google sign-in can open Safari instead of returning here. If that happens, use your index and password.</p>
        )}
        <button className="btn google-btn btn-block" onClick={() => void google()} disabled={busy}>
          <IconGoogle /> {mode === 'login' ? 'Log in with Google' : 'Sign up with Google'}
        </button>
        <InstallHint compact />
        <p className="small muted">
          Forgot your password? Ask the class rep to reset your index, then sign up again. Location is shared only while Field Mode is on.
        </p>
      </div>
    </div>
  )
}
