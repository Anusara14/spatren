// Pure data logic (no Tauri): manifest types, interview list, whisper output parsing, exports.
// Checked by scripts/check-transcript.ts.

export interface AskedQuestion {
  at_s: number
  si: string
  en: string
  ai: boolean
}

export interface ManifestRecord {
  record_id: string
  kind: string
  form_title: string | null
  title: string | null
  notes: string | null
  recorded_at: string
  location: { lat: number; lng: number; accuracy_m: number | null } | null
  consent?: boolean
  interview?: { open: boolean; topic: string | null; participants: number | null; audio_seconds: number | null; asked: AskedQuestion[] }
  audio: { file: string; name: string; type: string; bytes: number }[]
}

export interface Manifest {
  app: string
  format: number
  exported_at: string
  collector: { index_no: string | null; nickname: string | null; name: string | null; group: string | null; subgroup: string | null }
  records: ManifestRecord[]
}

export interface Package {
  id: string
  dir: string
  manifest: Manifest
}

/** One recording the user can open: a record's audio file plus who made it. */
export interface Item {
  key: string // package/record/file, unique
  pkg: string
  dir: string
  record: ManifestRecord
  audioFile: string
  collector: Manifest['collector']
}

export type Speaker = 'I' | 'R' // interviewer / respondent

export interface Segment {
  start: number // ms
  end: number // ms
  text: string
  speaker?: Speaker
  codes?: string[] // code ids from the codebook
  star?: boolean // saved to the quote bank
  en?: string // English translation
}

export interface Transcript {
  model: string
  created_at: string
  edited_at: string | null
  segments: Segment[]
  /** What the model first wrote, kept so the accuracy bench can measure how much students corrected. */
  machine_text?: string
}


/** Flatten packages to recordings, newest first. The same recording sent twice (resend) appears once. */
export function itemsOf(packages: Package[]): Item[] {
  const seen = new Set<string>()
  const items: Item[] = []
  for (const p of packages) {
    const collector = cleanCollector(p.manifest?.collector)
    for (const raw of Array.isArray(p.manifest?.records) ? p.manifest.records : []) {
      const r = cleanRecord(raw)
      if (!r) continue
      for (const a of r.audio) {
        const id = `${r.record_id}/${a.name}`
        if (seen.has(id)) continue
        seen.add(id)
        items.push({ key: `${p.id}/${r.record_id}/${a.file}`, pkg: p.id, dir: p.dir, record: r, audioFile: a.file, collector })
      }
    }
  }
  return items.sort((a, b) => b.record.recorded_at.localeCompare(a.record.recorded_at))
}

// Manifests come from ZIP files and are untrusted: anything malformed is dropped or defaulted here, so one bad
// file can't crash the window, and audio paths can only point inside the package's own audio/ folder.
const str = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, 2000) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const SAFE_AUDIO = /^audio\/[^\\/:]+$/

function cleanCollector(c: unknown): Manifest['collector'] {
  const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
  return { index_no: str(o.index_no), nickname: str(o.nickname), name: str(o.name), group: str(o.group), subgroup: str(o.subgroup) }
}

export function cleanRecord(raw: unknown): ManifestRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.record_id)
  if (!id) return null
  const audio = (Array.isArray(o.audio) ? o.audio : [])
    .map((a) => (a && typeof a === 'object' ? (a as Record<string, unknown>) : {}))
    .filter((a) => typeof a.file === 'string' && SAFE_AUDIO.test(a.file) && !a.file.includes('..'))
    .map((a) => ({ file: a.file as string, name: str(a.name) ?? (a.file as string), type: str(a.type) ?? 'audio/webm', bytes: num(a.bytes) ?? 0 }))
  if (!audio.length) return null
  const loc = o.location as Record<string, unknown> | null
  const iv = o.interview && typeof o.interview === 'object' ? (o.interview as Record<string, unknown>) : null
  const at = str(o.recorded_at)
  return {
    record_id: id,
    kind: str(o.kind) ?? 'recording',
    form_title: str(o.form_title),
    title: str(o.title),
    notes: str(o.notes),
    recorded_at: at && !Number.isNaN(Date.parse(at)) ? at : new Date(0).toISOString(),
    location: loc && num(loc.lat) != null && num(loc.lng) != null ? { lat: num(loc.lat)!, lng: num(loc.lng)!, accuracy_m: num(loc.accuracy_m) } : null,
    consent: typeof o.consent === 'boolean' ? o.consent : undefined,
    interview: iv
      ? {
          open: iv.open === true,
          topic: str(iv.topic),
          participants: num(iv.participants),
          audio_seconds: num(iv.audio_seconds),
          asked: (Array.isArray(iv.asked) ? iv.asked : [])
            .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
            .map((q) => ({ at_s: num(q.at_s) ?? 0, si: str(q.si) ?? '', en: str(q.en) ?? '', ai: q.ai === true }))
            .filter((q) => q.si || q.en),
        }
      : undefined,
    audio,
  }
}


