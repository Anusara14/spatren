// Experiences: a student drops a pin with a rating (very bad → very good), a note, photos and a short voice note.
// The whole batch sees them on the experience map, so at the end of the day the class can talk through how
// different places felt. Saved on the phone first like every record; media goes to media/<uid>/exp/... which the
// whole batch may read (other records' media stays private to the student and admins).
import { useEffect, useState } from 'react'
import { friendlyError, supabase } from './supabase'

export interface Rating {
  value: -2 | -1 | 0 | 1 | 2
  label: string
  color: string
  emoji: string
}

export const RATINGS: Rating[] = [
  { value: 2, label: 'Very good', color: '#3FB950', emoji: '😄' },
  { value: 1, label: 'Good', color: '#A3D65C', emoji: '🙂' },
  { value: 0, label: 'Okay', color: '#9AA5B1', emoji: '😐' },
  { value: -1, label: 'Bad', color: '#F2994A', emoji: '🙁' },
  { value: -2, label: 'Very bad', color: '#E5484D', emoji: '😣' },
]
export const ratingOf = (v: number | null | undefined): Rating | null => RATINGS.find((r) => r.value === v) ?? null

/** Longest voice note on an experience (keeps uploads small on the free storage tier). */
export const MAX_VOICE_S = 60

export interface Experience {
  id: string
  user_id: string
  author: string | null
  grp: string | null
  subgroup: string | null
  title: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  recorded_at: string
  media: { path: string; type: string }[]
  rating: number | null
}

export type ExperienceRange = 'today' | '3days' | 'all'
const sinceFor = (r: ExperienceRange) =>
  r === 'all' ? new Date(0).toISOString() : new Date(new Date().setHours(0, 0, 0, 0) - (r === '3days' ? 2 * 86_400_000 : 0)).toISOString()

/** The batch's experience pins, refreshed every minute while the layer is on. */
export function useExperiences(enabled: boolean, range: ExperienceRange): { items: Experience[]; error: string | null; reload: () => void } {
  const [items, setItems] = useState<Experience[]>([])
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { data, error: e } = await supabase.rpc('experience_feed', { p_since: sinceFor(range) })
      if (!alive) return
      if (e) return setError(friendlyError(e, 'load experiences'))
      setError(null)
      setItems(((data ?? []) as Experience[]).map((x) => ({ ...x, media: Array.isArray(x.media) ? x.media : [] })))
    }
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [enabled, range, n])
  return { items, error, reload: () => setN((x) => x + 1) }
}

/** Signed links (1 hour) for an experience's uploaded photos and voice note. */
export async function mediaLinks(media: Experience['media']): Promise<{ url: string; type: string }[]> {
  const uploaded = media.filter((m) => m.path && !m.path.startsWith('device://'))
  if (!uploaded.length) return []
  const { data } = await supabase.storage.from('media').createSignedUrls(uploaded.map((m) => m.path), 3600)
  return (data ?? []).flatMap((d, i) => (d.signedUrl ? [{ url: d.signedUrl, type: uploaded[i].type }] : []))
}

/** Counts per rating, very good first, for the map legend. */
export function ratingCounts(items: Experience[]): { rating: Rating; count: number }[] {
  return RATINGS.map((rating) => ({ rating, count: items.filter((x) => x.rating === rating.value).length }))
}
