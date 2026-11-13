// Photos are shrunk on the phone before they ever hit the outbox: 12 MP camera shots → ~200 KB.
// ponytail: 1280 px / 0.65 keeps uploads ~200 KB so 150 students fit the 1 GB free storage; raise if storage is upgraded
export async function compressImage(file: File, maxSide = 1280, quality = 0.65): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file // unsupported format: keep the original rather than lose it
  }
}

export function pickAudioMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? ''
}

export const extFor = (mime: string): string =>
  mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('jpeg') ? 'jpg' : 'webm'

export type RecState = 'recording' | 'paused' | 'interrupted'

export interface Recording {
  /** Finished recording as one or more playable parts (a new part starts when a call takes the microphone away). */
  stop: () => Promise<Blob[]>
  cancel: () => void
  pause: () => void
  resume: () => Promise<void>
  state: () => RecState
  /** Seconds actually recorded (pauses and calls not counted). */
  elapsed: () => number
  /**
   * The recording so far, while it continues (for AI follow-ups). With `lastPieces`, only the header piece plus the
   * last N 5-second pieces: a 45-minute interview must never be decoded whole on a phone (hundreds of MB of RAM).
   */
  snapshot: (lastPieces?: number) => Promise<Blob>
}

// Speech-tuned bitrates: Opus stays clear at 16 kbps; AAC (older iPhones) gets muddy below 32 kbps.
// Speech recognisers resample to 16 kHz mono anyway, so higher rates mostly cost storage.
const bitrateFor = (mime: string) => (mime.includes('mp4') || mime.includes('aac') ? 32_000 : 16_000)
// Raw-ish audio transcribes better than browser noise suppression, which smears consonants; keep level steady.
const AUDIO: MediaTrackConstraints = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true }
const RETRY_MS = 2_000

interface Part {
  stream: MediaStream
  rec: MediaRecorder
  chunks: Blob[]
  ended: boolean
}

/**
 * onChunk receives each 5-second piece as it is recorded (open interviews save them to disk); onState hears every
 * pause, resume and interruption.
 *
 * Phone calls: Android mutes the microphone during a call, so the recording pauses itself and carries on when the
 * call ends. iOS (and some Android phones) take the microphone away altogether: what was recorded is kept as a part,
 * and recording continues as a new part as soon as the microphone is free again.
 */
export async function startRecording(onChunk?: (piece: Blob) => void, onState?: (s: RecState) => void): Promise<Recording> {
  const mimeType = pickAudioMime()
  const type = () => current?.rec.mimeType || mimeType || 'audio/webm'
  const parts: Blob[] = []
  let current: Part | null = null
  let state: RecState = 'recording'
  let byUser = false // paused with the button (a call ending must not resume it)
  let stopping = false
  let accMs = 0
  let since: number | null = Date.now()
  let retry: ReturnType<typeof setTimeout> | null = null
  const finishing: Promise<void>[] = [] // parts closing after a call took the microphone; stop() waits for them

  const setState = (s: RecState) => {
    if (s === state) return
    if (s === 'recording') since = Date.now()
    else if (since != null) {
      accMs += Date.now() - since
      since = null
    }
    state = s
    onState?.(s)
  }

  const finishPart = (p: Part) =>
    new Promise<void>((resolve) => {
      const done = () => {
        if (p.chunks.length) parts.push(new Blob(p.chunks, { type: p.rec.mimeType || mimeType || 'audio/webm' }))
        p.stream.getTracks().forEach((t) => t.stop())
        resolve()
      }
      if (p.rec.state === 'inactive') return done()
      p.rec.onstop = done
      try {
        p.rec.stop()
      } catch {
        done()
      }
    })

  // The microphone went away (call on iOS, another app took it): keep what we have, try again shortly.
  const onLost = (p: Part) => {
    if (stopping || p.ended) return
    p.ended = true
    finishing.push(finishPart(p))
    if (current === p) current = null
    setState('interrupted')
    scheduleRetry()
  }

  const scheduleRetry = () => {
    if (retry || stopping || byUser) return
    retry = setTimeout(() => {
      retry = null
      if (stopping || byUser || current) return
      void open().catch(() => scheduleRetry())
    }, RETRY_MS)
  }

  async function open(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: bitrateFor(mimeType) })
    const p: Part = { stream, rec, chunks: [], ended: false }
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      p.chunks.push(e.data)
      onChunk?.(e.data)
    }
    rec.onerror = () => onLost(p)
    const track = stream.getAudioTracks()[0]
    if (track) {
      track.onended = () => onLost(p)
      // Android: muted for the length of a call, then unmuted.
      track.onmute = () => {
        if (state === 'recording' && rec.state === 'recording') {
          rec.pause()
          setState('interrupted')
        }
      }
      track.onunmute = () => {
        if (state === 'interrupted' && !byUser && rec.state === 'paused') {
          rec.resume()
          setState('recording')
        }
      }
    }
    rec.start(5_000) // flush every 5 s so a crash loses at most a few seconds
    current = p
    if (!byUser) setState('recording')
  }

  await open()

  // iOS stops the microphone when the screen locks: keep it awake for the whole recording.
  let lock: WakeLockSentinel | null = null
  const keepAwake = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
    } catch {
      lock = null
    }
  }
  const onVis = () => {
    if (document.visibilityState !== 'visible' || stopping) return
    void keepAwake()
    if (state === 'interrupted' && !current) scheduleRetry() // back from a call: pick the microphone up again
  }
  void keepAwake()
  document.addEventListener('visibilitychange', onVis)
  const release = () => {
    if (retry) clearTimeout(retry)
    document.removeEventListener('visibilitychange', onVis)
    void lock?.release().catch(() => undefined)
    lock = null
  }

  return {
    stop: async () => {
      stopping = true
      release()
      setState('paused') // closes the time count
      if (current) finishing.push(finishPart(current))
      current = null
      await Promise.all(finishing)
      return parts.filter((b) => b.size > 0)
    },
    cancel: () => {
      stopping = true
      release()
      if (current) {
        current.rec.ondataavailable = null
        current.rec.onstop = null
        try {
          current.rec.stop()
        } catch {
          /* already stopped */
        }
        current.stream.getTracks().forEach((t) => t.stop())
      }
      current = null
    },
    pause: () => {
      byUser = true
      if (current?.rec.state === 'recording') current.rec.pause()
      setState('paused')
    },
    resume: async () => {
      byUser = false
      if (current && current.rec.state === 'paused') {
        current.rec.resume()
        setState('recording')
      } else if (!current) await open() // the microphone was taken away: start the next part now
    },
    state: () => state,
    elapsed: () => Math.round((accMs + (since != null ? Date.now() - since : 0)) / 1000),
    snapshot: (lastPieces?: number) =>
      new Promise<Blob>((resolve) => {
        const chunks = current?.chunks ?? []
        // The first piece carries the container header (WebM/MP4 init), so header + recent pieces still decodes.
        const pick = () => (lastPieces && chunks.length > lastPieces + 1 ? [chunks[0], ...chunks.slice(-lastPieces)] : chunks)
        if (!current || current.rec.state !== 'recording') return resolve(new Blob(pick(), { type: type() }))
        const done = () => resolve(new Blob(pick(), { type: type() }))
        current.rec.addEventListener('dataavailable', done, { once: true }) // runs after ondataavailable has pushed the chunk
        current.rec.requestData()
      }),
  }
}
