import { ask } from '@tauri-apps/plugin-dialog'
import { useMemo, useState } from 'react'
import { aiKey, summariseThemes, type ThemeSummary } from './lib/ai'
import { ALL, applyFilter, CODE_COLORS, codeCounts, fullText, subgroupOf, type Code, type Project, type Transcripts } from './lib/analysis'
import { titleOf, who, type Item } from './lib/model'

interface Props {
  items: Item[]
  ts: Transcripts
  project: Project
  onProject: (p: Project) => void
  onStatus: (t: string, e?: boolean) => void
}

/** The codebook (thematic codes), how often each was used per subgroup, and an optional AI theme draft. */
export default function CodesView({ items, ts, project, onProject, onStatus }: Props) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState(ALL)
  const [summary, setSummary] = useState<ThemeSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const counts = useMemo(() => codeCounts(items, ts, project.codes), [items, ts, project.codes])
  const subgroups = useMemo(() => [...new Set(items.map((i) => subgroupOf(i.collector)))].sort(), [items])

  function add() {
    const n = name.trim()
    if (!n) return
    if (project.codes.some((c) => c.name.toLowerCase() === n.toLowerCase())) return onStatus(`"${n}" is already a code.`, true)
    const code: Code = { id: crypto.randomUUID(), name: n.slice(0, 60), color: CODE_COLORS[project.codes.length % CODE_COLORS.length] }
    onProject({ codes: [...project.codes, code] })
    setName('')
  }
  const update = (id: string, p: Partial<Code>) => onProject({ codes: project.codes.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  async function remove(c: Code, used: number) {
    if (used && !(await ask(`"${c.name}" is used on ${used} lines. Remove it from the codebook? Those lines will show "Deleted code".`, { title: 'Remove code', kind: 'warning' }))) return
    onProject({ codes: project.codes.filter((x) => x.id !== c.id) })
  }

  async function themes() {
    const key = aiKey()
    if (!key) return onStatus('Add your Gemini key in Settings to draft themes.', true)
    const chosen = applyFilter(items, { group: ALL, subgroup: scope, topic: ALL }).filter((i) => ts[i.key])
    if (!chosen.length) return onStatus('Transcribe some interviews in this subgroup first.', true)
    setBusy(true)
    try {
      setSummary(await summariseThemes(key, scope === ALL ? 'all subgroups' : `${scope} subgroup`, chosen.map((i) => ({ label: `${titleOf(i.record)} (${who(i.collector)})`, text: fullText(ts[i.key]) }))))
      onStatus('Theme draft ready. Check every theme against the transcripts before using it.')
    } catch (e) {
      onStatus(String(e instanceof Error ? e.message : e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="d-view">
      <header className="stack" style={{ gap: 4 }}>
        <h1>Codes and themes</h1>
        <p className="small muted">Make a code for each idea you keep hearing (e.g. land tenure, tourism income, sacred space). Tag transcript lines with them, then compare subgroups here.</p>
      </header>

      <section className="card stack" style={{ gap: 10 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input className="input grow" placeholder="New code name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-lime btn-sm" disabled={!name.trim()}>Add code</button>
        </form>
        {!project.codes.length && <p className="small muted">No codes yet.</p>}
        {project.codes.length > 0 && (
          <div className="d-table-wrap">
            <table className="d-table">
              <thead>
                <tr><th>Code</th><th>Lines</th><th>Interviews</th>{subgroups.map((s) => <th key={s}>{s}</th>)}<th /></tr>
              </thead>
              <tbody>
                {counts.map(({ code, total, interviews, bySubgroup }) => (
                  <tr key={code.id}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <input type="color" aria-label={`Colour for ${code.name}`} value={code.color} onChange={(e) => update(code.id, { color: e.target.value })} />
                        <input className="d-inline-input" aria-label="Code name" value={code.name} maxLength={60} onChange={(e) => update(code.id, { name: e.target.value })} />
                      </span>
                    </td>
                    <td className="tnum"><b>{total}</b></td>
                    <td className="tnum">{interviews}</td>
                    {subgroups.map((s) => <td key={s} className="tnum">{bySubgroup[s] ?? ''}</td>)}
                    <td><button className="link-btn tiny" onClick={() => void remove(code, total)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Theme draft (AI, online)</h2>
          <div className="row">
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which subgroup">
              <option value={ALL}>All subgroups</option>
              {subgroups.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void themes()}>{busy ? 'Reading transcripts…' : 'Draft themes'}</button>
          </div>
        </div>
        <p className="tiny muted">Sends the transcript text (not audio) of the chosen subgroup to Gemini with your key. A starting point for discussion, not a finding.</p>
        {summary?.themes.map((t, i) => (
          <div key={i} className="d-theme">
            <div className="row between">
              <b>{t.name}</b>
              {!project.codes.some((c) => c.name.toLowerCase() === t.name.toLowerCase()) && (
                <button className="link-btn tiny" onClick={() => onProject({ codes: [...project.codes, { id: crypto.randomUUID(), name: t.name.slice(0, 60), color: CODE_COLORS[project.codes.length % CODE_COLORS.length] }] })}>
                  Add as code
                </button>
              )}
            </div>
            <p className="small">{t.summary}</p>
            {t.quotes.map((q, k) => <p key={k} className="d-en">“{q}”</p>)}
          </div>
        ))}
      </section>
    </div>
  )
}
