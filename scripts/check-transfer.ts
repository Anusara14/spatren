// Self-check for the recordings export. Run: node scripts/check-transfer.ts
process.env.TZ = 'Asia/Colombo' // file names use local time; pin it so the check is deterministic
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { buildRecordingsZip } from '../src/lib/transfer.ts'

const audio = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/webm;codecs=opus' })
const photo = new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' })
const base = { category: '', title: '', notes: '', lat: null, lng: null, accuracy: null, synced: 1 as const }

const res = await buildRecordingsZip(
  [
    { ...base, id: 'aaaaaaaa-1', kind: 'note', recorded_at: '2026-11-11T09:30:00.000Z', title: 'Tank bund', lat: 8.35, lng: 80.39, accuracy: 6,
      media: [{ name: 'audio-1.webm', type: audio.type, blob: audio }, { name: 'p.jpg', type: 'image/jpeg', blob: photo }], data: {} },
    { ...base, id: 'bbbbbbbb-2', kind: 'survey', recorded_at: '2026-11-11T10:05:00.000Z',
      media: [{ name: 'voice.m4a', type: 'audio/mp4', blob: audio }], data: { form_title: 'Open interview', answers: { topic: 'Culture' }, consent: true } },
    { ...base, id: 'cccccccc-3', kind: 'observation', recorded_at: '2026-11-11T11:00:00.000Z', media: [{ name: 'p.jpg', type: 'image/jpeg', blob: photo }], data: {} },
  ],
  { index_no: '242343J', nickname: 'Anusara', full_name: 'Ranasinghe W.K.Y.A', grp: 'Group 3', subgroup: 'Cultural' },
  new Date('2026-11-11T18:00:00.000Z'),
)

assert.equal(res.fileName, 'spatren-242343J-20261111-2330.zip')
assert.equal(res.audioCount, 2)
assert.deepEqual(res.recordIds, ['aaaaaaaa-1', 'bbbbbbbb-2']) // the photo-only record is not part of a recordings export

const files = unzipSync(res.bytes)
const names = Object.keys(files).sort()
assert.deepEqual(names, ['audio/20261111-1500_note_aaaaaaaa_audio-1.webm', 'audio/20261111-1535_survey_bbbbbbbb_voice.m4a', 'manifest.json'])
assert.deepEqual([...files['audio/20261111-1500_note_aaaaaaaa_audio-1.webm']], [1, 2, 3, 4, 5]) // bytes survive intact

const manifest = JSON.parse(strFromU8(files['manifest.json']))
assert.equal(manifest.collector.index_no, '242343J')
assert.equal(manifest.records.length, 2)
assert.deepEqual(manifest.records[0].location, { lat: 8.35, lng: 80.39, accuracy_m: 6 })
assert.equal(manifest.records[1].form_title, 'Open interview')
assert.deepEqual(manifest.records[1].answers, { topic: 'Culture' })
assert.equal(manifest.records[1].audio[0].file, 'audio/20261111-1535_survey_bbbbbbbb_voice.m4a')

console.info('recordings export: all checks passed')
