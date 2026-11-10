// AI follow-up questions for open interviews (Google Gemini, free API key from aistudio.google.com).
// Only runs when the student taps "Suggest follow-ups": the last ~2 minutes of audio go straight from the phone to
// Google with the student's (or the class) key. Nothing else ever leaves the phone through this file.

export const DEFAULT_MODEL = 'gemini-flash-lite-latest' // always Google's current fast, free-tier model
const KEY = 'spatren.ai'
const CLASS_KEY = 'spatren.ai.class'
const CLIP_SECONDS = 120

export interface AiConfig {
  key: string
  model: string
  source: 'mine' | 'class'
}

export interface FollowUp {
  si: string
  en: string
}

export interface Suggestion {
  summary: string
  questions: FollowUp[]
}

function read<T>(k: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null
  } catch {
    return null
  }
}

export function myAiKey(): { key: string; model: string } | null {
  const v = read<{ key: string; model: string }>(KEY)
  return v?.key ? { key: v.key, model: v.model || DEFAULT_MODEL } : null
}

export function saveMyAiKey(key: string, model = DEFAULT_MODEL): void {
  if (key.trim()) localStorage.setItem(KEY, JSON.stringify({ key: key.trim(), model }))
  else localStorage.removeItem(KEY)
}

/** Personal key first, else the class key the admin set (cached so it works offline-to-online). */
export async function aiConfig(): Promise<AiConfig | null> {
  const mine = myAiKey()
  if (mine) return { ...mine, source: 'mine' }
  try {
    const { supabase } = await import('./supabase')
    const { data } = await supabase.from('settings').select('ai_key').eq('id', 1).maybeSingle()
    const k = (data as { ai_key: string | null } | null)?.ai_key
    if (k) localStorage.setItem(CLASS_KEY, k)
    else if (data) localStorage.removeItem(CLASS_KEY)
  } catch {
    /* offline: use the cached class key */
  }
  const cls = localStorage.getItem(CLASS_KEY)
  return cls ? { key: cls, model: DEFAULT_MODEL, source: 'class' } : null
}

/** Last CLIP_SECONDS of the recording as 16 kHz mono WAV (a format Gemini always accepts). */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const start = Math.max(0, buf.duration - CLIP_SECONDS)
    const rate = 16_000
    const frames = Math.ceil((buf.duration - start) * rate)
    const off = new OfflineAudioContext(1, frames, rate)
    const src = off.createBufferSource()
    src.buffer = buf
    src.connect(off.destination)
    src.start(0, start)
    const pcm = (await off.startRendering()).getChannelData(0)
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2))
    const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
    str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true)
    out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data')
    out.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
    return new Blob([out], { type: 'audio/wav' })
  } finally {
    void ctx.close()
  }
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function buildPrompt(topic: string, earlier: string[], theme = ''): string {
  return [
    'You help a university urban-planning student run an open-ended field interview in Anuradhapura, Sri Lanka.',
    `Interview topic: ${topic || 'not given'}.`,
    theme ? `The student's research theme: ${theme}. Lean the questions towards it.` : '',
    'The audio is the latest part of the interview. People mostly speak Sinhala; some Tamil or English.',
    earlier.length ? `Questions already asked or suggested (do not repeat): ${earlier.map((q) => `"${q}"`).join('; ')}.` : '',
    'Reply with JSON only: {"summary": string, "questions": [{"si": string, "en": string}]}.',
    'summary: what the interviewee just said, in English, at most 2 short sentences.',
    'questions: exactly 3 open, neutral, non-leading follow-up questions that dig into what was just said',
    '(ask for an example, a reason, how it changed over time, who is affected, or what they would change).',
    'si = the question in Sinhala script (use Tamil script only if the interviewee clearly speaks Tamil). Never use any other language or script. en = English.',
    'If the audio is silent, unclear or not an interview, set summary to "Could not hear the person clearly." and give 3 general opening questions about the topic.',
    'Keep each question short and polite. Never pressure about politics, religion, income or personal identity.',
  ].filter(Boolean).join('\n')
}

// Sinhala (U+0D80–0DFF), Tamil (U+0B80–0BFF), zero-width joiners used in Sinhala conjuncts, Latin, digits, punctuation.
const SHOWN_SCRIPTS = /^[඀-෿஀-௿‌‍\sA-Za-z0-9\p{P}]+$/u

/** Validates Gemini's reply; throws a readable error instead of showing junk. */
export function parseSuggestion(text: string): Suggestion {
  const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Partial<Suggestion>
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q): q is FollowUp => !!q && typeof q.en === 'string' && q.en.trim() !== '')
    // Only Sinhala, Tamil or plain Latin text is shown; anything else (the model drifting into another script) falls back to English.
    .map((q) => ({ en: q.en.trim(), si: typeof q.si === 'string' && SHOWN_SCRIPTS.test(q.si.trim()) ? q.si.trim() : q.en.trim() }))
    .slice(0, 3)
  if (!questions.length) throw new Error('The AI reply had no questions. Try again.')
  return { summary: typeof raw.summary === 'string' ? raw.summary.trim() : '', questions }
}

export async function suggestFollowUps(cfg: AiConfig, audio: Blob, topic: string, earlier: string[], theme = ''): Promise<Suggestion> {
  let clip: Blob
  try {
    clip = await toWav(audio)
  } catch {
    clip = audio // couldn't decode on this phone: send the original recording (WebM/MP4) instead
  }
  if (clip.size > 15 * 1024 * 1024) throw new Error('Recording too long to send. Keep the clip under 2 minutes.')
  const body = {
    contents: [{ parts: [{ text: buildPrompt(topic, earlier, theme) }, { inline_data: { mime_type: clip.type.split(';')[0] || 'audio/webm', data: await base64(clip) } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.5 },
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    if (res.status === 429) throw new Error(cfg.source === 'class' ? 'The class AI key is busy. Try again in a minute, or add your own free key in Profile.' : 'Your free AI limit is used up for now. Try again in a minute.')
    if (res.status === 400 || res.status === 403) throw new Error('The AI key was refused. Check it in Profile → AI follow-ups.')
    throw new Error(`AI request failed (${res.status}). Try again.`)
  }
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return parseSuggestion(json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '')
}

/** Profile "Test key" button: a tiny text-only request. */
export async function testAiKey(key: string, model = DEFAULT_MODEL): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.trim() },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word OK.' }] }] }),
  })
  if (res.ok) return 'Key works.'
  if (res.status === 429) return 'Key works, but its free limit is used up right now.'
  return res.status === 400 || res.status === 403 ? 'Google refused this key. Copy it again from aistudio.google.com/apikey.' : `Could not check the key (${res.status}).`
}

/** Offline probes: always available, no key or signal needed. */
export const PROMPT_CARDS: FollowUp[] = [
  { si: 'ඒකට උදාහරණයක් කියන්න පුළුවන්ද?', en: 'Can you give me an example?' },
  { si: 'ඇයි ඔබ එහෙම හිතන්නේ?', en: 'Why do you think that is?' },
  { si: 'මේක කාලයත් එක්ක වෙනස් වුණේ කොහොමද?', en: 'How has this changed over time?' },
  { si: 'මේකෙන් වැඩියෙන්ම බලපෑම් වෙන්නේ කාටද?', en: 'Who is affected by this the most?' },
  { si: 'ඔබට වෙනස් කරන්න පුළුවන් නම්, මොනවද වෙනස් කරන්නේ?', en: 'If you could change it, what would you change?' },
  { si: 'ඒ ගැන තව ටිකක් කියන්න පුළුවන්ද?', en: 'Can you tell me a bit more about that?' },
]
