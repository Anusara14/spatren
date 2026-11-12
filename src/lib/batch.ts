// This person's batch (class): its emergency contact and class AI key. One batch per student; the platform owner
// can see others in Admin → Batches. Cached so the SOS screen still shows the coordinator's number offline.
import { supabase, type Profile } from './supabase'

export interface BatchInfo {
  id: string
  name: string
  place: string | null
  coordinator_name: string | null
  coordinator_phone: string | null
  ai_key: string | null
}

const CACHE = 'spatren.batch'

export function cachedProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem('spatren.profile') ?? 'null') as Profile | null
  } catch {
    return null
  }
}

export function cachedBatch(): BatchInfo | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null') as BatchInfo | null
  } catch {
    return null
  }
}

/** Fresh from the server when online (and cached), else the cached copy. */
export async function myBatch(): Promise<BatchInfo | null> {
  const id = cachedProfile()?.batch_id
  if (!id) return null
  const { data, error } = await supabase.from('batches').select('id, name, place, coordinator_name, coordinator_phone, ai_key').eq('id', id).maybeSingle()
  if (error || !data) return cachedBatch()
  try {
    localStorage.setItem(CACHE, JSON.stringify(data))
  } catch {
    /* storage full: still return it */
  }
  return data as BatchInfo
}

export async function saveBatch(id: string, patch: Partial<Omit<BatchInfo, 'id'>>): Promise<string | null> {
  const { error } = await supabase.from('batches').update(patch).eq('id', id)
  return error ? error.message : null
}

/** For .match(): limits a class-list query to this person's batch (the platform owner can read every batch's list). */
export function batchMatch(): Record<string, string> {
  const id = cachedProfile()?.batch_id
  return id ? { batch_id: id } : {}
}
