// Pure analysis over imported interviews and transcripts (no Tauri, no React). Checked by scripts/check-analysis.ts.
import { titleOf, type Item, type Segment, type Transcript } from './model.ts'

export interface Code {
  id: string
  name: string
  color: string
}

/** Shared analysis state for this laptop: the codebook. Stored as project.json in the app's data folder. */
export interface Project {
  codes: Code[]
}

export const CODE_COLORS = ['#bed43d', '#5aa9e6', '#f4a259', '#e76f8a', '#8e7dbe', '#4fb6a5', '#d9c35c', '#9aa5b1']

export type Transcripts = Record<string, Transcript>

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean)
export const fullText = (t: Transcript): string => t.segments.map((s) => s.text).join(' ')

/**
 * Word error rate between the model's first draft and the corrected transcript: how much students had to fix.
 * Word-level Levenshtein; O(n*m) memory-light (two rows), fine for interview-length texts.
 */
export function wordErrorRate(machine: string, corrected: string): number {
  const a = words(machine)
  const b = words(corrected)
  if (!b.length) return a.length ? 1 : 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return prev[b.length] / b.length
}

/** Split one segment at a character position; the time is shared out in proportion to the text. */
export function splitSegment(s: Segment, at: number): [Segment, Segment] {
  const left = s.text.slice(0, at).trim()
  const right = s.text.slice(at).trim()
  const mid = Math.round(s.start + (s.end - s.start) * (s.text.length ? at / s.text.length : 0.5))
  return [
    { ...s, text: left, end: mid, en: undefined },
    { ...s, text: right, start: mid, en: undefined, star: false },
  ]
}

/** Join a segment with the next one (undo a split, or merge two short lines). */
export function mergeWithNext(segs: Segment[], i: number): Segment[] {
  if (i < 0 || i >= segs.length - 1) return segs
  const a = segs[i]
  const b = segs[i + 1]
  const merged: Segment = {
    ...a,
    end: b.end,
    text: `${a.text} ${b.text}`.trim(),
    codes: [...new Set([...(a.codes ?? []), ...(b.codes ?? [])])],
    star: a.star || b.star,
    en: a.en && b.en ? `${a.en} ${b.en}` : undefined,
  }
  return [...segs.slice(0, i), merged, ...segs.slice(i + 2)]
}

export interface Hit {
  item: Item
  index: number
  seg: Segment
}

/** Case-insensitive search in Sinhala text and English translations across every transcript. */
export function search(items: Item[], ts: Transcripts, query: string, limit = 300): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const item of items) {
    const t = ts[item.key]
    if (!t) continue
    t.segments.forEach((seg, index) => {
      if (hits.length < limit && (seg.text.toLowerCase().includes(q) || (seg.en ?? '').toLowerCase().includes(q))) hits.push({ item, index, seg })
    })
  }
  return hits
}

/** Starred segments: the quote bank. */
export function quotes(items: Item[], ts: Transcripts): Hit[] {
  return items.flatMap((item) => (ts[item.key]?.segments ?? []).flatMap((seg, index) => (seg.star ? [{ item, index, seg }] : [])))
}

export interface Filter {
  group: string // 'All' or a group name
  subgroup: string
  topic: string
}
export const ALL = 'All'

const groupOf = (c: Item['collector']): string => c.group ?? 'No group'
export const subgroupOf = (c: Item['collector']): string => c.subgroup ?? 'No subgroup'

export function applyFilter<T extends { collector: Item['collector']; record: Item['record'] }>(rows: T[], f: Filter): T[] {
  return rows.filter(
    (r) =>
      (f.group === ALL || groupOf(r.collector) === f.group) &&
      (f.subgroup === ALL || subgroupOf(r.collector) === f.subgroup) &&
      (f.topic === ALL || titleOf(r.record) === f.topic),
  )
}

export interface CodeCount {
  code: Code
  total: number
  bySubgroup: Record<string, number>
  interviews: number
}

/** How often each code was applied, overall and per subgroup, and in how many interviews. */
export function codeCounts(items: Item[], ts: Transcripts, codes: Code[]): CodeCount[] {
  return codes
    .map((code) => {
      const bySubgroup: Record<string, number> = {}
      let total = 0
      let interviews = 0
      for (const item of items) {
        const n = (ts[item.key]?.segments ?? []).filter((s) => s.codes?.includes(code.id)).length
        if (!n) continue
        total += n
        interviews++
        const sg = subgroupOf(item.collector)
        bySubgroup[sg] = (bySubgroup[sg] ?? 0) + n
      }
      return { code, total, bySubgroup, interviews }
    })
    .sort((a, b) => b.total - a.total)
}

export type Severity = 'fix' | 'check'
export interface Issue {
  item: Item
  severity: Severity
  text: string
}

const MIN_INTERVIEW_S = 120

/** Things to sort out while the field visit is still on: short or silent recordings, missing consent or location. */
export function qualityIssues(items: Item[], ts: Transcripts): Issue[] {
  const out: Issue[] = []
  for (const item of items) {
    const r = item.record
    const secs = r.interview?.audio_seconds ?? null
    if (r.kind === 'interview' && r.consent !== true) out.push({ item, severity: 'fix', text: 'No consent recorded' })
    if (secs != null && secs < MIN_INTERVIEW_S) out.push({ item, severity: 'check', text: `Only ${Math.round(secs)} s long` })
    if (!r.location) out.push({ item, severity: 'check', text: 'No location' })
    const t = ts[item.key]
    if (!t) out.push({ item, severity: 'check', text: 'Not transcribed yet' })
    else if (secs && secs >= 60 && words(fullText(t)).length / (secs / 60) < 20)
      out.push({ item, severity: 'check', text: 'Very little speech found: noisy, quiet or mostly silence' })
    else if (t && !t.segments.some((s) => s.speaker)) out.push({ item, severity: 'check', text: 'Speakers not marked' })
  }
  const rank = (i: Issue) => (i.severity === 'fix' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}
