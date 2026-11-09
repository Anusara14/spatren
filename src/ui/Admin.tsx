import { useState } from 'react'
import FormsAdmin from './FormsAdmin'
import Summary from './Summary'
import Team from './Team'

type Section = 'summary' | 'forms' | 'people'
const LABELS: Record<Section, string> = { summary: 'Summary', forms: 'Forms', people: 'People & settings' }

export default function Admin() {
  const [section, setSection] = useState<Section>(() => (localStorage.getItem('spatren.adminTab') as Section) || 'summary')
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
      {section === 'summary' && <Summary />}
      {section === 'forms' && <FormsAdmin />}
      {section === 'people' && <Team />}
    </div>
  )
}
