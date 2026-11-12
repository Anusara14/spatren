// Optional online helpers (Gemini, the user's own free key): Sinhala -> English translation and theme summaries.
// Nothing here runs unless a key is saved in Settings; transcription itself never leaves the laptop.

const MODEL = 'gemini-flash-lite-latest'
const KEY = 'spatren.desktop.ai'
const BATCH = 40 // lines per translation request

export const aiKey = (): string => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
export const saveAiKey = (k: string): void => {
  try {
    if (k.trim()) localStorage.setItem(KEY, k.trim())
    else localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: key just isn't remembered */
  }
}

async function generate(key: string, prompt: string, json: boolean): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  })
  if (res.status === 400 || res.status === 403) throw new Error('Gemini rejected the key. Check it in Settings.')
  if (res.status === 429) throw new Error('Gemini free limit reached for now. Wait a minute and try again.')
  if (!res.ok) throw new Error(`Gemini error ${res.status}. Check the internet connection.`)
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
}

export async function testKey(key: string): Promise<void> {
  await generate(key, 'Reply with the word OK.', false)
}

/** Translate Sinhala transcript lines to English, keeping the line order. Returns one English line per input. */
export async function translateLines(key: string, lines: string[], onProgress?: (done: number) => void): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH)
    const prompt =
      'Translate each line of this Sinhala interview transcript (Anuradhapura, Sri Lanka; urban planning fieldwork) into plain English. ' +
      'The transcript is machine-made and may contain mistakes: translate the most likely meaning, keep place names. ' +
      `Return a JSON array of exactly ${chunk.length} strings, one per input line, in the same order.\n\n` +
      JSON.stringify(chunk)
    const parsed = JSON.parse(await generate(key, prompt, true)) as unknown
    if (!Array.isArray(parsed) || parsed.length !== chunk.length) throw new Error('Translation came back incomplete. Try again.')
    out.push(...parsed.map((s) => String(s)))
    onProgress?.(out.length)
  }
  return out
}

export interface ThemeSummary {
  themes: { name: string; summary: string; quotes: string[] }[]
}

/** Draft the main themes across a set of interviews, each with short supporting quotes, for students to check. */
export async function summariseThemes(key: string, context: string, interviews: { label: string; text: string }[]): Promise<ThemeSummary> {
  // ponytail: one request with a size cap; chunk-and-merge if subgroups exceed ~150k characters of transcript
  const body = interviews.map((i) => `### ${i.label}\n${i.text}`).join('\n\n').slice(0, 150_000)
  const prompt =
    `You are helping urban planning students analyse field interviews (${context}) from Anuradhapura, Sri Lanka. ` +
    'The transcripts are Sinhala machine transcriptions and may contain errors. ' +
    'Identify the 4 to 8 main themes. For each give a short English name, a 2-3 sentence English summary, and up to 3 short supporting quotes ' +
    'copied from the transcripts (keep them in Sinhala exactly as written). ' +
    'Return JSON: {"themes":[{"name":"","summary":"","quotes":[""]}]}\n\n' +
    body
  const parsed = JSON.parse(await generate(key, prompt, true)) as ThemeSummary
  if (!Array.isArray(parsed?.themes)) throw new Error('The summary came back in an unexpected shape. Try again.')
  return parsed
}
