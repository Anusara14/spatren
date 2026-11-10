// Self-check for the desktop data logic. Run: node scripts/check-transcript.ts
import assert from 'node:assert/strict'
import { clock, itemsOf, parseWhisper, segmentsCsv, transcriptText, type Package, type Transcript } from '../src/lib/model.ts'

const rec = (id: string, at: string) => ({
  record_id: id, kind: 'interview', form_title: null, title: 'Tank bund', notes: null, recorded_at: at, location: { lat: 8.35, lng: 80.39, accuracy_m: 6 },
  interview: { open: true, topic: 'Living near the tank', participants: 1, audio_seconds: 90, asked: [{ at_s: 30, si: 'ඒ කවදද?', en: 'When was that?', ai: false }] },
  audio: [{ file: `audio/${id}.webm`, name: 'interview.webm', type: 'audio/webm', bytes: 10 }],
})
const collector = { index_no: '123456A', nickname: 'Nimal', name: 'Perera N.', group: 'Group 1', subgroup: 'Social' }
const pkgs: Package[] = [
  { id: 'p2', dir: '/lib/p2', manifest: { app: 'SPATREN', format: 1, exported_at: '', collector, records: [rec('r2', '2026-11-11T05:00:00Z'), rec('r1', '2026-11-11T04:00:00Z')] } },
  { id: 'p1', dir: '/lib/p1', manifest: { app: 'SPATREN', format: 1, exported_at: '', collector, records: [rec('r1', '2026-11-11T04:00:00Z')] } }, // resent
]
const items = itemsOf(pkgs)
assert.deepEqual(items.map((i) => i.record.record_id), ['r2', 'r1']) // newest first, resend counted once

const segs = parseWhisper(JSON.stringify({ transcription: [
  { offsets: { from: 0, to: 4000 }, text: ' අපි මෙහෙ අවුරුදු 20ක් ඉන්නවා ' },
  { offsets: { from: 4000, to: 5000 }, text: '[Music]' },
  { offsets: { from: 5000, to: 9000 }, text: '' },
  { offsets: { from: 31000, to: 36000 }, text: '=SUM(1)' },
] }))
assert.equal(segs.length, 2) // noise marker and blank dropped
assert.equal(segs[0].text, 'අපි මෙහෙ අවුරුදු 20ක් ඉන්නවා')

const t: Transcript = { model: 'm', created_at: '', edited_at: null, segments: segs }
const text = transcriptText(items[1], t)
assert.match(text, /Living near the tank/)
assert.match(text, /\[0:30\] \[Question asked\] ඒ කවදද\? \(When was that\?\)/) // question marker placed in time order
assert.ok(text.indexOf('[0:00]') < text.indexOf('[0:30]') && text.indexOf('[0:30]') < text.indexOf('[0:31]'))

const csv = segmentsCsv([{ item: items[1], t }])
assert.ok(csv.startsWith('\uFEFF'))
assert.match(csv, /'=SUM\(1\)/) // formula injection blocked
assert.equal(clock(3_725_000), '1:02:05')
console.info('desktop transcript logic: all checks passed')
