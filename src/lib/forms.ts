// SPATREN form definition: a small JSON schema modelled on XLSForm semantics (types, required,
// choices, show_if skip logic) so ChatGPT can write one and the app can render it offline.

export const QUESTION_TYPES = [
  'text', 'textarea', 'integer', 'decimal', 'select_one', 'select_multiple', 'yes_no',
  'rating', 'likert', 'date', 'time', 'gps', 'photo', 'audio', 'note',
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export interface ShowIf {
  question: string
  equals?: string | number | boolean
  in?: (string | number)[]
}

export interface Question {
  id: string
  type: QuestionType
  label: string
  hint?: string
  required?: boolean
  options?: string[]
  min?: number
  max?: number
  show_if?: ShowIf
}

export interface Section {
  title: string
  questions: Question[]
}

export interface FormDef {
  title: string
  description?: string
  sections: Section[]
}

export type Answer = string | number | boolean | string[] | { lat: number; lng: number; accuracy: number } | null
export type Answers = Record<string, Answer>

export const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']

const ID_RE = /^[a-z][a-z0-9_]{0,40}$/

// Validate untrusted JSON (pasted from ChatGPT or uploaded). Returns a clean definition or readable errors.
export function parseForm(raw: string): { form?: FormDef; errors: string[] } {
  let j: unknown
  try {
    j = JSON.parse(stripFences(raw))
  } catch (e: unknown) {
    return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : 'parse error'}. Paste only the JSON ChatGPT gave you.`] }
  }
  const errors: string[] = []
  const o = j as Record<string, unknown>
  if (!o || typeof o !== 'object') return { errors: ['The JSON must be an object with "title" and "sections".'] }
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) errors.push('Missing "title".')
  if (!Array.isArray(o.sections) || !o.sections.length) errors.push('"sections" must be a non-empty list.')

  const ids = new Set<string>()
  const sections: Section[] = []
  for (const [si, sRaw] of (Array.isArray(o.sections) ? o.sections : []).entries()) {
    const s = sRaw as Record<string, unknown>
    const where = `Section ${si + 1}`
    if (!Array.isArray(s?.questions) || !s.questions.length) {
      errors.push(`${where}: "questions" must be a non-empty list.`)
      continue
    }
    const questions: Question[] = []
    for (const [qi, qRaw] of s.questions.entries()) {
      const q = qRaw as Record<string, unknown>
      const at = `${where}, question ${qi + 1}`
      const id = String(q?.id ?? '').trim()
      const type = String(q?.type ?? '') as QuestionType
      const label = typeof q?.label === 'string' ? q.label.trim() : ''
      if (!ID_RE.test(id)) errors.push(`${at}: "id" must be lowercase letters, digits or _ (got "${id}").`)
      else if (ids.has(id)) errors.push(`${at}: duplicate id "${id}".`)
      ids.add(id)
      if (!QUESTION_TYPES.includes(type)) errors.push(`${at}: unknown type "${type}". Use one of: ${QUESTION_TYPES.join(', ')}.`)
      if (!label) errors.push(`${at}: missing "label".`)
      const options = Array.isArray(q?.options) ? q.options.map((x) => String(x).trim()).filter(Boolean) : undefined
      if ((type === 'select_one' || type === 'select_multiple') && (!options || options.length < 2)) {
        errors.push(`${at}: "${type}" needs an "options" list with at least 2 choices.`)
      }
      const showIf = q?.show_if as ShowIf | undefined
      if (showIf && (typeof showIf.question !== 'string' || !ids.has(showIf.question))) {
        errors.push(`${at}: show_if.question must refer to an EARLIER question id.`)
      }
      questions.push({
        id, type, label,
        hint: typeof q?.hint === 'string' ? q.hint : undefined,
        required: q?.required === true,
        options,
        min: typeof q?.min === 'number' ? q.min : undefined,
        max: typeof q?.max === 'number' ? q.max : undefined,
        show_if: showIf,
      })
    }
    sections.push({ title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : `Section ${si + 1}`, questions })
  }
  if (errors.length) return { errors }
  return { form: { title, description: typeof o.description === 'string' ? o.description : undefined, sections }, errors: [] }
}

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : s).trim()
}

export function isVisible(q: Question, answers: Answers): boolean {
  if (!q.show_if) return true
  const v = answers[q.show_if.question]
  if (v == null) return false
  const vals = Array.isArray(v) ? v.map(String) : [String(v)]
  if (q.show_if.equals !== undefined) return vals.includes(String(q.show_if.equals))
  if (q.show_if.in) return q.show_if.in.map(String).some((x) => vals.includes(x))
  return true
}

export function isAnswered(a: Answer | undefined): boolean {
  if (a == null || a === '') return false
  if (Array.isArray(a)) return a.length > 0
  return true
}

export function validateAnswer(q: Question, a: Answer | undefined): string | null {
  if (q.type === 'note') return null
  if (!isAnswered(a)) return q.required ? 'This question needs an answer.' : null
  if (q.type === 'integer' || q.type === 'decimal') {
    const n = Number(a)
    if (Number.isNaN(n)) return 'Enter a number.'
    if (q.type === 'integer' && !Number.isInteger(n)) return 'Enter a whole number.'
    if (q.min != null && n < q.min) return `Must be at least ${q.min}.`
    if (q.max != null && n > q.max) return `Must be at most ${q.max}.`
  }
  return null
}

export function flatQuestions(f: FormDef): Question[] {
  return f.sections.flatMap((s) => s.questions)
}

export function answerText(a: Answer | undefined): string {
  if (a == null) return ''
  if (Array.isArray(a)) return a.join('; ')
  if (typeof a === 'object') return `${a.lat.toFixed(6)},${a.lng.toFixed(6)}`
  return String(a)
}

export const SAMPLE_FORM: FormDef = {
  title: 'Street condition & resident perception',
  description: 'Quick street audit plus 3 resident questions. About 5 minutes.',
  sections: [
    {
      title: 'Street audit',
      questions: [
        { id: 'street_name', type: 'text', label: 'Street or junction name', required: true },
        { id: 'surface', type: 'select_one', label: 'Road surface condition', options: ['Good', 'Fair', 'Poor', 'Unpaved'], required: true },
        { id: 'footpath', type: 'yes_no', label: 'Is there a usable footpath?', required: true },
        { id: 'footpath_issues', type: 'select_multiple', label: 'Footpath problems', options: ['Broken', 'Blocked by vendors', 'Too narrow', 'No ramps', 'Flooding'], show_if: { question: 'footpath', equals: 'Yes' } },
        { id: 'street_photo', type: 'photo', label: 'Photo of the street' },
        { id: 'location', type: 'gps', label: 'Capture the location', required: true },
      ],
    },
    {
      title: 'Resident',
      questions: [
        { id: 'years_living', type: 'integer', label: 'How many years have you lived here?', min: 0, max: 100 },
        { id: 'safety', type: 'likert', label: 'I feel safe walking on this street at night.' },
        { id: 'priority', type: 'textarea', label: 'What should change first on this street?', hint: 'Sinhala, Tamil or English' },
        { id: 'voice', type: 'audio', label: 'Record the resident in their own words (with consent)' },
      ],
    },
  ],
}

export const CHATGPT_PROMPT = `You are helping urban-planning students build a field survey for the SPATREN app.
Create the survey I describe below and reply with ONLY one JSON object (no explanation) in exactly this format:

{
  "title": "Survey title",
  "description": "One sentence for the field team",
  "sections": [
    {
      "title": "Section title",
      "questions": [
        { "id": "snake_case_id", "type": "TYPE", "label": "Question text", "hint": "optional help", "required": true,
          "options": ["only", "for", "choice types"], "min": 0, "max": 10,
          "show_if": { "question": "earlier_question_id", "equals": "Yes" } }
      ]
    }
  ]
}

Rules:
- "type" must be one of: text, textarea, integer, decimal, select_one, select_multiple, yes_no, rating (1-5 stars), likert (5-point agree scale), date, time, gps, photo, audio, note (read-only text).
- Every "id" is unique, lowercase, letters/digits/underscore, starting with a letter.
- select_one and select_multiple need "options" (at least 2). yes_no answers are "Yes" / "No".
- "show_if" may only refer to an EARLIER question; use "equals" for one value or "in": [..] for several.
- Use "min"/"max" only for integer/decimal. Omit fields you don't need.
- Add a gps question where location matters, photo questions for physical conditions, and an audio question for open-ended interviews (with a consent note before it).
- Write labels in clear English (add Sinhala/Tamil in brackets if I ask).

My survey: `
