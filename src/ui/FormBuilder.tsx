import { useMemo, useState } from 'react'
import { finaliseForm as finalise, flatQuestions, LIKERT, parseForm, type FormDef, type Question, type QuestionType, type Section } from '../lib/forms'
import FormRunner from './FormRunner'
import { publishForm, saveLocalForm } from './FormImport'
import { IconBack, IconCamera, IconClose, IconMic, IconTrash } from './icons'

const TYPES: { type: QuestionType; label: string; hint: string }[] = [
  { type: 'text', label: 'Short text', hint: 'A name, a word' },
  { type: 'textarea', label: 'Long text', hint: 'Open answers' },
  { type: 'select_one', label: 'One choice', hint: 'Pick one' },
  { type: 'select_multiple', label: 'Multi choice', hint: 'Pick several' },
  { type: 'yes_no', label: 'Yes / No', hint: 'Two buttons' },
  { type: 'integer', label: 'Whole number', hint: 'Counts, years' },
  { type: 'decimal', label: 'Number', hint: 'Measurements' },
  { type: 'rating', label: 'Stars 1–5', hint: 'Satisfaction' },
  { type: 'likert', label: 'Agree scale', hint: `${LIKERT[0]} … ${LIKERT[4]}` },
  { type: 'gps', label: 'Location', hint: 'GPS tag' },
  { type: 'photo', label: 'Photo', hint: 'Camera' },
  { type: 'audio', label: 'Voice', hint: 'Record audio' },
  { type: 'date', label: 'Date', hint: '' },
  { type: 'time', label: 'Time', hint: '' },
  { type: 'note', label: 'Note', hint: 'Read-only text' },
]
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.type, t.label])) as Record<QuestionType, string>
const CHOICE = new Set<QuestionType>(['select_one', 'select_multiple'])
const NUMBER = new Set<QuestionType>(['integer', 'decimal'])

let seq = 0
const newId = () => `q_${Date.now().toString(36)}${(seq++).toString(36)}`

const blank = (type: QuestionType): Question => ({
  id: newId(),
  type,
  label: '',
  required: type !== 'note' && type !== 'photo' && type !== 'audio',
  options: CHOICE.has(type) ? ['Option 1', 'Option 2'] : undefined,
})

interface Props {
  initial?: FormDef
  isAdmin: boolean
  /** editing a published team form */
  replacing?: { id: string; version: number } | null
  /** editing a form saved on this phone */
  localId?: string
  onDone: (msg: string) => void
  onCancel: () => void
}

