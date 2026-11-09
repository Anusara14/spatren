import { useState, type FormEvent } from 'react'
import { supabase, type Profile } from '../lib/supabase'

interface ClaimProps {
  profile: Profile | null
  onDone: () => Promise<void>
}

const MESSAGES: Record<string, string> = {
  invalid_format: 'Index numbers look like 242343J: six digits and a capital letter.',
  not_in_roster: "That index isn't on the L2S4 class list. Check it, or ask the class rep.",
  already_claimed: 'That index is already linked to another Google account. Ask the class rep to reset it.',
  pending: "Thanks. Your name didn't match the class list exactly, so the class rep will approve you shortly.",
}

export default function Claim({ profile, onDone }: ClaimProps) {
  const [index, setIndex] = useState(profile?.index_no ?? '')
  const [surname, setSurname] = useState('')
  const [msg, setMsg] = useState<string | null>(profile?.status === 'pending' ? MESSAGES.pending : null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('claim_index', { p_index: index, p_surname: surname })
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
          <img src="/mark.svg" alt="" width={40} height={40} />
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
            placeholder="242343J"
            value={index}
            onChange={(e) => setIndex(e.target.value.toUpperCase().replace(/\s/g, ''))}
            maxLength={7}
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="sn">Your surname (as on the class list) or your nickname</label>
          <input id="sn" className="input" placeholder="e.g. Ranasinghe or Anusara" value={surname} onChange={(e) => setSurname(e.target.value)} required />
        </div>
        {msg && <p className="small card-flat">{msg}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || index.length < 7}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        {profile?.status === 'pending' && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void onDone()}>
            Check approval status
          </button>
        )}
      </form>
    </div>
  )
}
