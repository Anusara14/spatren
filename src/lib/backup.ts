// Never lose collected data, even if the app is deleted and installed again.
//
// 1. Android app: every record saved (survey, note, observation, experience, open interview, with its photos and
//    recordings) is also written as one file to the phone's Documents/SPATREN folder, which stays when the app is
//    uninstalled. Forms made on the phone and unfinished drafts go to Documents/SPATREN/forms.spatren-forms.
// 2. Everyone: a full backup file (all records + recordings + forms) to keep in Files / Drive / the laptop.
// 3. Restore: from those files (Profile → Backup & restore), and from the cloud (everything that was uploaded,
//    photos included) automatically when a phone with no records signs in.
// A record is a small ZIP: record.json plus its media files. Restoring never overwrites a record that has more files.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { db, type LocalMedia, type LocalRecord } from './db.ts'
import { IS_NATIVE } from './native.ts'

const FOLDER = 'SPATREN'
const FORMS_FILE = `${FOLDER}/forms.spatren-forms`
const LAST_KEY = 'spatren.backup.last'
const FORMS_KEYS = /^spatren\.(localForms|draft\..+)$/

type RecordMeta = Omit<LocalRecord, 'media'> & { media: { name: string; type: string; uploaded?: string }[] }

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)
const stamp = (iso: string) => iso.slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
export const backupName = (r: LocalRecord) => `${stamp(r.recorded_at)}_${r.kind}_${r.id}.spatren`

async function bundle(r: LocalRecord): Promise<Uint8Array> {
  const files: Zippable = {}
  const meta: RecordMeta = { ...r, media: r.media.map((m) => ({ name: m.name, type: m.type, uploaded: m.uploaded })) }
  files['record.json'] = [strToU8(JSON.stringify(meta)), { level: 6 }]
  for (const m of r.media) if (m.blob?.size) files[`media/${safe(m.name)}`] = [new Uint8Array(await m.blob.arrayBuffer()), { level: 0 }]
  return zipSync(files)
}

function unbundle(bytes: Uint8Array): LocalRecord | null {
  const files = unzipSync(bytes)
  if (!files['record.json']) return null
  const meta = JSON.parse(strFromU8(files['record.json'])) as RecordMeta
  if (!meta?.id || !meta.recorded_at || !Array.isArray(meta.media)) return null
  const media: LocalMedia[] = meta.media.flatMap((m) => {
    const data = files[`media/${safe(m.name)}`]
    return data ? [{ name: m.name, type: m.type, uploaded: m.uploaded, blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: m.type }) }] : []
  })
  return { ...meta, media }
}

// ---------- Android: automatic copy in Documents/SPATREN ----------

const toBase64 = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function writeDoc(path: string, bytes: Uint8Array): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  await Filesystem.writeFile({ path, data: toBase64(bytes), directory: Directory.Documents, recursive: true })
}

let permissionAsked = false
async function canWriteDocuments(): Promise<boolean> {
  if (!IS_NATIVE) return false
  try {
    const { Filesystem } = await import('@capacitor/filesystem')
    const p = await Filesystem.checkPermissions()
    if (p.publicStorage === 'granted') return true
    if (permissionAsked) return false
    permissionAsked = true
    return (await Filesystem.requestPermissions()).publicStorage === 'granted'
  } catch {
    return false
  }
}

/** Write one record's backup file now (Android). Returns false if the phone refused. */
export async function backupRecord(id: string): Promise<boolean> {
  if (!(await canWriteDocuments())) return false
  const r = await db.records.get(id)
  if (!r) return false
  try {
    await writeDoc(`${FOLDER}/${backupName(r)}`, await bundle(r))
    localStorage.setItem(LAST_KEY, new Date().toISOString())
    return true
  } catch {
    return false
  }
}

