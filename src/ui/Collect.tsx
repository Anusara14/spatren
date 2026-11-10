import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { db, type LocalRecord } from '../lib/db'
import { flatQuestions } from '../lib/forms'
import { clock } from '../lib/geo'
import { supabase } from '../lib/supabase'
import { syncNow, useOnline } from '../lib/sync'
import Capture from './Capture'
import OpenInterview from './OpenInterview'
import FormBuilder from './FormBuilder'
import Transfer from './Transfer'
import FormImport, { localForms, removeLocalForm } from './FormImport'
import FormRunner, { type FormRow } from './FormRunner'
import { IconBack, IconCheckCircle, IconChevrons, IconDownload, IconFilePlus, IconFormEdit, IconMic, IconNote, IconPencil, IconTrash, IconUpload, IconUsers } from './icons'
import { Mark } from './Theme'

const FORMS_CACHE = 'spatren.forms'
const draftKey = (id: string) => `spatren.draft.${id}`
type View = 'home' | 'start' | 'drafts' | 'ready' | 'sent' | 'import' | 'quick' | 'build' | 'transfer' | 'interview'

function cachedForms(): FormRow[] {
  try {
    return JSON.parse(localStorage.getItem(FORMS_CACHE) ?? '[]') as FormRow[]
  } catch {
    return []
  }
}

function hasDraft(id: string): boolean {
  const d = localStorage.getItem(draftKey(id))
  return !!d && d !== '{}'
}

