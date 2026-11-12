// Finding people by name or index number (map search, lists).

/** Lower-case, accents and dots removed: "Serasinghe R.K." → "serasinghe r k". */
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Match by first name, last name, nickname or index: every word typed must start a word of the person's names
 * (so "sera" finds Serasinghe, "r k" finds "R.K."), or the text appears in the index number.
 */
export function matchesPerson(m: { full_name: string; nickname: string | null; index_no: string }, query: string): boolean {
  const q = norm(query)
  if (!q) return false
  if (m.index_no.toLowerCase().includes(q.replace(/\s/g, ''))) return true
  const words = norm(`${m.full_name} ${m.nickname ?? ''}`).split(' ')
  return q.split(' ').every((part) => words.some((w) => w.startsWith(part)))
}
