import { notify } from './meeting'

// Loud enough to hear across a room: three beeps, a vibration and a system notification. Never throws.
export function sosAlarm(who: string): void {
  try {
    const ctx = new AudioContext()
    void ctx.resume()
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      o.connect(g).connect(ctx.destination)
      const t = ctx.currentTime + i * 0.45
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o.start(t)
      o.stop(t + 0.36)
    }
  } catch {
    /* audio blocked until the admin interacts with the page */
  }
  void notify(`SOS from ${who}`, 'Open SPATREN to see their location.', 'sos')
}