// KoboCollect-style hub: Start new form · Drafts · Ready to send · Sent · Import form · Quick note.
export default function Collect({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<View>('home')
  const [published, setPublished] = useState<FormRow[]>(cachedForms)
  const [local, setLocal] = useState<FormRow[]>(localForms)
  const [open, setOpen] = useState<FormRow | null>(null)
  const [records, setRecords] = useState<LocalRecord[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState<FormRow | null>(null)
  const online = useOnline()

  useEffect(() => {
    // Published forms are cached so surveys start with no signal.
    const load = () =>
      void supabase
        .from('forms')
        .select('id,title,version,definition')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (!data) return
          setPublished(data as FormRow[])
          localStorage.setItem(FORMS_CACHE, JSON.stringify(data))
        })
    load()
    const ch = supabase.channel('forms-live').on('postgres_changes', { event: '*', schema: 'public', table: 'forms' }, load).subscribe()
    return () => void supabase.removeChannel(ch)
  }, [])

  useEffect(() => {
    const sub = liveQuery(() => db.records.orderBy('recorded_at').reverse().toArray()).subscribe({ next: setRecords })
    return () => sub.unsubscribe()
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const forms = useMemo(() => [...published, ...local], [published, local])
  const drafts = forms.filter((f) => hasDraft(f.id))
  const ready = records.filter((r) => !r.synced)
  const sent = records.filter((r) => r.synced)
  const untransferred = records.filter((r) => !r.exported && r.media.some((m) => m.type.startsWith('audio'))).length
  const formTitle = (r: LocalRecord) => (r.kind === 'survey' ? String(r.data.form_title ?? 'Survey') : r.kind[0].toUpperCase() + r.kind.slice(1))

  async function sendAll() {
    setSending(true)
    const res = await syncNow()
    setSending(false)
    setToast(res.ok ? 'All sent.' : `Not sent: ${res.error ?? 'try again'}`)
  }

  if (open)
    return (
      <FormRunner
        form={open}
        onClose={(saved) => {
          setOpen(null)
          if (saved) setToast(online ? 'Finalised. Sending…' : 'Finalised and saved on this phone. It sends when you are online.')
        }}
      />
    )
  if (view === 'quick') return <Capture onBack={() => setView('home')} />
  if (view === 'interview') return <><OpenInterview onBack={() => setView('home')} onToast={setToast} />{toast && <div className="toast">{toast}</div>}</>
  if (view === 'transfer') return <><Transfer records={records} onBack={() => setView('home')} onToast={setToast} />{toast && <div className="toast">{toast}</div>}</>
  if (view === 'build')
    return (
      <FormBuilder
        isAdmin={isAdmin}
        initial={editing?.definition}
        localId={editing?.id}
        onCancel={() => { setEditing(null); setView(editing ? 'start' : 'home') }}
        onDone={(m) => { setToast(m); setEditing(null); setLocal(localForms()); setView('start') }}
      />
    )

  const back = (title: string, extra?: ReactNode) => (
    <header className="kc-sub">
      <button className="glass-btn sm" aria-label="Back to Collect" onClick={() => setView('home')}><IconBack /></button>
      <h1 className="grow">{title}</h1>
      {extra}
    </header>
  )

  return (
    <div className="stack" style={{ gap: 16 }}>
      {toast && <div className="toast">{toast}</div>}

      {view === 'home' && (
        <>
          <header className="kc-head">
            <Mark size={44} />
            <div className="grow">
              <h1>SPATREN Collect</h1>
            </div>
            <span className={`chip ${online ? 'chip-lime' : ''}`}><span className={`dot ${online ? 'live' : 'offline'}`} />{online ? 'Online' : 'Offline'}</span>
          </header>

          <nav className="kc-menu" aria-label="Collect">
            <MenuItem icon={<IconFilePlus />} title="Fill a form" sub={forms.length ? `${forms.length} ready` : 'None yet'} onClick={() => setView('start')} accent />
            <MenuItem icon={<IconFormEdit />} title="Create form" sub="Make your own" onClick={() => { setEditing(null); setView('build') }} />
            <MenuItem icon={<IconPencil />} title="Drafts" sub="Not finished yet" count={drafts.length} onClick={() => setView('drafts')} />
            <MenuItem icon={<IconUpload />} title="Ready to send" sub={ready.length ? 'Waiting for signal' : 'Nothing waiting'} count={ready.length} warn={ready.length > 0} onClick={() => setView('ready')} />
            <MenuItem icon={<IconMic />} title="Send recordings" sub={untransferred ? 'To the group laptop' : 'Nothing new'} count={untransferred} warn={untransferred > 0} onClick={() => setView('transfer')} />
            <MenuItem icon={<IconCheckCircle />} title="Sent" sub="Uploaded" count={sent.length} onClick={() => setView('sent')} />
            <MenuItem icon={<IconDownload />} title="Import form" sub="From AI or a file" onClick={() => setView('import')} />
            <MenuItem icon={<IconUsers />} title="Open interview" sub="Voice + AI follow-ups" onClick={() => setView('interview')} />
            <MenuItem icon={<IconNote />} title="Quick note" sub="Photo, voice or text" onClick={() => setView('quick')} />
          </nav>

        </>
      )}

      {view === 'start' && (
        <>
          {back('Fill a form')}
          {forms.length === 0 && <p className="empty">No forms yet. Use Import form, or wait for the admin to publish one. Published forms appear here automatically.</p>}
          {forms.map((f) => (
            <div key={f.id} className="kc-row">
              <button className="kc-row-main" onClick={() => setOpen(f)}>
                <b>{f.title}</b>
                <span>
                  {flatQuestions(f.definition).length} questions · {f.id.startsWith('local-') ? 'On this phone only' : `Team form v${f.version}`}
                  {hasDraft(f.id) ? ' · draft saved' : ''}
                </span>
              </button>
              {f.id.startsWith('local-') && (
                <button className="glass-btn sm" aria-label={`Edit ${f.title}`} onClick={() => { setEditing(f); setView('build') }}><IconPencil /></button>
              )}
              {f.id.startsWith('local-') && (
                <button className="glass-btn sm" aria-label={`Delete ${f.title} from this phone`} onClick={() => {
                  if (!confirm(`Remove “${f.title}” from this phone? Responses already finalised are kept.`)) return
                  removeLocalForm(f.id)
                  localStorage.removeItem(draftKey(f.id))
                  setLocal(localForms())
                }}><IconTrash /></button>
              )}
              <span className="form-card-go" aria-hidden="true"><IconChevrons width={18} /></span>
            </div>
          ))}
        </>
      )}

      {view === 'drafts' && (
        <>
          {back('Drafts')}
          {drafts.length === 0 && <p className="empty">No drafts. If you leave a form before finalising it, your answers wait here.</p>}
          {drafts.map((f) => (
            <div key={f.id} className="kc-row">
              <button className="kc-row-main" onClick={() => setOpen(f)}>
                <b>{f.title}</b>
                <span>Tap to continue. Photos and recordings from an unfinished form need to be taken again.</span>
              </button>
              <button className="glass-btn sm" aria-label={`Discard draft of ${f.title}`} onClick={() => {
                if (!confirm(`Discard your unfinished answers for “${f.title}”?`)) return
                localStorage.removeItem(draftKey(f.id))
                setLocal(localForms())
              }}><IconTrash /></button>
            </div>
          ))}
        </>
      )}

      {view === 'ready' && (
        <>
          {back('Ready to send', <button className="btn btn-lime btn-sm" onClick={() => void sendAll()} disabled={!online || sending || !ready.length}>{sending ? 'Sending…' : 'Send all'}</button>)}
          {!online && ready.length > 0 && <p className="note-warn">You are offline. Everything here is safe on this phone and sends automatically when you are back online.</p>}
          {localStorage.getItem('spatren.syncError') && ready.length > 0 && online && <p className="note-err">Last attempt: {localStorage.getItem('spatren.syncError')}</p>}
          {ready.length === 0 && <p className="empty">Nothing waiting. Everything has been sent.</p>}
          <RecordList records={ready} formTitle={formTitle} />
        </>
      )}

      {view === 'sent' && (
        <>
          {back('Sent')}
          {sent.length === 0 && <p className="empty">Nothing sent from this phone yet.</p>}
          <RecordList records={sent.slice(0, 100)} formTitle={formTitle} />
        </>
      )}

      {view === 'import' && (
        <>
          {back('Import form')}
          <section className="card">
            <FormImport isAdmin={isAdmin} onDone={(m) => { setToast(m); setLocal(localForms()); setView('start') }} />
          </section>
        </>
      )}
    </div>
  )
}

interface MenuItemProps {
  icon: ReactNode
  title: string
  sub: string
  count?: number
  accent?: boolean
  warn?: boolean
  onClick: () => void
}

function MenuItem({ icon, title, sub, count, accent, warn, onClick }: MenuItemProps) {
  return (
    <button className={`kc-item ${accent ? 'accent' : ''}`} onClick={onClick}>
      <span className="kc-icon">{icon}</span>
      <span className="grow">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      {count != null && count > 0 && <span className={`kc-count ${warn ? 'warn' : ''}`}>{count}</span>}
      <IconChevrons width={18} className="kc-chev" />
    </button>
  )
}

function RecordList({ records, formTitle }: { records: LocalRecord[]; formTitle: (r: LocalRecord) => string }) {
  return (
    <div className="people">
      {records.map((r) => (
        <div key={r.id} className="person-row">
          <div className="grow">
            <b>{r.title && r.title !== formTitle(r) ? r.title : formTitle(r)}</b>
            <p className="small muted tnum">
              {formTitle(r)} · {new Date(r.recorded_at).toLocaleDateString([], { day: 'numeric', month: 'short' })} {clock(r.recorded_at)} · {r.media.length} file{r.media.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