/** whisper.cpp -oj output -> segments (blank and bracketed noise markers like [Music] dropped). */
export function parseWhisper(json: string): Segment[] {
  const data = JSON.parse(json) as { transcription?: { offsets?: { from: number; to: number }; text?: string }[] }
  return (data.transcription ?? [])
    .map((t) => ({ start: t.offsets?.from ?? 0, end: t.offsets?.to ?? 0, text: (t.text ?? '').replace(/�/g, '').trim() }))
    .filter((s) => s.text && !/^\[[^\]]*\]$|^\([^)]*\)$/.test(s.text))
}

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`
}

export const who = (c: Manifest['collector']): string => c.nickname || c.name || c.index_no || 'Unknown'

export const titleOf = (r: ManifestRecord): string => r.interview?.topic || r.title || r.form_title || (r.kind === 'interview' ? 'Interview' : 'Recording')

/** Plain-text transcript with the interview details and asked-question markers, for reading or Word. */
export function transcriptText(item: Item, t: Transcript): string {
  const r = item.record
  const asked = (r.interview?.asked ?? []).map((a) => ({ ms: a.at_s * 1000, line: `[Question asked] ${a.si}${a.si !== a.en ? ` (${a.en})` : ''}` }))
  const lines = [...t.segments.map((s) => ({ ms: s.start, line: s.text })), ...asked].sort((a, b) => a.ms - b.ms)
  return [
    titleOf(r),
    `Collected by ${who(item.collector)}${item.collector.index_no ? ` (${item.collector.index_no})` : ''}, ${item.collector.group ?? ''} ${item.collector.subgroup ?? ''}`.trim(),
    `Recorded ${new Date(r.recorded_at).toLocaleString()}${r.location ? ` at ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}` : ''}`,
    r.notes ? `Notes: ${r.notes}` : '',
    '',
    ...lines.map((l) => `[${clock(l.ms)}] ${l.line}`),
  ].filter((l, i) => l !== '' || i === 4).join('\n')
}

const csvCell = (v: unknown): string => {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}` // no spreadsheet formulas from transcript text
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per transcript segment across every transcribed recording: ready for Excel / qualitative coding. */
export function segmentsCsv(rows: { item: Item; t: Transcript }[], codeName: (id: string) => string = (id) => id): string {
  const head = ['record_id', 'recorded_at', 'collector', 'index_no', 'group', 'subgroup', 'topic', 'start', 'end', 'speaker', 'codes', 'quote', 'text', 'english']
  const lines = rows.flatMap(({ item, t }) =>
    t.segments.map((s) =>
      [item.record.record_id, item.record.recorded_at, who(item.collector), item.collector.index_no, item.collector.group, item.collector.subgroup, titleOf(item.record),
        clock(s.start), clock(s.end), speakerName(s.speaker), (s.codes ?? []).map(codeName).join('; '), s.star ? 'yes' : '', s.text, s.en ?? '']
        .map(csvCell)
        .join(','),
    ),
  )
  return '﻿' + [head.join(','), ...lines].join('\n') // BOM: Excel opens Sinhala correctly
}

export const speakerName = (s: Speaker | undefined): string => (s === 'I' ? 'Interviewer' : s === 'R' ? 'Respondent' : '')

export function rowsCsv(head: string[], rows: unknown[][]): string {
  return '﻿' + [head.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
}
