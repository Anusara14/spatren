import { useCallback, useEffect, useRef, useState } from 'react'
import { answerText, CHATGPT_PROMPT, flatQuestions, parseForm, SAMPLE_FORM, type Answers, type FormDef } from '../lib/forms'
import { supabase, type RecordRow, type TeamRow } from '../lib/supabase'
import { csvCell, download } from './export'

interface FormListRow {
  id: string
  title: string
  version: number
  active: boolean
  definition: FormDef
  created_at: string
}

const TYPE_LABEL: Record<string, string> = {
  text: 'Short text', textarea: 'Long text', integer: 'Whole number', decimal: 'Number', select_one: 'One choice',
  select_multiple: 'Multi choice', yes_no: 'Yes / No', rating: '1–5 stars', likert: 'Agree scale', date: 'Date', time: 'Time',
  gps: 'GPS', photo: 'Photo', audio: 'Voice', note: 'Note',
}

export default function FormsAdmin() {
  const [forms, setForms] = useState<FormListRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [raw, setRaw] = useState('')
  const [replacing, setReplacing] = useState<FormListRow | null>(null)
  const [parsed, setParsed] = useState<{ form?: FormDef; errors: string[] } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('forms').select('id,title,version,active,definition,created_at').order('created_at', { ascending: false })
    setForms((data ?? []) as FormListRow[])
    const { data: recs } = await supabase.from('records').select('data').eq('kind', 'survey')
    const c: Record<string, number> = {}
    for (const r of (recs ?? []) as { data: { form_id?: string } }[]) if (r.data.form_id) c[r.data.form_id] = (c[r.data.form_id] ?? 0) + 1
    setCounts(c)
  }, [])

  useEffect(() => void load(), [load])

  function check(text = raw) {
    setMsg(null)
    setParsed(parseForm(text))
  }

  async function publish() {
    if (!parsed?.form) return
    const f = parsed.form
    const { error } = replacing
      ? await supabase.from('forms').update({ title: f.title, definition: f, version: replacing.version + 1, updated_at: new Date().toISOString() }).eq('id', replacing.id)
      : await supabase.from('forms').insert({ title: f.title, definition: f })
    if (error) return setMsg(`Couldn't publish: ${error.message}`)
    setMsg(replacing ? `Updated “${f.title}” to version ${replacing.version + 1}. Phones get it on next open.` : `Published “${f.title}”. It is now on every student's Collect tab.`)
    setRaw('')
    setParsed(null)
    setReplacing(null)
    void load()
  }

  async function toggle(f: FormListRow) {
    await supabase.from('forms').update({ active: !f.active }).eq('id', f.id)
    void load()
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(CHATGPT_PROMPT)
      setMsg('Prompt copied. Paste it into ChatGPT, describe your survey after it, then paste the JSON reply here.')
    } catch {
      setRaw(CHATGPT_PROMPT)
      setMsg('Clipboard blocked, so the prompt is in the box below. Copy it from there.')
    }
  }

  async function exportCsv(f: FormListRow) {
    const [{ data: recs }, { data: team }] = await Promise.all([
      supabase.from('records').select('*').eq('kind', 'survey').eq('data->>form_id', f.id).order('recorded_at'),
      supabase.from('team_status').select('user_id,index_no,full_name,grp,subgroup,elective'),
    ])
    const who = new Map(((team ?? []) as TeamRow[]).map((t) => [t.user_id, t]))
    const qs = flatQuestions(f.definition).filter((q) => q.type !== 'note')
    const head = ['response_id', 'recorded_at', 'form_version', 'index_no', 'name', 'group', 'subgroup', 'elective', 'lat', 'lng', 'accuracy', ...qs.map((q) => q.id)]
    const lines = ((recs ?? []) as RecordRow[]).map((r) => {
      const t = who.get(r.user_id)
      const answers = (r.data.answers ?? {}) as Answers
      const cells = qs.map((q) => {
        const a = answers[q.id]
        if ((q.type === 'photo' || q.type === 'audio') && typeof a === 'string') return r.media.find((m) => m.path.endsWith(`/${a}`))?.path ?? a
        return answerText(a)
      })
      return [r.id, r.recorded_at, r.data.form_version, t?.index_no, t?.full_name, t?.grp, t?.subgroup, t?.elective, r.lat, r.lng, r.accuracy, ...cells].map(csvCell).join(',')
    })
    const label = ['', '', '', '', '', '', '', '', '', '', '', ...qs.map((q) => q.label)].map(csvCell).join(',')
    download(`${slug(f.title)}-responses.csv`, '﻿' + [head.join(','), label, ...lines].join('\n'), 'text/csv')
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="card stack">
        <h2 className="section-title" style={{ margin: 0 }}>{replacing ? `Update “${replacing.title}”` : 'Add a survey'}</h2>
        <ol className="steps">
          <li><button className="link-btn" onClick={() => void copyPrompt()}>Copy the ChatGPT prompt</button> and describe your survey after it.</li>
          <li>Paste ChatGPT's JSON reply below, or <button className="link-btn" onClick={() => fileRef.current?.click()}>upload a .json file</button>.</li>
          <li>Check it, then publish. It appears on every phone's Collect tab.</li>
        </ol>
        <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void f.text().then((t) => { setRaw(t); check(t) })
          e.target.value = ''
        }} />
        <textarea className="input mono-code" rows={8} value={raw} onChange={(e) => { setRaw(e.target.value); setParsed(null) }} placeholder='{ "title": "…", "sections": [ … ] }' spellCheck={false} />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => check()} disabled={!raw.trim()}>Check form</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { const t = JSON.stringify(SAMPLE_FORM, null, 2); setRaw(t); check(t) }}>Load example</button>
          {replacing && <button className="btn btn-ghost btn-sm" onClick={() => { setReplacing(null); setRaw(''); setParsed(null) }}>Cancel update</button>}
        </div>
        {msg && <p className="note-ok">{msg}</p>}
        {parsed && parsed.errors.length > 0 && (
          <div className="note-err" role="alert">
            <b>Fix these and check again</b>
            <ul>{parsed.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {parsed?.form && (
          <div className="preview">
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div>
                <b style={{ fontSize: 17 }}>{parsed.form.title}</b>
                {parsed.form.description && <p className="small muted">{parsed.form.description}</p>}
              </div>
              <button className="btn btn-lime btn-sm" onClick={() => void publish()}>{replacing ? 'Publish update' : 'Publish'}</button>
            </div>
            {parsed.form.sections.map((s) => (
              <div key={s.title}>
                <p className="preview-sec">{s.title}</p>
                {s.questions.map((q) => (
                  <div key={q.id} className="preview-q">
                    <span className="type-tag">{TYPE_LABEL[q.type]}</span>
                    <span className="grow">{q.label}{q.required ? ' *' : ''}{q.show_if ? <em className="muted"> · if {q.show_if.question} = {String(q.show_if.equals ?? q.show_if.in?.join('/'))}</em> : null}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h2 className="section-title">Published surveys</h2>
        {forms.length === 0 && <p className="empty">None yet. Try “Load example” above to see how it works.</p>}
        {forms.map((f) => (
          <div key={f.id} className="list-row">
            <div className="grow">
              <b>{f.title}</b>
              <p className="small muted">v{f.version} · {flatQuestions(f.definition).length} questions · {counts[f.id] ?? 0} responses · {f.active ? 'Live' : 'Hidden'}</p>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv(f)} disabled={!counts[f.id]}>CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setReplacing(f); const t = JSON.stringify(f.definition, null, 2); setRaw(t); check(t); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void toggle(f)}>{f.active ? 'Hide' : 'Show'}</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'survey'
