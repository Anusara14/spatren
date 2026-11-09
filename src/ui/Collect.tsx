import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { flatQuestions, type FormDef } from '../lib/forms'
import { supabase } from '../lib/supabase'
import { useOutbox } from '../lib/sync'
import Capture from './Capture'
import FormRunner, { type FormRow } from './FormRunner'
import { IconChevrons, IconPlus } from './icons'

const FORMS_CACHE = 'spatren.forms'

function cachedForms(): FormRow[] {
  try {
    return JSON.parse(localStorage.getItem(FORMS_CACHE) ?? '[]') as FormRow[]
  } catch {
    return []
  }
}

export default function Collect() {
  const [forms, setForms] = useState<FormRow[]>(cachedForms)
  const [open, setOpen] = useState<FormRow | null>(null)
  const [quick, setQuick] = useState(false)
  const [mine, setMine] = useState<Record<string, number>>({})
  const [toast, setToast] = useState<string | null>(null)
  const outbox = useOutbox()

  useEffect(() => {
    // Forms are cached so surveys can be started with no signal.
    const load = () =>
      void supabase
        .from('forms')
        .select('id,title,version,definition')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (!data) return
          setForms(data as FormRow[])
          localStorage.setItem(FORMS_CACHE, JSON.stringify(data))
        })
    load()
    const ch = supabase.channel('forms-live').on('postgres_changes', { event: '*', schema: 'public', table: 'forms' }, load).subscribe()
    return () => void supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    const sub = liveQuery(() => db.records.toArray()).subscribe({
      next: (rs) => {
        const c: Record<string, number> = {}
        for (const r of rs) if (r.kind === 'survey') c[String(r.data.form_id)] = (c[String(r.data.form_id)] ?? 0) + 1
        setMine(c)
      },
    })
    return () => sub.unsubscribe()
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(id)
  }, [toast])

  if (open)
    return (
      <FormRunner
        form={open}
        onClose={(saved) => {
          setOpen(null)
          if (saved) setToast(navigator.onLine ? 'Response saved. Uploading…' : 'Response saved on this phone. It uploads when you are online.')
        }}
      />
    )
  if (quick) return <Capture onBack={() => setQuick(false)} />

  return (
    <div className="stack" style={{ gap: 18 }}>
      {toast && <div className="toast">{toast}</div>}
      <header className="row between">
        <h1 className="page-title">Collect</h1>
        {outbox.records > 0 && <span className="chip">{outbox.records} waiting to upload</span>}
      </header>

      <section className="stack" style={{ gap: 10 }}>
        <h2 className="section-title">Surveys</h2>
        {forms.length === 0 && (
          <p className="empty">No surveys yet. Your coordinator publishes them from Admin → Forms, and they appear here automatically.</p>
        )}
        {forms.map((f) => {
          const n = flatQuestions(f.definition as FormDef).length
          const draft = localStorage.getItem(`spatren.draft.${f.id}`)
          const hasDraft = !!draft && draft !== '{}'
          return (
            <button key={f.id} className="form-card" onClick={() => setOpen(f)}>
              <div className="grow">
                <b>{f.title}</b>
                {f.definition.description && <p className="small muted">{f.definition.description}</p>}
                <p className="form-card-meta">
                  {n} questions · {mine[f.id] ?? 0} done on this phone{hasDraft ? ' · draft saved' : ''}
                </p>
              </div>
              <span className="form-card-go"><IconChevrons width={20} /></span>
            </button>
          )
        })}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h2 className="section-title">Quick capture</h2>
        <button className="form-card quick" onClick={() => setQuick(true)}>
          <span className="quick-icon"><IconPlus width={24} /></span>
          <div className="grow">
            <b>Observation, interview or note</b>
            <p className="small muted">Photo, voice, GPS and notes, without a survey.</p>
          </div>
        </button>
      </section>
    </div>
  )
}