export async function backupForms(): Promise<void> {
  if (!(await canWriteDocuments())) return
  try {
    await writeDoc(FORMS_FILE, strToU8(JSON.stringify(formsAndDrafts())))
  } catch {
    /* next save tries again */
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const schedule = (id: string) => {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    void backupRecord(id)
  }, 1500))
}

/**
 * Back up every record as it is saved or edited (Android). Upload bookkeeping (synced flag, storage paths) doesn't
 * trigger a rewrite, so a long interview isn't copied again just because it was uploaded.
 */
export function installAutoBackup(): void {
  if (!IS_NATIVE) return
  db.records.hook('creating', function (key) {
    this.onsuccess = () => schedule(String(key))
  })
  db.records.hook('updating', function (mods, key) {
    if (Object.keys(mods).every((k) => k === 'synced' || k === 'exported' || k.startsWith('media'))) return
    this.onsuccess = () => schedule(String(key))
  })
  // Forms made on the phone and drafts: back up whenever they change.
  let lastForms = ''
  setInterval(() => {
    const now = JSON.stringify(formsAndDrafts())
    if (now !== lastForms) {
      lastForms = now
      void backupForms()
    }
  }, 20_000)
}

/** Back up everything on the phone now (first run, or after a restore). Returns how many records were written. */
export async function backupAllToDocuments(onProgress?: (done: number, total: number) => void): Promise<number> {
  if (!(await canWriteDocuments())) return 0
  const ids = (await db.records.toCollection().primaryKeys()) as string[]
  let n = 0
  for (const id of ids) {
    if (await backupRecord(id)) n++
    onProgress?.(n, ids.length)
  }
  await backupForms()
  return n
}

// ---------- Full backup file (everyone) ----------

function formsAndDrafts(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (FORMS_KEYS.test(k)) out[k] = localStorage.getItem(k) ?? ''
    }
  } catch {
    /* storage blocked */
  }
  return out
}

/** One file with every record on this phone (recordings and photos inside) plus forms and drafts. */
export async function fullBackup(): Promise<{ bytes: Uint8Array; fileName: string; records: number }> {
  const recs = await db.records.toArray()
  const files: Zippable = { 'forms.json': [strToU8(JSON.stringify(formsAndDrafts())), { level: 6 }] }
  for (const r of recs) files[`records/${backupName(r)}`] = [await bundle(r), { level: 0 }]
  const name = `spatren-backup-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.zip`
  return { bytes: zipSync(files), fileName: name, records: recs.length }
}

// ---------- Restore ----------

export interface RestoreResult {
  added: number
  updated: number
  skipped: number
  forms: number
  bad: string[]
}

/** Keep the copy with more files (e.g. a recording restored from a backup file beats a cloud copy without audio). */
async function merge(r: LocalRecord, res: RestoreResult): Promise<void> {
  const have = await db.records.get(r.id)
  if (!have) {
    await db.records.add(r)
    res.added++
  } else if (r.media.filter((m) => m.blob?.size).length > have.media.filter((m) => m.blob?.size).length) {
    await db.records.put({ ...r, synced: have.synced })
    res.updated++
  } else res.skipped++
}

function restoreForms(json: string, res: RestoreResult): void {
  const items = JSON.parse(json) as Record<string, string>
  for (const [k, v] of Object.entries(items)) {
    if (!FORMS_KEYS.test(k) || typeof v !== 'string') continue
    if (k === 'spatren.localForms') {
      // Merge form lists by id, keeping what's already on the phone.
      const mine = JSON.parse(localStorage.getItem(k) ?? '[]') as { id: string }[]
      const theirs = JSON.parse(v) as { id: string }[]
      const merged = [...mine, ...theirs.filter((f) => !mine.some((m) => m.id === f.id))]
      res.forms += merged.length - mine.length
      localStorage.setItem(k, JSON.stringify(merged))
    } else if (!localStorage.getItem(k)) localStorage.setItem(k, v)
  }
}

