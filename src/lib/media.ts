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
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const mimeType = pickAudioMime()
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(5_000) // flush every 5 s so a crash loses at most a few seconds
  const release = () => stream.getTracks().forEach((t) => t.stop())
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
  }
}
