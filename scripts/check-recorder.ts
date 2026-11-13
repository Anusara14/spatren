// Self-check for recording through pauses and phone calls, with a simulated microphone. Run: node scripts/check-recorder.ts
import assert from 'node:assert/strict'

// ---- a tiny fake browser: microphone tracks and MediaRecorder ----
class FakeTrack {
  onmute: (() => void) | null = null
  onunmute: (() => void) | null = null
  onended: (() => void) | null = null
  stopped = false
  stop() { this.stopped = true }
}
const streams: { track: FakeTrack }[] = []
let micBusy = false
class FakeRecorder {
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  stream: { track: FakeTrack }
  constructor(stream: { track: FakeTrack }) { this.stream = stream }
  start() { this.state = 'recording' }
  pause() { this.state = 'paused' }
  resume() { this.state = 'recording' }
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text]) }) }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.()) // like the browser: stop finishes asynchronously
  }
  requestData() {}
  addEventListener() {}
}
const recorders: FakeRecorder[] = []
const g = globalThis as Record<string, unknown>
g.MediaRecorder = new Proxy(FakeRecorder, { construct: (T, args) => { const r = new T(...(args as [{ track: FakeTrack }])); recorders.push(r); return r } })
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => {
  if (micBusy) throw new Error('NotReadableError')
  const s = { track: new FakeTrack(), getAudioTracks() { return [this.track] }, getTracks() { return [this.track] } }
  streams.push(s)
  return s
} } }, configurable: true })
g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }

const { startRecording } = await import('../src/lib/media.ts')
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

// 1. Pause / resume by hand; elapsed doesn't count the pause
{
  const states: string[] = []
  const r = await startRecording(undefined, (s) => states.push(s))
  recorders.at(-1)!.emit('a')
  r.pause()
  assert.equal(r.state(), 'paused')
  assert.equal(recorders.at(-1)!.state, 'paused')
  await r.resume()
  assert.equal(r.state(), 'recording')
  recorders.at(-1)!.emit('b')
  const parts = await r.stop()
  assert.equal(parts.length, 1)
  assert.equal(await parts[0].text(), 'ab')
  assert.deepEqual(states.slice(0, 2), ['paused', 'recording'])
}

// 2. Android call: the microphone is muted, recording pauses itself, and carries on after the call
{
  const r = await startRecording()
  const rec = recorders.at(-1)!
  rec.emit('before ')
  streams.at(-1)!.track.onmute?.()
  assert.equal(r.state(), 'interrupted')
  assert.equal(rec.state, 'paused')
  streams.at(-1)!.track.onunmute?.()
  assert.equal(r.state(), 'recording')
  rec.emit('after')
  const parts = await r.stop()
  assert.equal(parts.length, 1)
  assert.equal(await parts[0].text(), 'before after')
}

// 3. A call ending while the student had paused by hand must not resume it
{
  const r = await startRecording()
  r.pause()
  streams.at(-1)!.track.onunmute?.()
  assert.equal(r.state(), 'paused')
  await r.stop()
}

// 4. iPhone call: the microphone is taken away. Part 1 is kept; recording continues as part 2 when it's free.
{
  const r = await startRecording()
  recorders.at(-1)!.emit('part one')
  micBusy = true
  streams.at(-1)!.track.onended?.()
  assert.equal(r.state(), 'interrupted')
  await tick(2200) // retry while the call goes on: microphone still busy
  assert.equal(r.state(), 'interrupted')
  micBusy = false
  await r.resume() // student taps Resume after the call (the automatic retry would also do it)
  assert.equal(r.state(), 'recording')
  recorders.at(-1)!.emit('part two')
  const parts = await r.stop()
  assert.deepEqual(await Promise.all(parts.map((p) => p.text())), ['part one', 'part two'])
}

// 5. Stopping during a call (part still finishing) still returns that part
{
  const r = await startRecording()
  recorders.at(-1)!.emit('kept')
  micBusy = true
  streams.at(-1)!.track.onended?.()
  const parts = await r.stop()
  micBusy = false
  assert.deepEqual(await Promise.all(parts.map((p) => p.text())), ['kept'])
}

console.info('recording through pauses and phone calls: all checks passed')
