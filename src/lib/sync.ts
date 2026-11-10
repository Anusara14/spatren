import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { db, type LocalRecord } from './db'
import { supabase } from './supabase'

const BATCH = 200
const STOP_PENDING = 'spatren.stopPending'
let running: Promise<SyncResult> | null = null

export interface SyncResult {
  ok: boolean
  error?: string
}

export interface OutboxCounts {
  points: number
  sos: number
  records: number
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// SOS never waits behind a running sync (a slow media upload can take minutes on 3G).
export async function sendSos(): Promise<boolean> {
  const pending = await db.sos.toArray()
  if (!pending.length) return true
  if (!navigator.onLine) return false
  const { error } = await supabase.from('sos_alerts').upsert(pending, { onConflict: 'id', ignoreDuplicates: true })
  if (error) return false
  await db.sos.bulkDelete(pending.map((p) => p.id))
  return true
}

// Every row carries a client-generated id, so a retried upload can never create a duplicate.
export function syncNow(): Promise<SyncResult> {
  if (running) return running
  running = doSync().finally(() => {
    running = null
  })
  return running
}

async function doSync(): Promise<SyncResult> {
  if (!navigator.onLine) return { ok: false, error: 'offline' }
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) return { ok: false, error: 'signed out' }

  // Each stage is isolated: one bad item must not block everything behind it.
  const errors: string[] = []
  await sendSos().catch((e: unknown) => errors.push(msg(e)))
  await syncPoints().catch((e: unknown) => errors.push(msg(e)))
  errors.push(...(await syncRecords(uid)))
  if (localStorage.getItem(STOP_PENDING)) {
    const { error } = await supabase.rpc('set_tracking', { p_on: false })
    if (!error) localStorage.removeItem(STOP_PENDING)
  }

  if (errors.length) {
    localStorage.setItem('spatren.syncError', errors[0])
    return { ok: false, error: errors[0] }
  }
  localStorage.removeItem('spatren.syncError')
  localStorage.setItem('spatren.lastSync', new Date().toISOString())
  return { ok: true }
}

export const markStopPending = () => localStorage.setItem(STOP_PENDING, '1')

async function syncPoints(): Promise<void> {
  for (;;) {
    const batch = await db.points.orderBy('recorded_at').limit(BATCH).toArray()
    if (!batch.length) return
    const { error } = await supabase.from('locations').upsert(batch, { onConflict: 'client_id', ignoreDuplicates: true })
    if (error) {
      // A batch with one rejected row (e.g. corrupt coords): drop only the bad row so the rest keep flowing.
      for (const p of batch) {
        const r = await supabase.from('locations').upsert(p, { onConflict: 'client_id', ignoreDuplicates: true })
        if (!r.error || r.error.code?.startsWith('23')) await db.points.delete(p.client_id) // 23xxx = constraint: will never succeed
        else throw new Error(`Location upload failed: ${r.error.message}`)
      }
      continue
    }
    await db.points.bulkDelete(batch.map((p) => p.client_id))
  }
}

async function syncRecords(uid: string): Promise<string[]> {
  const errors: string[] = []
  const pending = await db.records.where('synced').equals(0).toArray()
  for (const rec of pending) {
    try {
      await syncRecord(uid, rec)
    } catch (e: unknown) {
      errors.push(msg(e)) // keep going: the next record may be fine
    }
  }
  return errors
}

async function syncRecord(uid: string, rec: LocalRecord): Promise<void> {
  // Upload each media file once; remember the storage path so a retry skips it.
  const media = [...rec.media]
  for (let i = 0; i < media.length; i++) {
    const m = media[i]
    if (m.uploaded) continue
    // Voice recordings never go to the cloud (storage budget + privacy). They stay on the phone and leave via
    // Collect → Transfer recordings. The record still syncs, pointing at the file on the device.
    // Anything the server won't take (only JPEG/PNG/WebP/HEIC photos are allowed) also stays here instead of
    // blocking the record in "Ready to send" forever.
    if (!/^image\/(jpeg|png|webp|heic)$/.test(m.type.split(';')[0])) {
      media[i] = { ...m, uploaded: `device://${rec.id}/${m.name}` }
      await db.records.update(rec.id, { media })
      continue
    }
    const path = `${uid}/${rec.id}/${m.name}`
    const { error } = await supabase.storage.from('media').upload(path, m.blob, { contentType: m.type.split(';')[0], upsert: true })
    if (error) throw new Error(`Media upload failed: ${error.message}`)
    media[i] = { ...m, uploaded: path }
    await db.records.update(rec.id, { media })
  }
  const row = {
    id: rec.id,
    kind: rec.kind,
    category: rec.category || null,
    title: rec.title || null,
    notes: rec.notes || null,
    lat: rec.lat,
    lng: rec.lng,
    accuracy: rec.accuracy,
    recorded_at: rec.recorded_at,
    media: media.map((m) => ({ path: m.uploaded!, type: m.type })),
    data: rec.data,
  }
  const { error } = await supabase.from('records').upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new Error(`Record upload failed: ${error.message}`)
  await db.records.update(rec.id, { synced: 1 })
}

export function useOutbox(): OutboxCounts {
  const [counts, setCounts] = useState<OutboxCounts>({ points: 0, sos: 0, records: 0 })
  useEffect(() => {
    const sub = liveQuery(async () => ({
      points: await db.points.count(),
      sos: await db.sos.count(),
      records: await db.records.where('synced').equals(0).count(),
    })).subscribe({ next: setCounts })
    return () => sub.unsubscribe()
  }, [])
  return counts
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => {
      setOnline(true)
      void syncNow()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