export default function FormBuilder({ initial, isAdmin, replacing = null, localId, onDone, onCancel }: Props) {
  const [def, setDef] = useState<FormDef>(
    () => initial ?? { title: '', description: '', sections: [{ title: 'Section 1', questions: [blank('text')] }] },
  )
  const [open, setOpen] = useState<string | null>(def.sections[0]?.questions[0]?.id ?? null)
  const [adding, setAdding] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const all = useMemo(() => flatQuestions(def), [def])

  const setSection = (si: number, fn: (s: Section) => Section) =>
    setDef((d) => ({ ...d, sections: d.sections.map((s, i) => (i === si ? fn(s) : s)) }))
  const setQ = (si: number, qi: number, patch: Partial<Question>) =>
    setSection(si, (s) => ({ ...s, questions: s.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)) }))

  function addQuestion(si: number, type: QuestionType) {
    const q = blank(type)
    setSection(si, (s) => ({ ...s, questions: [...s.questions, q] }))
    setOpen(q.id)
    setAdding(null)
  }

  function move(si: number, qi: number, dir: -1 | 1) {
    setSection(si, (s) => {
      const qs = [...s.questions]
      const j = qi + dir
      if (j < 0 || j >= qs.length) return s
      ;[qs[qi], qs[j]] = [qs[j], qs[qi]]
      return { ...s, questions: qs }
    })
  }

  function remove(si: number, qi: number) {
    const id = def.sections[si].questions[qi].id
    setDef((d) => ({
      ...d,
      sections: d.sections.map((s, i) => ({
        ...s,
        questions: s.questions
          .filter((_, j) => !(i === si && j === qi))
          .map((q) => (q.show_if?.question === id ? { ...q, show_if: undefined } : q)), // drop rules pointing at it
      })),
    }))
  }

  function check(): FormDef | null {
    const f = finalise(def)
    const empty = flatQuestions(f).filter((q) => !q.label).length
    const res = parseForm(JSON.stringify(f))
    const errs = [...(f.title ? [] : ['Give the form a title.']), ...(empty ? [`${empty} question${empty > 1 ? 's have' : ' has'} no text.`] : []), ...res.errors]
    setErrors(errs)
    return errs.length ? null : res.form ?? null
  }

  async function save(where: 'local' | 'publish') {
    const f = check()
    if (!f) return
    if (where === 'local') {
      saveLocalForm(f, localId)
      return onDone(`Saved “${f.title}” on this phone.`)
    }
    setBusy(true)
    const err = await publishForm(f, replacing)
    setBusy(false)
    if (err) return setErrors([`Couldn't publish: ${err}. You can tap Save to keep it on this phone instead.`])
    onDone(replacing ? `Published version ${replacing.version + 1} of “${f.title}”.` : `Published “${f.title}” to everyone's phone.`)
  }

  if (preview) {
    const f = finalise(def)
    return <FormRunner preview form={{ id: `preview-${Date.now()}`, title: f.title || 'Untitled form', version: 0, definition: f }} onClose={() => setPreview(false)} />
  }

  return (
    <div className="stack builder" style={{ gap: 14 }}>
      <header className="kc-sub">
        <button className="glass-btn sm" aria-label="Back" onClick={onCancel}><IconBack /></button>
        <h1 className="grow">{replacing || localId ? 'Edit form' : 'Create form'}</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => setPreview(true)} disabled={!all.length}>Preview</button>
      </header>

      <section className="card stack" style={{ gap: 10 }}>
        <input className="input b-title" placeholder="Form title" value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} />
        <textarea className="input" rows={2} placeholder="Short description for the field team (optional)" value={def.description ?? ''} onChange={(e) => setDef({ ...def, description: e.target.value })} />
      </section>

      {def.sections.map((s, si) => (
        <section key={si} className="stack" style={{ gap: 8 }}>
          <div className="row">
            <input className="input b-section grow" value={s.title} onChange={(e) => setSection(si, (x) => ({ ...x, title: e.target.value }))} aria-label="Section title" />
            {def.sections.length > 1 && (
              <button className="glass-btn sm" aria-label="Delete section" onClick={() => confirm(`Delete “${s.title}” and its questions?`) && setDef((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }))}><IconTrash /></button>
            )}
          </div>

          {s.questions.map((q, qi) => {
            const earlier = all.slice(0, all.findIndex((x) => x.id === q.id)).filter((x) => x.type !== 'note' && x.type !== 'photo' && x.type !== 'audio' && x.type !== 'gps')
            const cond = q.show_if ? all.find((x) => x.id === q.show_if!.question) : undefined
            const condValues = cond ? (cond.type === 'yes_no' ? ['Yes', 'No'] : cond.type === 'likert' ? LIKERT : cond.options ?? null) : null
            const isOpen = open === q.id
            return (
              <div key={q.id} className={`b-q ${isOpen ? 'open' : ''}`}>
                <button className="b-q-head" onClick={() => setOpen(isOpen ? null : q.id)} aria-expanded={isOpen}>
                  <span className="type-tag">{TYPE_LABEL[q.type]}</span>
                  <span className="grow b-q-label">{q.label || <em className="muted">Untitled question</em>}</span>
                  {q.required && <span className="b-req">Must</span>}
                  {q.show_if && <span className="b-req cond">If</span>}
                </button>
                {isOpen && (
                  <div className="b-q-body stack" style={{ gap: 10 }}>
                    <textarea className="input" rows={2} placeholder="Question" value={q.label} onChange={(e) => setQ(si, qi, { label: e.target.value })} autoFocus={!q.label} />
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <select className="input grow" value={q.type} aria-label="Answer type" onChange={(e) => {
                        const type = e.target.value as QuestionType
                        setQ(si, qi, { type, options: CHOICE.has(type) ? q.options ?? ['Option 1', 'Option 2'] : undefined, min: NUMBER.has(type) ? q.min : undefined, max: NUMBER.has(type) ? q.max : undefined })
                      }}>
                        {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </select>
                      {q.type !== 'note' && (
                        <label className="switch">
                          <input type="checkbox" checked={!!q.required} onChange={(e) => setQ(si, qi, { required: e.target.checked })} />
                          <span className="switch-ui" aria-hidden="true" />
                          {q.required ? 'Must answer' : 'Can skip'}
                        </label>
                      )}
                    </div>
                    <input className="input" placeholder="Hint for the interviewer (optional)" value={q.hint ?? ''} onChange={(e) => setQ(si, qi, { hint: e.target.value || undefined })} />

                    {CHOICE.has(q.type) && (
                      <div className="field">
                        <label>Choices, one per line</label>
                        <textarea className="input" rows={Math.max(3, (q.options?.length ?? 2) + 1)} value={(q.options ?? []).join('\n')}
                          onChange={(e) => setQ(si, qi, { options: e.target.value.split('\n') })} />
                      </div>
                    )}
                    {NUMBER.has(q.type) && (
                      <div className="row">
                        <input className="input grow" inputMode="decimal" placeholder="Min (optional)" value={q.min ?? ''} onChange={(e) => setQ(si, qi, { min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                        <input className="input grow" inputMode="decimal" placeholder="Max (optional)" value={q.max ?? ''} onChange={(e) => setQ(si, qi, { max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      </div>
                    )}
                    {(q.type === 'photo' || q.type === 'audio' || q.type === 'gps') && (
                      <p className="small muted row" style={{ gap: 6 }}>
                        {q.type === 'photo' ? <IconCamera width={16} /> : q.type === 'audio' ? <IconMic width={16} /> : null}
                        {q.type === 'photo' ? 'Opens the camera; the photo is compressed and saved offline.' : q.type === 'audio' ? 'Records a voice clip on the phone, saved offline.' : 'Captures GPS with accuracy; can be re-taken.'}
                      </p>
                    )}

                    {earlier.length > 0 && (
                      <div className="field">
                        <label>Show only if</label>
                        <div className="row" style={{ flexWrap: 'wrap' }}>
                          <select className="input grow" value={q.show_if?.question ?? ''} aria-label="Depends on question"
                            onChange={(e) => setQ(si, qi, { show_if: e.target.value ? { question: e.target.value, equals: '' } : undefined })}>
                            <option value="">Always show</option>
                            {earlier.map((x) => <option key={x.id} value={x.id}>{x.label || 'Untitled question'}</option>)}
                          </select>
                          {q.show_if && (condValues ? (
                            <select className="input grow" value={String(q.show_if.equals ?? '')} aria-label="Answer that shows this question"
                              onChange={(e) => setQ(si, qi, { show_if: { question: q.show_if!.question, equals: e.target.value } })}>
                              <option value="" disabled>is…</option>
                              {condValues.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          ) : (
                            <input className="input grow" placeholder="equals…" value={String(q.show_if.equals ?? '')}
                              onChange={(e) => setQ(si, qi, { show_if: { question: q.show_if!.question, equals: e.target.value } })} />
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="row b-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => move(si, qi, -1)} disabled={qi === 0}>Move up</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => move(si, qi, 1)} disabled={qi === s.questions.length - 1}>Move down</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        const copy = { ...q, id: newId(), show_if: q.show_if }
                        setSection(si, (x) => ({ ...x, questions: [...x.questions.slice(0, qi + 1), copy, ...x.questions.slice(qi + 1)] }))
                        setOpen(copy.id)
                      }}>Duplicate</button>
                      <button className="btn btn-ghost btn-sm b-del" onClick={() => remove(si, qi)}><IconTrash width={16} /> Delete</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {adding === si ? (
            <div className="b-add card">
              <div className="row between"><b>Add a question</b><button className="glass-btn sm" aria-label="Close" onClick={() => setAdding(null)}><IconClose /></button></div>
              <div className="b-types">
                {TYPES.map((t) => (
                  <button key={t.type} className="b-type" onClick={() => addQuestion(si, t.type)}>
                    <b>{t.label}</b>
                    {t.hint && <span>{t.hint}</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button className="btn btn-ghost btn-block b-addbtn" onClick={() => setAdding(si)}>+ Add question</button>
          )}
        </section>
      ))}

      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDef((d) => ({ ...d, sections: [...d.sections, { title: `Section ${d.sections.length + 1}`, questions: [] }] }))}>
        + Add section
      </button>

      {errors.length > 0 && (
        <div className="note-err" role="alert">
          <b>Fix these first</b>
          <ul>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <div className="b-save">
        {isAdmin && <button className="btn btn-lime grow" onClick={() => void save('publish')} disabled={busy}>{busy ? 'Publishing…' : replacing ? 'Publish update' : 'Publish'}</button>}
        {!replacing && <button className={`btn grow ${isAdmin ? 'btn-ghost' : 'btn-lime'}`} onClick={() => void save('local')}>Save</button>}
      </div>
    </div>
  )
}
