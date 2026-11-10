// Photos are shrunk on the phone before they ever hit the outbox: 12 MP camera shots → ~300 KB.
export async function compressImage(file: File, maxSide = 1600, quality = 0.72): Promise<Blob> {
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

export interface Recording {
  stop: () => Promise<Blob>
  cancel: () => void
  /**
   * The recording so far, while it continues (for AI follow-ups). With `lastPieces`, only the header piece plus the
   * last N 5-second pieces: a 45-minute interview must never be decoded whole on a phone (hundreds of MB of RAM).
   */
  snapshot: (lastPieces?: number) => Promise<Blob>
}

// Speech-tuned bitrates: Opus stays clear at 16 kbps; AAC (older iPhones) gets muddy below 32 kbps.
// Speech recognisers resample to 16 kHz mono anyway, so higher rates mostly cost storage.
const bitrateFor = (mime: string) => (mime.includes('mp4') || mime.includes('aac') ? 32_000 : 16_000)

/** onChunk receives each 5-second piece as it is recorded (open interviews save them to disk). */
export async function startRecording(onChunk?: (piece: Blob) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Raw-ish audio transcribes better than browser noise suppression, which smears consonants; keep level steady.
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  })
  const mimeType = pickAudioMime()
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: bitrateFor(mimeType) })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    chunks.push(e.data)
    onChunk?.(e.data)
  }
  rec.start(5_000) // flush every 5 s so a crash loses at most a few seconds
  // iOS stops the microphone when the screen locks: keep it awake for the whole recording.
  let lock: WakeLockSentinel | null = null
  const keepAwake = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
    } catch {
      lock = null
    }
  }
  const onVis = () => document.visibilityState === 'visible' && rec.state === 'recording' && void keepAwake()
  void keepAwake()
  document.addEventListener('visibilitychange', onVis)
  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    document.removeEventListener('visibilitychange', onVis)
    void lock?.release().catch(() => undefined)
    lock = null
  }
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }))
        }
        rec.stop()
      }),
    cancel: () => {
      rec.onstop = release
      rec.stop()
    },
    snapshot: (lastPieces?: number) =>
      new Promise<Blob>((resolve) => {
        const type = rec.mimeType || mimeType || 'audio/webm'
        // The first piece carries the container header (WebM/MP4 init), so header + recent pieces still decodes.
        const pick = () => (lastPieces && chunks.length > lastPieces + 1 ? [chunks[0], ...chunks.slice(-lastPieces)] : chunks)
        if (rec.state !== 'recording') return resolve(new Blob(pick(), { type }))
        const done = () => resolve(new Blob(pick(), { type }))
        rec.addEventListener('dataavailable', done, { once: true }) // runs after ondataavailable has pushed the chunk
        rec.requestData()
      }),
  }
}
