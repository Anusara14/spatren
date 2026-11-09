import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_KEY as string
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_KEY')

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export type Profile = {
  index_no: string | null
  full_name: string | null
  grp: string | null
  subgroup: string | null
  elective: string | null
  is_admin: boolean
  status: 'pending' | 'approved' | 'rejected'
  tracking: boolean
}

export type TeamRow = {
  index_no: string
  full_name: string
  grp: string
  subgroup: string
  elective: string | null
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
