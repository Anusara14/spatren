// One recorder for a screen: start, pause/resume, stop. Time counts only what was recorded; a phone call pauses it
// (see startRecording). Stopping returns the finished files (normally one; more if a call took the microphone away).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalMedia } from './db'
import { extFor, startRecording, type RecState, type Recording } from './media'

export interface RecorderControl {
  active: boolean
  state: RecState | null
  secs: number
  error: string | null
  start: () => Promise<void>
  togglePause: () => void
  /** Stop and return the recording as files named `${prefix}-<time>[-part2].webm`. */
  stop: (prefix: string) => Promise<LocalMedia[]>
  cancel: () => void
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function toFiles(parts: Blob[], prefix: string): LocalMedia[] {
  const t = Date.now()
  return parts.map((b, i) => ({ name: `${prefix}-${t}${i ? `-part${i + 1}` : ''}.${extFor(b.type)}`, type: b.type, blob: b }))
}

export function useRecorder(onChunk?: (piece: Blob) => void): RecorderControl {
  const rec = useRef<Recording | null>(null)
  const [state, setState] = useState<RecState | null>(null)
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!state) return
    const id = setInterval(() => setSecs(rec.current?.elapsed() ?? 0), 500)
    return () => clearInterval(id)
  }, [state])
  useEffect(() => () => rec.current?.cancel(), [])

  const start = useCallback(async () => {
    setError(null)
    try {
      setSecs(0)
      rec.current = await startRecording(onChunk, setState)
      setState('recording')
    } catch {
      setError('Microphone blocked. Allow it for SPATREN in your phone settings, then try again.')
    }
  }, [onChunk])

  const togglePause = useCallback(() => {
    const r = rec.current
    if (!r) return
    if (r.state() === 'recording') r.pause()
    else void r.resume().catch(() => setError("The microphone is still busy (a call?). Try Resume again in a moment."))
  }, [])

  const stop = useCallback(async (prefix: string) => {
    const r = rec.current
    if (!r) return []
    rec.current = null
    setSecs(r.elapsed())
    setState(null)
    return toFiles(await r.stop(), prefix)
  }, [])

  const cancel = useCallback(() => {
    rec.current?.cancel()
    rec.current = null
    setState(null)
  }, [])

  return { active: state != null, state, secs, error, start, togglePause, stop, cancel }
}
