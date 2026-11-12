import { lazy, Suspense, useState } from 'react'
import type { Profile } from '../lib/supabase'
import FormsAdmin from './FormsAdmin'
import Team from './Team'

const Batches = lazy(() => import('./Batches'))

type Section = 'forms' | 'people' | 'batches'

export default function Admin({ profile }: { profile: Profile }) {
  const labels: [Section, string][] = [['forms', 'Forms'], ['people', 'People & settings'], ...(profile.is_owner ? [['batches', 'Batches'] as [Section, string]] : [])]
  const [section, setSection] = useState<Section>(() => {
    const saved = localStorage.getItem('spatren.adminTab') as Section | null
    return saved && labels.some(([s]) => s === saved) ? saved : 'forms'
  })
  const pick = (s: Section) => {
    setSection(s)
    try {
      localStorage.setItem('spatren.adminTab', s)
    } catch {
      /* private mode */
    }
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="page-title">Admin</h1>
        {profile.batch_name && <p className="small muted">{profile.batch_name}{profile.batch_place ? ` · ${profile.batch_place}` : ''}</p>}
      </div>
      <div className="segmented" role="tablist" aria-label="Admin sections">
        {labels.map(([s, label]) => (
          <button key={s} role="tab" aria-selected={section === s} aria-pressed={section === s} onClick={() => pick(s)}>{label}</button>
        ))}
      </div>
      {section === 'forms' && <FormsAdmin />}
      {section === 'people' && <Team profile={profile} />}
      {section === 'batches' && profile.is_owner && (
        <Suspense fallback={<p className="small muted">Loading…</p>}>
          <Batches />
        </Suspense>
      )}
    </div>
  )
}
