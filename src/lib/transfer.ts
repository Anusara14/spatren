import { zipSync, strToU8, type Zippable } from 'fflate'
import type { LocalRecord } from './db'

export interface ExportWho {
  index_no: string | null
  nickname: string | null
  full_name: string | null
  grp: string | null
  subgroup: string | null
}

export interface ExportResult {
  bytes: Uint8Array
  fileName: string
  recordIds: string[]
  audioCount: number
}

const pad = (n: number) => String(n).padStart(2, '0')
// Local wall-clock time (what the student saw), e.g. 20261111-0930 for 9:30 am in Sri Lanka.
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)

/**
 * One ZIP per transfer: every voice recording plus manifest.json describing each record (who, when, where, form
 * answers) so the desktop app can match files to records and transcribe them. Audio is stored, not re-compressed
 * (Opus/AAC are already compressed), which keeps this fast on phones.
 */
export async function buildRecordingsZip(records: LocalRecord[], who: ExportWho, now = new Date()): Promise<ExportResult> {
  const files: Zippable = {}
  const manifest = []
  let audioCount = 0
  for (const r of records) {
    const audio = r.media.filter((m) => m.type.startsWith('audio'))
    if (!audio.length) continue
    const entries = []
    for (const m of audio) {
      const path = `audio/${stamp(r.recorded_at)}_${r.kind}_${r.id.slice(0, 8)}_${safe(m.name)}`
      files[path] = [new Uint8Array(await m.blob.arrayBuffer()), { level: 0 }]
      entries.push({ file: path, name: m.name, type: m.type, bytes: m.blob.size })
      audioCount++
    }
    manifest.push({
      record_id: r.id,
      kind: r.kind,
      form_title: r.kind === 'survey' ? r.data.form_title ?? null : null,
      title: r.title || null,
      notes: r.notes || null,
      recorded_at: r.recorded_at,
      location: r.lat != null ? { lat: r.lat, lng: r.lng, accuracy_m: r.accuracy } : null,
      answers: r.kind === 'survey' ? r.data.answers ?? {} : undefined,
      consent: r.data.consent ?? undefined,
      // Open interviews: what the desktop app needs to line questions up with the audio.
      interview: r.kind === 'interview'
        ? { open: r.data.open === true, topic: r.data.topic ?? null, participants: r.data.participants ?? null, audio_seconds: r.data.audio_seconds ?? null, asked: r.data.asked ?? [] }
        : undefined,
      audio: entries,
    })
  }
  const body = {
    app: 'SPATREN',
    format: 1,
    exported_at: now.toISOString(),
    collector: { index_no: who.index_no, nickname: who.nickname, name: who.full_name, group: who.grp, subgroup: who.subgroup },
    records: manifest,
  }
  files['manifest.json'] = [strToU8(JSON.stringify(body, null, 2)), { level: 6 }]
  return {
    bytes: zipSync(files),
    fileName: `spatren-${safe(who.index_no ?? 'phone')}-${stamp(now.toISOString())}.zip`,
    recordIds: manifest.map((m) => m.record_id),
    audioCount,
  }
}
