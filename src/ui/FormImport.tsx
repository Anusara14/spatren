import { useRef, useState } from 'react'
import { AI_PROMPT, parseForm, SAMPLE_FORM, type FormDef } from '../lib/forms'
import { supabase } from '../lib/supabase'
import type { FormRow } from './FormRunner'

const TYPE_LABEL: Record<string, string> = {
  text: 'Short text', textarea: 'Long text', integer: 'Whole number', decimal: 'Number', select_one: 'One choice',
  select_multiple: 'Multi choice', yes_no: 'Yes / No', rating: '1–5 stars', likert: 'Agree scale', date: 'Date', time: 'Time',
  gps: 'GPS', photo: 'Photo', audio: 'Voice', note: 'Note',
}

const LOCAL_KEY = 'spatren.localForms'

export function localForms(): FormRow[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as FormRow[]
  } catch {
    return []
  }
}

export function removeLocalForm(id: string): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(localForms().filter((f) => f.id !== id)))
}

function saveLocal(def: FormDef): FormRow {
  const row: FormRow = { id: `local-${crypto.randomUUID()}`, title: def.title, version: 1, definition: def }
  localStorage.setItem(LOCAL_KEY, JSON.stringify([row, ...localForms()]))
  return row
}

interface Props {
  isAdmin: boolean
  /** set when an admin is updating an already-published form */
  replacing?: { id: string; title: string; version: number; definition: FormDef } | null
  onDone: (msg: string) => void
  onCancel?: () => void
}

export default function FormImport({ isAdmin, replacing = null, onDone, onCancel }: Props) {
  const [raw, setRaw] = useState(replacing ? JSON.stringify(replacing.definition, null, 2) : '')
  const [parsed, setParsed] = useState<ReturnType<typeof parseForm> | null>(replacing ? parseForm(JSON.stringify(replacing.definition)) : null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const check = (text = raw) => {
    setMsg(null)
    setParsed(parseForm(text))
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(AI_PROMPT)
      setMsg('Prompt copied. Paste it into ChatGPT, Gemini or Claude, describe your survey at the end, then come back and paste the reply.')
    } catch {
      setRaw(AI_PROMPT)
      setMsg('Clipboard blocked, so the prompt is in the box below. Copy it from there.')
    }
  }

  async function pasteJson() {
    try {
      const t = await navigator.clipboard.readText()
      setRaw(t)
      check(t)
    } catch {
      setMsg('Clipboard access blocked. Long-press the box below and choose Paste.')
    }
  }

  async function publish() {
    if (!parsed?.form) return
    setBusy(true)
    const f = parsed.form
    const { error } = replacing
      ? await supabase.from('forms').update({ title: f.title, definition: f, version: replacing.version + 1, updated_at: new Date().toISOString() }).eq('id', replacing.id)
      : await supabase.from('forms').insert({ title: f.title, definition: f })
    setBusy(false)
    if (error) return setMsg(`Couldn't publish: ${navigator.onLine ? error.message : 'you are offline'}. You can save it to this phone instead.`)
    onDone(replacing ? `Updated “${f.title}” to version ${replacing.version + 1}.` : `Published “${f.title}” to everyone's phone.`)
  }

  function keepLocal() {
    if (!parsed?.form) return
    saveLocal(parsed.form)
    onDone(`Saved “${parsed.form.title}” on this phone. Find it under Start new form.`)
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="small muted">
        Ask ChatGPT, Gemini, Claude or any AI to write your survey as JSON. SPATREN turns it into a form with photo, voice and GPS questions.
      </p>
      <ol className="steps">
        <li><button className="link-btn" onClick={() => void copyPrompt()}>Copy the AI prompt</button>, paste it into your AI chat and describe the survey at the end.</li>
        <li>Copy the AI's reply, then <button className="link-btn" onClick={() => void pasteJson()}>paste it here</button> or <button className="link-btn" onClick={() => fileRef.current?.click()}>open a .json file</button>.</li>
        <li>Check the preview, then save it{isAdmin ? ' to this phone or publish it to everyone' : ' to this phone'}.</li>
      </ol>
      <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) void f.text().then((t) => { setRaw(t); check(t) })
        e.target.value = ''
      }} />
      <textarea className="input mono-code" rows={8} value={raw} onChange={(e) => { setRaw(e.target.value); setParsed(null) }} placeholder="Paste the AI's JSON reply here" spellCheck={false} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={() => check()} disabled={!raw.trim()}>Check form</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { const t = JSON.stringify(SAMPLE_FORM, null, 2); setRaw(t); check(t) }}>Load example</button>
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>
      {msg && <p className="note-ok">{msg}</p>}
      {parsed && parsed.errors.length > 0 && (
        <div className="note-err" role="alert">
          <b>Fix these and check again</b>
          <ul>{parsed.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {parsed?.form && parsed.warnings.length > 0 && (
        <div className="note-warn">
          <b>Imported with {parsed.warnings.length} adjustment{parsed.warnings.length > 1 ? 's' : ''}</b>
          <ul>{parsed.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {parsed?.form && (
        <div className="preview">
          <div>
            <b style={{ fontSize: 17 }}>{parsed.form.title}</b>
            {parsed.form.description && <p className="small muted">{parsed.form.description}</p>}
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
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {isAdmin && <button className="btn btn-lime grow" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : replacing ? 'Publish update' : 'Publish to everyone'}</button>}
            {!replacing && <button className={`btn grow ${isAdmin ? 'btn-ghost' : 'btn-lime'}`} onClick={keepLocal}>Save to this phone</button>}
          </div>
        </div>
      )}
    </div>
  )
}
