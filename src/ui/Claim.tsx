import { useState, type FormEvent } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { Mark } from './Theme'

interface ClaimProps {
  profile: Profile | null
  onDone: () => Promise<void>
}

const MESSAGES: Record<string, string> = {
  invalid_format: 'Index numbers look like 123456A: six digits and a capital letter.',
  not_in_roster: "That index isn't on the L2S4 class list. Check it, or ask the admin.",
  already_claimed: 'That index is already linked to another Google account. Ask the admin to reset it.',
  pending: 'Almost there. Tap Continue again.',
}

export default function Claim({ profile, onDone }: ClaimProps) {
  const [index, setIndex] = useState(profile?.index_no ?? '')
  const [msg, setMsg] = useState<string | null>(profile?.status === 'pending' ? MESSAGES.pending : null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('claim_index', { p_index: index, p_surname: '' })
    setBusy(false)
    if (error) return setMsg(error.message)
    const status = data as string
    if (status === 'approved' || status === 'already_approved') return onDone()
    setMsg(MESSAGES[status] ?? status)
    if (status === 'pending') void onDone()
  }

  return (
    <div className="auth">
      <form className="auth-card card" onSubmit={submit}>
        <div className="row between">
          <Mark size={40} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 26, letterSpacing: '-0.02em' }}>Link your index number</h1>
          <p className="muted small">This places you in your field group and subgroup automatically.</p>
        </div>
        <div className="field">
          <label htmlFor="idx">University index</label>
          <input
            id="idx"
            className="input mono"
            placeholder="e.g. 123456A"
            value={index}
            onChange={(e) => setIndex(e.target.value.toUpperCase().replace(/\s/g, ''))}
            maxLength={20}
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
        </div>
        {msg && <p className="small card-flat">{msg}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || index.length < 3}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        {profile?.status === 'pending' && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void onDone()}>
            Check again
          </button>
        )}
      </form>
    </div>
  )
}
