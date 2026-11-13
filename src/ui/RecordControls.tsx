import type { RecState } from '../lib/media'
import { mmss } from '../lib/useRecorder'
import { IconMic } from './icons'

interface Props {
  state: RecState | null
  secs: number
  /** e.g. "/ 1:00" for capped voice notes */
  limit?: string
  startLabel: string
  onStart: () => void
  onTogglePause: () => void
  onStop: () => void
}

/** Start · then Pause/Resume and Stop with the recorded time. A call pausing it is shown, not hidden. */
export default function RecordControls({ state, secs, limit, startLabel, onStart, onTogglePause, onStop }: Props) {
  if (!state)
    return (
      <button type="button" className="btn btn-ghost grow" onClick={onStart}>
        <IconMic width={20} /> {startLabel}
      </button>
    )
  return (
    <div className="rec-controls" role="group" aria-label="Recording">
      <span className={`rec-time tnum ${state}`} role="status">
        <span className="rec-dot" aria-hidden="true" />
        {state === 'interrupted' ? 'Paused by a call' : state === 'paused' ? 'Paused' : 'Recording'} · {mmss(secs)}{limit ? ` ${limit}` : ''}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onTogglePause}>{state === 'recording' ? 'Pause' : 'Resume'}</button>
      <button type="button" className="btn btn-danger btn-sm" onClick={onStop}>Stop</button>
    </div>
  )
}
