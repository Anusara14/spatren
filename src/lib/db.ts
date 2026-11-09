import Dexie, { type EntityTable } from 'dexie'

// Everything a phone collects lands here first (IndexedDB), then the outbox drains to Supabase.
export type PendingPoint = {
  client_id: string
  lat: number
  lng: number
  accuracy: number | null
  battery: number | null
  charging: boolean | null
  recorded_at: string
}

export type PendingSos = {
  id: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  battery: number | null
  location_at: string | null
  created_at: string
}

export type LocalMedia = { name: string; type: string; blob: Blob; uploaded?: string }

export type LocalRecord = {
  id: string
  kind: 'observation' | 'interview' | 'note' | 'survey'
  category: string
  title: string
  notes: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  recorded_at: string
  media: LocalMedia[]
  data: Record<string, unknown>
  synced: 0 | 1 // indexable flag; synced records stay on the phone as the user's own copy
  /** when the voice recordings were last exported via Transfer recordings (not indexed) */
  exported?: string
}

export const db = new Dexie('spatren') as Dexie & {
  points: EntityTable<PendingPoint, 'client_id'>
  sos: EntityTable<PendingSos, 'id'>
  records: EntityTable<LocalRecord, 'id'>
  trail: EntityTable<PendingPoint, 'client_id'>
}

db.version(1).stores({
  points: 'client_id, recorded_at', // outbox: deleted after confirmed upload
  sos: 'id',
  records: 'id, synced, recorded_at',
  trail: 'client_id, recorded_at', // own trail for the offline map; pruned to 3 days
})

// Ask the browser not to evict our data (matters most on iOS Safari).
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
