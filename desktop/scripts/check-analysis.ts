// Self-check for the desktop analysis logic. Run: node scripts/check-analysis.ts
import assert from 'node:assert/strict'
import { codeCounts, mergeWithNext, qualityIssues, quotes, search, splitSegment, wordErrorRate, type Transcripts } from '../src/lib/analysis.ts'
import { cleanRecord, itemsOf, type Package, type Transcript } from '../src/lib/model.ts'

const rec = (id: string, extra: object = {}) => ({
  record_id: id, kind: 'interview', form_title: null, title: null, notes: null, recorded_at: '2026-11-11T05:00:00.000Z', consent: true,
  location: { lat: 8.35, lng: 80.39, accuracy_m: 6 },
  interview: { open: true, topic: 'Tank life', participants: 1, audio_seconds: 300, asked: [] },
  audio: [{ file: `audio/${id}.webm`, name: 'interview.webm', type: 'audio/webm', bytes: 10 }],
  ...extra,
})
const collector = (sub: string) => ({ index_no: `24${sub}`, nickname: sub, name: null, group: 'Group 1', subgroup: sub })
const pkgs: Package[] = [
  { id: 'p1', dir: '/lib/p1', manifest: { app: 'SPATREN', format: 1, exported_at: '', collector: collector('Social'), records: [
    rec('a'),
    rec('b', { consent: false, location: null, interview: { open: true, topic: 'Short', participants: 1, audio_seconds: 40, asked: [] } }),
  ] } },
  { id: 'p2', dir: '/lib/p2', manifest: { app: 'SPATREN', format: 1, exported_at: '', collector: collector('Economic'), records: [rec('c'), rec('a')] } },
]
const items = itemsOf(pkgs)
assert.equal(items.length, 3) // interview "a" was sent twice: shown once

const T = (texts: string[], extra: Partial<Transcript> = {}): Transcript => ({
  model: 'm', created_at: '2026-11-11T08:00:00Z', edited_at: null, segments: texts.map((text, i) => ({ start: i * 10000, end: i * 10000 + 10000, text })), ...extra,
})
const key = (id: string) => items.find((i) => i.record.record_id === id)!.key
const ts: Transcripts = {
  [key('a')]: T(['අපේ වැව ලඟ ගොවිතැන', 'tank water is low'], { machine_text: 'අපේ වැව ගොවිතැන tank water is low' }),
  [key('c')]: T(['වැව ගැන කතාව']),
}

// Accuracy bench
assert.equal(wordErrorRate('a b c', 'a b c'), 0)
assert.equal(wordErrorRate('a x c', 'a b c'), 1 / 3)
assert.equal(wordErrorRate('', 'a b'), 1)
assert.equal(wordErrorRate('', ''), 0)

// Split and join keep time and text
const [l, r] = splitSegment({ start: 0, end: 10000, text: 'abcdefghij', star: true }, 4)
assert.deepEqual([l.text, l.end, r.text, r.start, r.star], ['abcd', 4000, 'efghij', 4000, false])
const joined = mergeWithNext([l, { ...r, codes: ['c1'] }], 0)
assert.deepEqual([joined.length, joined[0].text, joined[0].end, joined[0].codes], [1, 'abcd efghij', 10000, ['c1']])
assert.equal(mergeWithNext([l], 0).length, 1) // nothing to join

// Search finds Sinhala and English, case-insensitive
assert.equal(search(items, ts, 'වැව').length, 2)
assert.equal(search(items, ts, 'TANK').length, 1)
assert.equal(search(items, ts, '  ').length, 0)

// Quotes and codes
ts[key('a')].segments[0] = { ...ts[key('a')].segments[0], star: true, codes: ['farm'] }
ts[key('c')].segments[0] = { ...ts[key('c')].segments[0], codes: ['farm'] }
assert.equal(quotes(items, ts).length, 1)
const counts = codeCounts(items, ts, [{ id: 'farm', name: 'Farming', color: '#fff' }, { id: 'none', name: 'Unused', color: '#000' }])
assert.deepEqual([counts[0].total, counts[0].interviews, counts[0].bySubgroup], [2, 2, { Social: 1, Economic: 1 }])
assert.equal(counts[1].total, 0)

// Quality: missing consent is a fix; short, no location, not transcribed are checks
const issues = qualityIssues(items, ts)
assert.equal(issues[0].severity, 'fix')
assert.ok(issues.some((i) => i.text.startsWith('Only 40 s')))
assert.ok(issues.some((i) => i.text === 'No location'))
assert.ok(issues.some((i) => i.text === 'Not transcribed yet' && i.item.record.record_id === 'b'))
assert.ok(issues.some((i) => i.text.startsWith('Very little speech'))) // 'a': 6 words in 5 minutes


// Manifests come from ZIP files: hostile or broken ones are cleaned, never crash the window
assert.equal(cleanRecord(null), null)
assert.equal(cleanRecord({ record_id: 'x', audio: [{ file: '../../secret.txt' }] }), null) // no path escape
assert.equal(cleanRecord({ record_id: 'x', audio: [{ file: 'C:/Windows/win.ini' }] }), null)
assert.equal(cleanRecord({ record_id: 'x', audio: [{ file: 'audio/a/../../b.webm' }] }), null)
const odd = cleanRecord({ record_id: 'x', recorded_at: 'not a date', interview: { asked: 'nope', topic: 5 }, location: { lat: 'x' }, audio: [{ file: 'audio/a.webm', bytes: 'big' }] })!
assert.equal(odd.recorded_at, new Date(0).toISOString())
assert.deepEqual(odd.interview?.asked, [])
assert.equal(odd.interview?.topic, null)
assert.equal(odd.location, null)
assert.equal(odd.audio[0].bytes, 0)
assert.equal(itemsOf([{ id: 'p', dir: '/x', manifest: { records: 'nope' } as never }]).length, 0)
assert.equal(itemsOf([{ id: 'p', dir: '/x', manifest: null as never }]).length, 0)

console.log('desktop analysis logic: all checks passed')
