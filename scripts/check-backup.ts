// Self-check: a full backup restores every record, recording and form exactly, and restoring never loses anything.
// Run: node scripts/check-backup.ts
import assert from 'node:assert/strict'

const store = new Map<string, Record<string, unknown>>()
const mem = new Map<string, string>()
const g = globalThis as Record<string, unknown>
g.localStorage = {
  get length() { return mem.size },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
}
const { db } = await import('../src/lib/db.ts')
Object.defineProperty(db, 'records', { value: {
  get: async (id: string) => store.get(id),
  add: async (r: { id: string }) => { if (store.has(r.id)) throw new Error('exists'); store.set(r.id, r) },
  put: async (r: { id: string }) => void store.set(r.id, r),
  toArray: async () => [...store.values()],
  count: async () => store.size,
} })
const { fullBackup, restoreFromFiles, backupName } = await import('../src/lib/backup.ts')

const audio = new Uint8Array(200_000).map((_, i) => i % 251)
const rec = (id: string, media: { name: string; type: string; blob: Blob }[]) => ({
  id, kind: 'interview', category: '', title: `Interview ${id}`, notes: 'kept', lat: 8.31, lng: 80.4, accuracy: 5,
  recorded_at: '2026-11-12T09:30:00.000Z', media, data: { asked: [{ at_s: 3, si: 'ප්‍රශ්නය', en: 'question' }] }, synced: 0,
})
store.set('a', rec('a', [{ name: 'interview-1-part1.webm', type: 'audio/webm', blob: new Blob([audio], { type: 'audio/webm' }) },
  { name: 'interview-1-part2.webm', type: 'audio/webm', blob: new Blob([audio.slice(0, 10)], { type: 'audio/webm' }) }]))
store.set('b', { ...rec('b', [{ name: 'photo.jpg', type: 'image/jpeg', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) }]), kind: 'note', synced: 1 })
mem.set('spatren.localForms', JSON.stringify([{ id: 'f1', title: 'My form' }]))
mem.set('spatren.draft.f1', '{"q1":"half done"}')
mem.set('spatren.profile', 'not backed up')

// 1. Full backup, wipe the phone (reinstall), restore: everything identical
const full = await fullBackup()
assert.equal(full.records, 2)
const before = structuredClone([...store.entries()].map(([k, v]) => [k, { ...v, media: undefined }]))
const audioBefore = await Promise.all((store.get('a')!.media as { blob: Blob }[]).map((m) => m.blob.arrayBuffer()))
store.clear(); mem.clear()
let r = await restoreFromFiles([new File([full.bytes as Uint8Array<ArrayBuffer>], full.fileName)])
assert.deepEqual({ added: r.added, forms: r.forms, bad: r.bad }, { added: 2, forms: 1, bad: [] })
assert.deepEqual([...store.entries()].map(([k, v]) => [k, { ...v, media: undefined }]), before)
const media = store.get('a')!.media as { name: string; blob: Blob }[]
assert.deepEqual(media.map((m) => m.name), ['interview-1-part1.webm', 'interview-1-part2.webm'])
assert.deepEqual(await Promise.all(media.map((m) => m.blob.arrayBuffer())), audioBefore)
assert.equal(mem.get('spatren.draft.f1'), '{"q1":"half done"}')
assert.equal(mem.get('spatren.profile'), undefined)

// 2. Restoring again changes nothing and duplicates nothing
r = await restoreFromFiles([new File([full.bytes as Uint8Array<ArrayBuffer>], full.fileName)])
assert.deepEqual({ added: r.added, updated: r.updated, skipped: r.skipped, forms: r.forms }, { added: 0, updated: 0, skipped: 2, forms: 0 })
assert.equal(JSON.parse(mem.get('spatren.localForms')!).length, 1)

// 3. Cloud copy came back without its recording; the backup file completes it, keeping the upload state
store.set('a', { ...store.get('a')!, media: [], synced: 1 })
r = await restoreFromFiles([new File([full.bytes as Uint8Array<ArrayBuffer>], full.fileName)])
assert.equal(r.updated, 1)
assert.equal((store.get('a')!.media as unknown[]).length, 2)
assert.equal(store.get('a')!.synced, 1)

// 4. A damaged file is reported, not fatal; a phone form with the same id is kept
mem.set('spatren.localForms', JSON.stringify([{ id: 'f1', title: 'Edited on phone' }]))
r = await restoreFromFiles([new File(['not a zip'], 'broken.spatren'), new File([full.bytes as Uint8Array<ArrayBuffer>], full.fileName)])
assert.deepEqual(r.bad, ['broken.spatren'])
assert.equal(JSON.parse(mem.get('spatren.localForms')!)[0].title, 'Edited on phone')
assert.match(backupName(store.get('a') as never), /^20261112-0930_interview_a\.spatren$/)

console.info('backup and restore: all checks passed')
