import { createClient } from '@supabase/supabase-js'
import { IS_NATIVE } from './native'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_KEY as string
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_KEY')

export const supabase = createClient(url, key, {
  // Android app: PKCE, so the sign-in deep link only works for a sign-in this phone started (a crafted
  // lk.spatren.field://auth link can't log a student into someone else's account). Web keeps its working flow.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !IS_NATIVE, flowType: IS_NATIVE ? 'pkce' : 'implicit' },
})

export type Profile = {
  index_no: string | null
  full_name: string | null
  nickname: string | null
  grp: string | null
  subgroup: string | null
  elective: string | null
  is_admin: boolean
  status: 'pending' | 'approved' | 'rejected'
  tracking: boolean
  avatar: string | null
  /** group leader: gets the group's SOS alerts and can call the group to a meeting point */
  is_leader?: boolean
  batch_id?: string | null
  batch_name?: string | null
  /** where this batch's field visit is, shown on the map */
  batch_place?: string | null
  /** platform owner: creates batches for other classes */
  is_owner?: boolean
}

export type TeamRow = {
  index_no: string
  full_name: string
  nickname: string | null
  avatar?: string | null
  grp: string | null
  subgroup: string | null
  elective: string | null
  is_leader?: boolean
  is_admin?: boolean
  batch_id?: string
  user_id: string | null
  status: string | null
  email: string | null
  tracking: boolean | null
  tracking_changed_at: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  battery: number | null
  charging: boolean | null
  recorded_at: string | null
  received_at: string | null
}

export type SosRow = {
  id: string
  user_id: string
  lat: number | null
  lng: number | null
  accuracy: number | null
  battery: number | null
  location_at: string | null
  created_at: string
  received_at: string
  status: 'open' | 'acknowledged' | 'resolved'
  handled_at: string | null
  note: string | null
}

export type RecordRow = {
  id: string
  user_id: string
  kind: 'observation' | 'interview' | 'note' | 'survey'
  category: string | null
  title: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  recorded_at: string
  media: { path: string; type: string }[]
  data: Record<string, unknown>
}

/** What classmates call each other; falls back to the class-list name. */
export const nameOf = (r: { nickname?: string | null; full_name?: string | null } | null | undefined): string =>
  r?.nickname || r?.full_name || 'Unknown student'

/** Index-based login: students without Google get a private, never-emailed address derived from their index. */
export const emailForIndex = (index: string): string => `${index.trim().toLowerCase()}@students.spatren.app`

// DiceBear "Adventurer Neutral" by Lisa Wischofsky, CC BY 4.0 (https://www.dicebear.com/styles/adventurer-neutral)
export const avatarUrl = (seed: string | null | undefined): string | null =>
  seed ? `https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=${encodeURIComponent(seed)}&radius=50` : null

/** A database error in words a student can act on. */
export function friendlyError(e: { message?: string } | null | undefined, action = 'do that'): string {
  if (!navigator.onLine) return `You're offline, so this couldn't ${action}. It works again when you have signal.`
  const m = e?.message ?? ''
  if (/permission denied|JWT|not allowed|row-level security/i.test(m)) return `You don't have access to ${action}. If this is wrong, sign out and sign in again.`
  return `Couldn't ${action}: ${m || 'unknown error'}.`
}
