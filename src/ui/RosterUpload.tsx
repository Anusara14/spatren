import { useRef, useState } from 'react'
import { groupsOf } from '../lib/geo'
import { readRosterFile, type RosterParse } from '../lib/roster'
import { friendlyError, supabase } from '../lib/supabase'

interface Result {
  added: number
  updated: number
  clash: string[]
  invalid: string[]
}

/** Pick a class list (.xlsx or .csv), check it, then add it to a batch. Nothing is saved until "Add". */
export default function RosterUpload({ batchId, batchName, onDone }: { batchId: string; batchName: string; onDone?: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<(RosterParse & { file: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setErr(null)
    setResult(null)
    try {
      setParsed({ ...(await readRosterFile(file)), file: file.name })
    } catch (e) {
      setParsed(null)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  async function add() {
    if (!parsed?.rows.length) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('import_roster', { p_batch: batchId, p_rows: parsed.rows })
    setBusy(false)
    if (error) return setErr(friendlyError(error, 'add the class list'))
    setResult(data as Result)
    setParsed(null)
    onDone?.()
  }

  const groups = parsed ? groupsOf(parsed.rows) : []
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">
        Pick the class list as an Excel (.xlsx) or CSV file with columns like <b>Index No.</b>, <b>Name</b>, and optionally <b>Group</b>, <b>Topic</b>,{' '}
        <b>Elective</b> and <b>Role</b> (leader / admin). Merged Group and Topic cells are fine. Students already in the list are updated, never removed.
      </p>
      <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>Choose class list…</button>

      {parsed && (
        <div className="card-flat stack" style={{ gap: 8 }}>
          <b>{parsed.file}</b>
          <p className="small">
            {parsed.rows.length} students · {groups.length ? `${groups.length} groups (${groups.join(', ')})` : 'no groups'} ·{' '}
            {parsed.rows.filter((r) => r.is_leader).length} leaders · {parsed.rows.filter((r) => r.is_admin).length} admins
          </p>
          <p className="tiny muted">
            Read columns: {Object.entries(parsed.columns).filter(([, v]) => v).map(([k, v]) => `${v} → ${k.replace('_', ' ')}`).join(' · ')}
          </p>
          {parsed.problems.length > 0 && (
            <details>
              <summary className="small" style={{ color: 'var(--danger)' }}>{parsed.problems.length} row{parsed.problems.length === 1 ? '' : 's'} skipped</summary>
              <ul className="tiny">{parsed.problems.slice(0, 30).map((p) => <li key={p}>{p}</li>)}</ul>
            </details>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost grow" onClick={() => setParsed(null)}>Cancel</button>
            <button type="button" className="btn btn-lime grow" disabled={busy || !parsed.rows.length} onClick={() => void add()}>
              {busy ? 'Adding…' : `Add ${parsed.rows.length} to ${batchName}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="small" role="status">
          Added {result.added}, updated {result.updated}.
          {result.clash.length > 0 && ` ${result.clash.length} already belong to another batch and were skipped (${result.clash.slice(0, 5).join(', ')}${result.clash.length > 5 ? '…' : ''}).`}
          {result.invalid.length > 0 && ` ${result.invalid.length} had an invalid index.`}
        </p>
      )}
      {err && <p className="note-err" role="alert">{err}</p>}
    </div>
  )
}