/** Restore from files the student picks: .spatren record files, a full backup .zip, or forms.spatren-forms. */
export async function restoreFromFiles(files: File[]): Promise<RestoreResult> {
  const res: RestoreResult = { added: 0, updated: 0, skipped: 0, forms: 0, bad: [] }
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (/\.spatren-forms$/i.test(f.name)) {
        restoreForms(strFromU8(bytes), res)
        continue
      }
      const zip = unzipSync(bytes)
      if (zip['record.json']) {
        const r = unbundle(bytes)
        if (r) await merge(r, res)
        else res.bad.push(f.name)
        continue
      }
      // Full backup: records/*.spatren + forms.json
      let any = false
      for (const [name, data] of Object.entries(zip)) {
        if (name.startsWith('records/') && name.endsWith('.spatren')) {
          const r = unbundle(data)
          if (r) {
            await merge(r, res)
            any = true
          }
        } else if (name === 'forms.json') {
          restoreForms(strFromU8(data), res)
          any = true
        }
      }
      if (!any) res.bad.push(f.name)
    } catch {
      res.bad.push(f.name)
    }
  }
  return res
}

interface CloudRow {
  id: string
  kind: LocalRecord['kind']
  category: string | null
  title: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  recorded_at: string
  media: { path: string; type: string }[] | null
  data: Record<string, unknown> | null
}

/**
 * Everything this student uploaded, back onto the phone: records with their photos. Recordings were never uploaded
 * (they stay on phones), so those come back from a backup file instead; the record itself returns either way.
 */
export async function restoreFromCloud(onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const { supabase } = await import('./supabase')
  const res: RestoreResult = { added: 0, updated: 0, skipped: 0, forms: 0, bad: [] }
  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user.id
  if (!uid) throw new Error('Sign in first.')
  const rows: CloudRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('records').select('id,kind,category,title,notes,lat,lng,accuracy,recorded_at,media,data')
      .eq('user_id', uid).order('recorded_at').range(from, from + 499)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as CloudRow[]))
    if (!data || data.length < 500) break
  }
  let done = 0
  for (const row of rows) {
    done++
    onProgress?.(done, rows.length)
    if (await db.records.get(row.id)) {
      res.skipped++
      continue
    }
    const media: LocalMedia[] = []
    for (const m of row.media ?? []) {
      if (!m.path || m.path.startsWith('device://')) continue
      const { data: blob } = await supabase.storage.from('media').download(m.path)
      if (blob) media.push({ name: m.path.split('/').pop() ?? 'file', type: m.type, blob, uploaded: m.path })
    }
    await db.records.add({
      id: row.id, kind: row.kind, category: row.category ?? '', title: row.title ?? '', notes: row.notes ?? '',
      lat: row.lat, lng: row.lng, accuracy: row.accuracy, recorded_at: row.recorded_at, media,
      data: { ...(row.data ?? {}), ...(row.media?.some((m) => m.path?.startsWith('device://')) ? { audio_on_backup: true } : {}) },
      synced: 1,
    })
    res.added++
  }
  return res
}

export const lastBackup = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

const FIRST_COPY_KEY = 'spatren.backup.firstCopy'
const CLOUD_RESTORE_KEY = 'spatren.backup.cloudRestored'

/**
 * After sign-in: a phone with no records (fresh install) gets the student's uploaded records back by itself; a phone
 * updated from an older version copies everything already on it to Documents once. Both run once per install.
 */
export async function autoRestoreAndBackup(): Promise<void> {
  try {
    if (!localStorage.getItem(CLOUD_RESTORE_KEY) && navigator.onLine && (await db.records.count()) === 0) {
      await restoreFromCloud()
      localStorage.setItem(CLOUD_RESTORE_KEY, new Date().toISOString())
    }
    if (IS_NATIVE && !localStorage.getItem(FIRST_COPY_KEY)) {
      await backupAllToDocuments()
      localStorage.setItem(FIRST_COPY_KEY, new Date().toISOString())
    }
  } catch {
    /* offline or refused: tries again next start */
  }
}
