import { useState } from 'react'
import FormsAdmin from './FormsAdmin'
import Team from './Team'

type Section = 'forms' | 'people'
const LABELS: Record<Section, string> = { forms: 'Forms', people: 'People & settings' }

export default function Admin() {
  const [section, setSection] = useState<Section>(() => (localStorage.getItem('spatren.adminTab') === 'people' ? 'people' : 'forms'))
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
      <h1 className="page-title">Admin</h1>
      <div className="segmented" role="tablist" aria-label="Admin sections">
        {(Object.keys(LABELS) as Section[]).map((s) => (
          <button key={s} role="tab" aria-selected={section === s} aria-pressed={section === s} onClick={() => pick(s)}>{LABELS[s]}</button>
        ))}
      </div>
      {section === 'forms' && <FormsAdmin />}
      {section === 'people' && <Team />}
    </div>
  )
}
