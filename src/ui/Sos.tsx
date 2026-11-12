import { useEffect, useRef, useState } from 'react'
import { db } from '../lib/db'
import { clock, mapsLink } from '../lib/geo'
import { myBatch } from '../lib/batch'
import { sendSos } from '../lib/sync'
import { currentFix, getLastFix } from '../lib/tracking'

const HOLD_MS = 2000
const COORD_KEY = 'spatren.coordinator'

interface Coordinator {
  coordinator_name: string | null
  coordinator_phone: string | null
}

function cachedCoordinator(): Coordinator | null {
  try {
    return JSON.parse(localStorage.getItem(COORD_KEY) ?? 'null') as Coordinator | null
  } catch {
    return null
  }
}

type Outcome = { id: string; delivered: boolean; lat: number | null; lng: number | null; at: string; locationAt: string | null }

interface SosProps {
  name: string
  variant?: 'bar' | 'fab'
}

export default function Sos({ name, variant = 'bar' }: SosProps) {
  const [holding, setHolding] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [coord, setCoord] = useState<Coordinator | null>(cachedCoordinator())
  const btn = useRef<HTMLButtonElement>(null)
  const raf = useRef(0)
  const start = useRef(0)

  useEffect(() => {
    // This batch's emergency contact (each class sets its own in Admin).
    void myBatch().then((b) => {
      if (!b) return
      const c = { coordinator_name: b.coordinator_name, coordinator_phone: b.coordinator_phone }
      setCoord(c)
      localStorage.setItem(COORD_KEY, JSON.stringify(c))
    })
    // Keep retrying queued SOS every 10 s, independent of Field Mode and of any running sync.
    const retry = setInterval(() => void db.sos.count().then((n) => (n > 0 ? sendSos() : true)), 10_000)
    return () => clearInterval(retry)
  }, [])

  function begin() {
    setHolding(true)
    start.current = performance.now()
    navigator.vibrate?.(30)
    const tick = (t: number) => {
      const p = Math.min(1, (t - start.current) / HOLD_MS)
      btn.current?.style.setProperty('--p', String(p))
      if (p >= 1) return void fire()
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  function cancel() {
    cancelAnimationFrame(raf.current)
    setHolding(false)
    btn.current?.style.setProperty('--p', '0')
  }

  async function fire() {
    cancel()
    navigator.vibrate?.([200, 100, 200])
    // 1. Persist instantly with the last known position (its own timestamp travels with it).
    const last = getLastFix()
    const id = crypto.randomUUID()
    const created_at = new Date().toISOString()
    await db.sos.add({ id, lat: last?.lat ?? null, lng: last?.lng ?? null, accuracy: last?.accuracy ?? null, battery: null, location_at: last?.at ?? null, created_at })
    // 2. Try for a fresh fix + battery, then update the queued alert before sending.
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    const [fix, bat] = await Promise.all([currentFix(6000), nav.getBattery?.().catch(() => null) ?? Promise.resolve(null)])
    const better = fix && (!last || fix.at > last.at) ? fix : last
    await db.sos.update(id, {
      lat: better?.lat ?? null, lng: better?.lng ?? null, accuracy: better?.accuracy ?? null, location_at: better?.at ?? null,
      battery: bat ? Math.round(bat.level * 100) : null,
    })
    const delivered = (await sendSos()) && (await db.sos.get(id)) === undefined
    setOutcome({ id, delivered, lat: better?.lat ?? null, lng: better?.lng ?? null, at: created_at, locationAt: better?.at ?? null })
  }

  const phone = coord?.coordinator_phone?.replace(/[^\d+]/g, '')
  const smsBody = outcome
    ? `SOS from ${name} (SPATREN) at ${clock(outcome.at)}. ${outcome.lat != null ? `Location (GPS ${clock(outcome.locationAt)}): ${mapsLink(outcome.lat, outcome.lng!)}` : 'Location unknown.'}`
    : ''

  return (
    <>
      <button
        ref={btn}
        className={`${variant === 'fab' ? 'sos-fab' : 'sos'} ${holding ? 'holding' : ''}`}
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Emergency SOS. Press and hold for two seconds."
      >
        {variant === 'fab' ? (
          <span>SOS</span>
        ) : (
          <>
            <div className="fill" />
            <span>{holding ? 'Keep holding…' : 'SOS · hold 2 seconds'}</span>
          </>
        )}
      </button>

      {outcome && (
        <div className="sheet-backdrop" onClick={() => setOutcome(null)}>
          <div className="sheet stack" onClick={(e) => e.stopPropagation()}>
            {outcome.delivered ? (
              <>
                <span className="chip chip-danger" style={{ alignSelf: 'flex-start' }}>Alert delivered · {clock(outcome.at)}</span>
                <h2>Coordinators have been alerted</h2>
                <p className="muted">They can see your location. Stay where you are if it is safe, and keep this screen open.</p>
              </>
            ) : (
              <>
                <span className="chip chip-danger" style={{ alignSelf: 'flex-start' }}>Not delivered: no connection</span>
                <h2>Send it by SMS or call now</h2>
                <p className="small muted">It keeps retrying every 10 seconds in the background.</p>
                <p className="muted">
                  Your alert is saved and will send automatically when you get signal. SMS and calls often work when data doesn't.
                </p>
              </>
            )}
            {phone ? (
              <div className="row">
                <a className="btn btn-danger grow" href={`sms:${phone}?&body=${encodeURIComponent(smsBody)}`}>Send SMS</a>
                <a className="btn btn-ghost grow" href={`tel:${phone}`}>Call {coord?.coordinator_name ?? 'admin'}</a>
              </div>
            ) : (
              <p className="small card-flat">No emergency number is set yet. Ask the admin to add it in Admin → People & settings.</p>
            )}
            <a className="btn btn-ghost" href="tel:119">Call 119 (Police emergency)</a>
            <button className="btn btn-ghost" onClick={() => setOutcome(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
