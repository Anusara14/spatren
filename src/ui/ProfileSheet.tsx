import { useEffect, useState, type FormEvent } from 'react'
import { groupColor } from '../lib/geo'
import { askNotificationPermission, notificationState } from '../lib/meeting'
import { myAiKey, saveMyAiKey, testAiKey } from '../lib/ai'
import { oauthRedirect, openOAuth } from '../lib/native'
import { avatarUrl, nameOf, supabase, type Profile } from '../lib/supabase'
import { stopTracking } from '../lib/tracking'
import { IconClose, IconGoogle, IconSync } from './icons'
import { ThemeToggle } from './Theme'

const BASE_SEEDS = ['Aneka', 'Felix', 'Jasper', 'Luna', 'Milo', 'Nova', 'Orion', 'Pepper', 'Quinn', 'Riley', 'Sage', 'Theo', 'Uma', 'Vivi', 'Wren', 'Zara', 'Kiran', 'Asha', 'Dilan', 'Mali', 'Nila', 'Ravi', 'Sena', 'Tara']
const randomSeeds = () => Array.from({ length: 24 }, () => Math.random().toString(36).slice(2, 10))
interface Props {
  profile: Profile
  onClose: () => void
  onChanged: () => void
}

export default function ProfileSheet({ profile, onClose, onChanged }: Props) {
  const [seeds, setSeeds] = useState(BASE_SEEDS)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [kind, setKind] = useState<'password' | 'google' | 'anonymous' | null>(null)
  const [pw, setPw] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [notif, setNotif] = useState<string>('default')
  useEffect(() => void notificationState().then(setNotif), [])

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      setKind(u?.is_anonymous ? 'anonymous' : u?.app_metadata?.provider === 'google' ? 'google' : 'password')
    })
  }, [])

  async function pick(seed: string) {
    setAvatar(seed)
    const { error } = await supabase.rpc('set_avatar', { p_seed: seed })
    if (!error) onChanged()
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 6) return setPwMsg('Use at least 6 characters.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwMsg(error ? error.message : 'Password changed.')
    if (!error) setPw('')
  }

  async function signOut() {
    const warn = kind === 'anonymous'
      ? 'You joined with your index only, so signing out ends this login for good: to come back, the admin must reset your index. Link Google first to keep it. Sign out anyway?'
      : 'Sign out of SPATREN on this phone? Anything not uploaded yet stays on the phone and uploads after you sign in again.'
    if (!confirm(warn)) return
    await stopTracking().catch(() => undefined)
    localStorage.removeItem('spatren.profile')
    await supabase.auth.signOut()
    location.reload()
  }

  const me = avatarUrl(avatar)
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14 }}>
            <span className="avatar-xl" style={{ background: groupColor(profile.grp) }}>
              {me ? <img src={me} alt="" /> : nameOf(profile).slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{nameOf(profile)}</h2>
              <p className="small muted tnum">{profile.index_no}{profile.full_name ? ` · ${profile.full_name}` : ''}</p>
              <p className="small muted">{profile.grp} · {profile.subgroup} · {profile.elective}{profile.is_admin ? ' · Admin' : ''}</p>
            </div>
          </div>
          <button className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>

        <section className="stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 className="section-title" style={{ margin: 0 }}>Avatar</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setSeeds(randomSeeds())}><IconSync width={16} /> More</button>
          </div>
          <div className="avatar-wrap"><div className="avatar-grid" role="radiogroup" aria-label="Choose an avatar">
            {seeds.map((s) => (
              <button key={s} role="radio" aria-checked={avatar === s} className="avatar-opt" onClick={() => void pick(s)}>
                <img src={avatarUrl(s)!} alt={`Avatar ${s}`} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div></div>
          <p className="tiny muted">Avatars: DiceBear “Adventurer Neutral” by Lisa Wischofsky, CC BY 4.0.</p>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Appearance</h3>
          <ThemeToggle />
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Notifications</h3>
          {notif === 'granted' ? (
            <p className="small muted">On. Meeting calls and alerts can reach you while the app is in the background.</p>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => void askNotificationPermission().then(setNotif)}>
              Turn on notifications
            </button>
          )}
        </section>

        <AiKeySection />

        <section className="stack" style={{ gap: 8 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Account</h3>
          {kind === 'google' && <p className="small muted">Signed in with Google.</p>}
          {kind === 'password' && (
            <form className="row" onSubmit={changePassword}>
              <input className="input grow" type="password" placeholder="New password" minLength={6} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn btn-primary btn-sm">Change</button>
            </form>
          )}
          {pwMsg && <p className="small muted">{pwMsg}</p>}
          {kind === 'anonymous' && <p className="small muted">Joined with your index only (no password). It stays signed in on this phone. Link Google to use it on another phone too.</p>}
          {kind === 'anonymous' && (
            <button className="btn google-btn btn-sm" onClick={() => void supabase.auth.linkIdentity({ provider: 'google', options: oauthRedirect() }).then(({ data }) => openOAuth(data?.url))}>
              <IconGoogle /> Link a Google account
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void signOut()}>Sign out</button>
        </section>
      </div>
    </div>
  )
}

/** Personal Gemini key for open-interview follow-ups. Kept only on this phone. */
function AiKeySection() {
  const [key, setKey] = useState(myAiKey()?.key ?? '')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = myAiKey()?.key ?? ''
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h3 className="section-title" style={{ margin: 0 }}>AI follow-ups</h3>
      <p className="small muted">
        For open interviews. Get a free key at <b>aistudio.google.com/apikey</b> (sign in with any Gmail, no card), copy it, paste it here. It stays on this phone only.
      </p>
      <div className="row">
        <input className="input grow" type="password" autoComplete="off" placeholder="Paste your AI key" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn btn-lime btn-sm" disabled={busy || key.trim() === saved} onClick={() => { saveMyAiKey(key); setMsg(key.trim() ? 'Saved.' : 'Removed. The class key is used if the admin set one.') }}>Save</button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !key.trim()} onClick={() => { setBusy(true); void testAiKey(key).then(setMsg).catch(() => setMsg('No internet to check the key.')).finally(() => setBusy(false)) }}>{busy ? 'Checking…' : 'Test key'}</button>
      </div>
      {msg && <p className="small muted">{msg}</p>}
    </section>
  )
}
