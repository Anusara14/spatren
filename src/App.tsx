import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { requestPersistence } from './lib/db'
import { supabase, type Profile } from './lib/supabase'
import { syncNow } from './lib/sync'
import { startTracking, wasTracking } from './lib/tracking'
import Admin from './ui/Admin'
import Collect from './ui/Collect'
import Claim from './ui/Claim'
import Control from './ui/Control'
import Field from './ui/Field'
import { IconChart, IconField, IconPlus, IconRadar } from './ui/icons'
import Login from './ui/Login'
import { Mark } from './ui/Theme'
import FormRunner from './ui/FormRunner'
import { SAMPLE_FORM } from './lib/forms'

type Tab = 'field' | 'collect' | 'control' | 'admin'
const PROFILE_CACHE = 'spatren.profile'

function cachedProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_CACHE) ?? 'null') as Profile | null
  } catch {
    return null
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null | undefined>(cachedProfile() ?? undefined)
  const [tab, setTab] = useState<Tab>('field')

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const loadProfile = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_profile')
    if (error) return // offline: keep the cached profile so Field Mode still works
    const p = ((data as Profile[] | null) ?? [])[0] ?? null
    setProfile(p)
    if (p) localStorage.setItem(PROFILE_CACHE, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_CACHE)
  }, [])

  useEffect(() => {
    if (session) void loadProfile()
  }, [session, loadProfile])

  useEffect(() => {
    if (profile?.status !== 'approved') return
    void requestPersistence()
    void syncNow()
    if (wasTracking()) void startTracking() // resume after a reload or app switch
    const retry = setInterval(() => void syncNow(), 30_000) // records + SOS retry even with Field Mode off
    return () => clearInterval(retry)
  }, [profile?.status])

  if (import.meta.env.DEV && location.hash.endsWith('-preview')) return <div className="main wide"><DevPreview /></div>
  if (session === undefined) return <Splash />
  // With no session but a cached profile (offline, token expired) collection continues locally; uploads wait for sign-in.
  if (!session && !profile) return <Login />
  if (session && profile === undefined) return <Splash />
  if (!profile || profile.status !== 'approved') return <Claim profile={profile ?? null} onDone={loadProfile} />

  const tabs: { id: Tab; label: string; icon: JSX.Element; admin?: boolean }[] = [
    { id: 'field', label: 'Field', icon: <IconField /> },
    { id: 'collect', label: 'Collect', icon: <IconPlus /> },
    { id: 'control', label: 'Live map', icon: <IconRadar />, admin: true },
    { id: 'admin', label: 'Admin', icon: <IconChart />, admin: true },
  ]

  return (
    <div className="shell">
      <nav className="tabbar" aria-label="Main">
        <Mark className="rail-logo" size={40} />
        {tabs
          .filter((t) => !t.admin || profile.is_admin)
          .map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.icon}
              {t.label}
            </button>
          ))}
      </nav>
      <main className={`main ${tab === 'control' || tab === 'field' ? 'wide' : ''}`}>
        {tab === 'field' && <Field profile={profile} onRecord={() => setTab('collect')} />}
        {tab === 'collect' && <Collect isAdmin={profile.is_admin} />}
        {tab === 'control' && profile.is_admin && <Control />}
        {tab === 'admin' && profile.is_admin && <Admin />}
      </main>
    </div>
  )
}

// Dev-only: preview the real screens without signing in.
function DevPreview() {
  const fake: Profile = { index_no: '242343J', full_name: 'Ranasinghe W.K.Y.A', nickname: 'Anusara', grp: 'Group 3', subgroup: 'Cultural', elective: 'Land Use', is_admin: true, status: 'approved', tracking: false }
  const h = location.hash
  if (h === '#control-preview') return <Control />
  if (h === '#collect-preview') return <div className="main"><Collect isAdmin /></div>
  if (h === '#admin-preview') return <div className="main"><Admin /></div>
  if (h === '#runner-preview') return <FormRunner form={{ id: 'demo', title: SAMPLE_FORM.title, version: 1, definition: SAMPLE_FORM }} onClose={() => undefined} />
  return <Field profile={fake} onRecord={() => undefined} />
}

function Splash() {
  return (
    <div className="auth">
      <Mark size={72} />
    </div>
  )
}
