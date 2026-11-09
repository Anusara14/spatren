import { useRef, useState, type PointerEvent } from 'react'
import { IconChevrons, IconWalk } from './icons'

interface Props {
  active: boolean
  status: string
  onToggle: () => void
  onOpen: () => void
}

const TRIGGER = 0.55 // fraction of the track a swipe must cover to start

// Lime walker = tap to start/stop. Glass pill = swipe right to start (or tap for details), like a slide-to-unlock.
export default function SwipeDock({ active, status, onToggle, onOpen }: Props) {
  const track = useRef<HTMLButtonElement>(null)
  const start = useRef<{ x: number; w: number } | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)

  function down(e: PointerEvent<HTMLButtonElement>) {
    if (active) return // swiping only starts; stopping is a deliberate tap
    const r = track.current!.getBoundingClientRect()
    start.current = { x: e.clientX, w: r.width - 64 }
    track.current!.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!start.current) return
    setDx(Math.max(0, Math.min(start.current.w, e.clientX - start.current.x)))
  }

  function up() {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s) return onOpen() // active: plain tap opens details
    if (dx > s.w * TRIGGER) {
      navigator.vibrate?.(25)
      onToggle()
    } else if (dx < 6) onOpen()
    setDx(0)
  }

  const progress = start.current ? dx / Math.max(1, start.current.w) : 0
  return (
    <div className="dock">
      <button className={`dock-main ${active ? 'on' : ''}`} onClick={onToggle} aria-pressed={active} aria-label={active ? 'Stop Field Mode' : 'Start Field Mode'}>
        <IconWalk width={30} height={30} />
      </button>
      <button
        ref={track}
        className={`dock-pill ${active ? 'is-on' : ''} ${dragging ? 'dragging' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { start.current = null; setDragging(false); setDx(0) }}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), active ? onOpen() : onToggle())}
        aria-label={active ? 'Field Mode details' : 'Swipe right to start Field Mode'}
      >
        {!active && (
          <span className="swipe-knob" style={{ transform: `translateX(${dx}px)` }} aria-hidden="true">
            <IconChevrons width={20} height={20} />
          </span>
        )}
        <span className="dock-text" style={{ opacity: 1 - progress * 1.2 }}>
          <b>{active ? 'Field Mode on' : 'Swipe to start'}</b>
          <span>{active ? status : 'Share your location'}</span>
        </span>
        {active && <IconChevrons width={20} height={20} className="dock-chev" />}
      </button>
    </div>
  )
}
