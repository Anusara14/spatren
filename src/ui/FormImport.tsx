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

export function saveLocalForm(def: FormDef, id?: string): FormRow {
  const existing = id ? localForms().find((f) => f.id === id) : undefined
  const row: FormRow = { id: existing?.id ?? `local-${crypto.randomUUID()}`, title: def.title, version: (existing?.version ?? 0) + 1, definition: def }
  localStorage.setItem(LOCAL_KEY, JSON.stringify([row, ...localForms().filter((f) => f.id !== row.id)]))
  return row
}

/** Publish a new team form, or a new version of an existing one. Returns an error message or null. */
export async function publishForm(def: FormDef, replacing?: { id: string; version: number } | null): Promise<string | null> {
  const { error } = replacing
    ? await supabase.from('forms').update({ title: def.title, definition: def, version: replacing.version + 1, updated_at: new Date().toISOString() }).eq('id', replacing.id)
    : await supabase.from('forms').insert({ title: def.title, definition: def })
  return error ? (navigator.onLine ? error.message : 'you are offline') : null
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
  const xlsRef = useRef<HTMLInputElement>(null)

  // A KoboToolbox / ODK XLSForm, as .xlsx or .xls.
  async function openSheet(file: File) {
    setMsg(null)
    setBusy(true)
    try {
      const { readSheets, xlsformToForm } = await import('../lib/xlsform')
      const res = xlsformToForm(await readSheets(new Uint8Array(await file.arrayBuffer())), file.name.replace(/\.(xlsx|xls)$/i, ''))
      setParsed(res)
      if (res.form) setRaw(JSON.stringify(res.form, null, 2))
    } catch (e) {
      setParsed(null)
      setMsg(`Couldn't read that file: ${e instanceof Error ? e.message : 'unknown error'}. Pick an XLSForm saved as .xlsx or .xls.`)
    } finally {
      setBusy(false)
    }
  }

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
    const error = await publishForm(f, replacing)
    setBusy(false)
    if (error) return setMsg(`Couldn't publish: ${error}. You can tap Save to keep it on this phone instead.`)
    onDone(replacing ? `Updated “${f.title}” to version ${replacing.version + 1}.` : `Published “${f.title}” to everyone's phone.`)
  }

  function keepLocal() {
    if (!parsed?.form) return
    saveLocalForm(parsed.form)
    onDone(`Saved “${parsed.form.title}” on this phone. Find it under Fill a form.`)
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card-flat stack" style={{ gap: 8 }}>
        <b>From Excel (KoboToolbox XLSForm)</b>
        <p className="small muted">
          Pick a form made for KoboToolbox or ODK, as <b>.xlsx</b> or <b>.xls</b>, with <i>survey</i> and <i>choices</i> sheets. Choice lists, groups, required
          questions, simple skip logic and number limits come across.
        </p>
        <input ref={xlsRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void openSheet(f)
          e.target.value = ''
        }} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => xlsRef.current?.click()}>{busy ? 'Reading…' : 'Choose Excel form…'}</button>
      </section>
      <p className="small muted">
        Or ask ChatGPT, Gemini, Claude or any AI to write your survey as JSON. SPATREN turns it into a form with photo, voice and GPS questions.
      </p>
      <ol className="steps">
        <li><button className="link-btn" onClick={() => void copyPrompt()}>Copy the AI prompt</button>, paste it into your AI chat and describe the survey at the end.</li>
        <li>Copy the AI's reply, then <button className="link-btn" onClick={() => void pasteJson()}>paste it here</button> or <button className="link-btn" onClick={() => fileRef.current?.click()}>open a .json file</button>.</li>
        <li>Check the preview, then tap {isAdmin ? <><b>Save</b> (this phone) or <b>Publish</b> (everyone)</> : <><b>Save</b></>}.</li>
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
            {isAdmin && <button className="btn btn-lime grow" onClick={() => void publish()} disabled={busy}>{busy ? 'Publishing…' : replacing ? 'Publish update' : 'Publish'}</button>}
            {!replacing && <button className={`btn grow ${isAdmin ? 'btn-ghost' : 'btn-lime'}`} onClick={keepLocal}>Save</button>}
          </div>
        </div>
      )}
    </div>
  )
}
