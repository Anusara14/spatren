import { useMemo } from 'react'

// ponytail: English stop-words only; add Sinhala/Tamil stop-word lists once real notes show which words dominate
const STOP = new Set(
  'the and for are but not you all any can had her was one our out has have this that with from they them then there their what when where which who will would about into near very also more some than been were its it is at on in to of a an or as by be we he she his my me us do does did no yes so if up down just only there here other such these those over under after before while because many much most like get got go going went see seen said'.split(' '),
)
const PALETTE = ['#13283C', '#7d9a1e', '#4b5e70', '#1f6fa8', '#c06a3f']

export function topWords(text: string, limit = 60): [string, number][] {
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

export default function WordCloud({ text }: { text: string }) {
  const words = useMemo(() => topWords(text), [text])
  if (!words.length) return <p className="muted small">Notes will appear here as a word cloud once records come in.</p>
  const max = words[0][1]
  const min = words[words.length - 1][1]
  // Shuffle deterministically so big words don't all cluster at the start.
  const ordered = [...words].sort((a, b) => hash(a[0]) - hash(b[0]))
  return (
    <div className="cloud" aria-label="Word cloud of the most frequent words in today's notes">
      {ordered.map(([w, n]) => {
        const t = max === min ? 0.5 : (n - min) / (max - min)
        return (
          <span key={w} title={`${w}: ${n}`} style={{ fontSize: 14 + t * 34, color: PALETTE[hash(w) % PALETTE.length], opacity: 0.6 + t * 0.4 }}>
            {w}
          </span>
        )
      })}
    </div>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
