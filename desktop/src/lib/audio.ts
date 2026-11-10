// Phone recordings (WebM/Opus or MP4/AAC) -> 16 kHz mono 16-bit WAV, the input whisper.cpp expects.
// Decoding straight at 16 kHz keeps memory sane: a 1-hour interview is ~115 MB of samples, not ~700 MB.

export async function toWav16k(url: string): Promise<Uint8Array> {
  const bytes = await (await fetch(url)).arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16_000 })
  try {
    const buf = await ctx.decodeAudioData(bytes)
    const pcm = mono(buf)
    return encodeWav(pcm, 16_000)
  } finally {
    void ctx.close()
  }
}

function mono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0)
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels
  }
  return out
}

export function encodeWav(pcm: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data')
  out.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  return new Uint8Array(out.buffer)
}
