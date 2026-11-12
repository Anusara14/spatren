import { useState } from 'react'
import { cachedProfile } from '../lib/batch'
import { flatQuestions, type FormDef } from '../lib/forms'
import { friendlyError, nameOf, supabase } from '../lib/supabase'
import { csvCell, download } from './export'
import { IconClose } from './icons'

export type ShareScope = 'group' | 'people'

/** Index numbers typed or pasted any way (commas, spaces, new lines), cleaned and de-duplicated. */
export function parseIndexList(text: string): { ok: string[]; bad: string[] } {
  const parts = text.toUpperCase().split(/[\s,;]+/).filter(Boolean)
  const ok = [...new Set(parts.filter((p) => /^[A-Z0-9]{3,20}$/.test(p)))]
  const bad = parts.filter((p) => !/^[A-Z0-9]{3,20}$/.test(p))
  return { ok: ok.slice(0, 200), bad }
}

interface ShareProps {
  def: FormDef
  onShared: (newId: string) => void
  onClose: () => void
}

/**
 * Share a form made on this phone, like a KoboToolbox project: with my group, or with chosen classmates by index
 * number. It then appears on their phones under Fill a form, and their answers come back to me (Responses).
 */
export function ShareFormSheet({ def, onShared, onClose }: ShareProps) {
  const me = cachedProfile()
  const [scope, setScope] = useState<ShareScope>(me?.grp ? 'group' : 'people')
  const [people, setPeople] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const list = parseIndexList(people)

  async function share() {
    setErr(null)
    if (scope === 'people' && !list.ok.length) return setErr('Type at least one index number, e.g. 242353N.')
    setBusy(true)
    const { data, error } = await supabase
      .from('forms')
      .insert({
        title: def.title,
        definition: def,
        scope,
        target_group: scope === 'group' ? me?.grp : null,
        shared_with: scope === 'people' ? list.ok : [],
        owner_name: me ? nameOf(me) : null,
      })
      .select('id')
      .single()
    setBusy(false)
    if (error || !data) return setErr(friendlyError(error, 'share the form'))
    onShared((data as { id: string }).id)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share form">
        <div className="row between">
          <h2 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>Share “{def.title}”</h2>
          <button className="glass-btn sm" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>
        <p className="small muted">{flatQuestions(def).length} questions. It appears under Fill a form on their phones, and you can download their answers here.</p>
        <div className="segmented" role="radiogroup" aria-label="Share with">
          <button role="radio" aria-checked={scope === 'group'} aria-pressed={scope === 'group'} disabled={!me?.grp} onClick={() => setScope('group')}>
            My group{me?.grp ? ` · ${me.grp}` : ''}
          </button>
          <button role="radio" aria-checked={scope === 'people'} aria-pressed={scope === 'people'} onClick={() => setScope('people')}>Chosen classmates</button>
        </div>
        {scope === 'people' && (
          <div className="field">
            <label htmlFor="share-idx">Their index numbers</label>
            <textarea id="share-idx" className="input tnum" rows={3} value={people} onChange={(e) => setPeople(e.target.value)} placeholder="242353N, 242304R" />
            <p className="tiny muted">
              {list.ok.length} classmate{list.ok.length === 1 ? '' : 's'}
              {list.bad.length ? ` · not index numbers: ${list.bad.slice(0, 5).join(', ')}` : ''}
            </p>
          </div>
        )}
        {err && <p className="note-err" role="alert">{err}</p>}
        <button className="btn btn-lime btn-block" disabled={busy || !navigator.onLine} onClick={() => void share()}>
          {busy ? 'Sharing…' : !navigator.onLine ? 'Connect to the internet to share' : 'Share form'}
        </button>
      </div>
    </div>
  )
}

interface ResponseRow {
  id: string
  recorded_at: string
  index_no: string
  full_name: string
  nickname: string | null
  grp: string | null
  subgroup: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  data: { answers?: Record<string, unknown>; form_version?: number; started_at?: string; submitted_at?: string }
}

/** Download everyone's answers to a form I shared, as CSV (opens in Excel; Sinhala kept). Returns a message. */
export async function downloadResponses(form: { id: string; title: string; definition: FormDef }): Promise<string> {
  const { data, error } = await supabase.rpc('form_responses', { p_form: form.id })
  if (error) return friendlyError(error, 'download the responses')
  const rows = (data ?? []) as ResponseRow[]
  if (!rows.length) return 'No responses yet. They appear once classmates submit and their phones are online.'
  const qs = flatQuestions(form.definition).filter((q) => q.type !== 'note')
  const head = ['submitted', 'started', 'index_no', 'name', 'nickname', 'group', 'subgroup', 'lat', 'lng', 'accuracy_m', ...qs.map((q) => q.id)]
  const fmt = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'object' && 'lat' in (v as object) ? `${(v as { lat: number }).lat}, ${(v as { lng: number }).lng}` : String(v))
  const lines = rows.map((r) =>
    [r.data.submitted_at ?? r.recorded_at, r.data.started_at, r.index_no, r.full_name, r.nickname, r.grp, r.subgroup, r.lat, r.lng, r.accuracy, ...qs.map((q) => fmt(r.data.answers?.[q.id]))]
      .map(csvCell)
      .join(','),
  )
  const labels = ['', '', '', '', '', '', '', '', '', '', ...qs.map((q) => q.label)].map(csvCell).join(',')
  const slug = form.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'form'
  download(`${slug}-responses.csv`, '﻿' + [head.join(','), labels, ...lines].join('\n'), 'text/csv')
  return `${rows.length} response${rows.length === 1 ? '' : 's'} downloaded.`
}
