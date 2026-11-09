import { useCallback, useEffect, useState } from 'react'
import { answerText, flatQuestions, type Answers, type FormDef } from '../lib/forms'
import { supabase, type RecordRow, type TeamRow } from '../lib/supabase'
import { csvCell, download } from './export'
import FormImport from './FormImport'

interface FormListRow {
  id: string
  title: string
  version: number
  active: boolean
  definition: FormDef
  created_at: string
}

// Published surveys: responses, CSV export, edit (new version) and hide/show. Importing lives in Collect.
export default function FormsAdmin() {
  const [forms, setForms] = useState<FormListRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [editing, setEditing] = useState<FormListRow | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('forms').select('id,title,version,active,definition,created_at').order('created_at', { ascending: false })
    setForms((data ?? []) as FormListRow[])
    const { data: recs } = await supabase.from('records').select('data').eq('kind', 'survey')
    const c: Record<string, number> = {}
    for (const r of (recs ?? []) as { data: { form_id?: string } }[]) if (r.data.form_id) c[r.data.form_id] = (c[r.data.form_id] ?? 0) + 1
    setCounts(c)
  }, [])

  useEffect(() => void load(), [load])

  async function toggle(f: FormListRow) {
    await supabase.from('forms').update({ active: !f.active }).eq('id', f.id)
    void load()
  }

  async function exportCsv(f: FormListRow) {
    const [{ data: recs }, { data: team }] = await Promise.all([
      supabase.from('records').select('*').eq('kind', 'survey').eq('data->>form_id', f.id).order('recorded_at'),
      supabase.from('team_status').select('user_id,index_no,full_name,nickname,grp,subgroup,elective'),
    ])
    const who = new Map(((team ?? []) as TeamRow[]).map((t) => [t.user_id, t]))
    const qs = flatQuestions(f.definition).filter((q) => q.type !== 'note')
    const head = ['response_id', 'recorded_at', 'form_version', 'index_no', 'name', 'nickname', 'group', 'subgroup', 'elective', 'lat', 'lng', 'accuracy', ...qs.map((q) => q.id)]
    const lines = ((recs ?? []) as RecordRow[]).map((r) => {
      const t = who.get(r.user_id)
      const answers = (r.data.answers ?? {}) as Answers
      const cells = qs.map((q) => {
        const a = answers[q.id]
        if ((q.type === 'photo' || q.type === 'audio') && typeof a === 'string') return r.media.find((m) => m.path.endsWith(`/${a}`))?.path ?? a
        return answerText(a)
      })
      return [r.id, r.recorded_at, r.data.form_version, t?.index_no, t?.full_name, t?.nickname, t?.grp, t?.subgroup, t?.elective, r.lat, r.lng, r.accuracy, ...cells].map(csvCell).join(',')
    })
    const label = ['', '', '', '', '', '', '', '', '', '', '', '', ...qs.map((q) => q.label)].map(csvCell).join(',')
    download(`${slug(f.title)}-responses.csv`, '﻿' + [head.join(','), label, ...lines].join('\n'), 'text/csv')
  }

  if (editing)
    return (
      <section className="card stack">
        <h2 className="section-title" style={{ margin: 0 }}>Update “{editing.title}”</h2>
        <FormImport isAdmin replacing={editing} onCancel={() => setEditing(null)} onDone={(m) => { setEditing(null); setMsg(m); void load() }} />
      </section>
    )

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small muted">To add a survey, go to Collect → Import form and choose “Publish to everyone”.</p>
      {msg && <p className="note-ok">{msg}</p>}
      {forms.length === 0 && <p className="empty">No published surveys yet.</p>}
      {forms.map((f) => (
        <div key={f.id} className="list-row">
          <div className="grow">
            <b>{f.title}</b>
            <p className="small muted">v{f.version} · {flatQuestions(f.definition).length} questions · {counts[f.id] ?? 0} responses · {f.active ? 'Live' : 'Hidden'}</p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv(f)} disabled={!counts[f.id]}>CSV</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)}>Edit</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void toggle(f)}>{f.active ? 'Hide' : 'Show'}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'survey'
