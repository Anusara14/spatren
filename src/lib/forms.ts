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
  /** record audio for the whole survey, from the first question to submit (interview-style surveys) */
  record_audio?: boolean
  sections: Section[]
}

export type Answer = string | number | boolean | string[] | { lat: number; lng: number; accuracy: number } | null
export type Answers = Record<string, Answer>

export const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']

const ID_RE = /^[a-z][a-z0-9_]{0,40}$/

// Validate untrusted JSON (pasted from ChatGPT or uploaded). Returns a clean definition or readable errors.
export function parseForm(raw: string): { form?: FormDef; errors: string[]; warnings: string[] } {
  let j: unknown
  const text = stripFences(raw)
  try {
    j = JSON.parse(text)
  } catch (e: unknown) {
    try {
      j = JSON.parse(lenient(text)) // trailing commas, // comments, smart quotes
    } catch {
      return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : 'parse error'}. Paste only the JSON block the AI gave you.`], warnings: [] }
    }
  }
  const errors: string[] = []
  const warnings: string[] = []
  const o = normalize(j)
  if (!o || typeof o !== 'object') return { errors: ['The JSON must describe a form with a title and questions.'], warnings }
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) errors.push('Missing "title".')
  if (!Array.isArray(o.sections) || !o.sections.length) errors.push('No questions found. The JSON needs a "questions" or "sections" list.')

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
      let type = String(q?.type ?? '') as QuestionType
      const label = typeof q?.label === 'string' ? q.label.trim() : ''
      if (!ID_RE.test(id)) errors.push(`${at}: "id" must be lowercase letters, digits or _ (got "${id}").`)
      else if (ids.has(id)) errors.push(`${at}: duplicate id "${id}".`)
      ids.add(id)
      if (!QUESTION_TYPES.includes(type)) {
        warnings.push(`${at} (“${label || id}”): type "${type || 'missing'}" isn't supported, so it was imported as short text.`)
        type = 'text'
      }
      if (!label) errors.push(`${at}: missing "label".`)
      const options = Array.isArray(q?.options) ? q.options.map((x) => String(x).trim()).filter(Boolean) : undefined
      if ((type === 'select_one' || type === 'select_multiple') && (!options || options.length < 2)) {
        errors.push(`${at}: "${type}" needs an "options" list with at least 2 choices.`)
      }
      let showIf = q?.show_if as ShowIf | undefined
      if (showIf && (typeof showIf.question !== 'string' || !ids.has(showIf.question) || showIf.question === id)) {
        warnings.push(`${at} (“${label || id}”): its condition points to "${showIf.question}", which isn't an earlier question, so it will always be shown.`)
        showIf = undefined
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
  if (errors.length) return { errors, warnings }
  return { form: { title, description: typeof o.description === 'string' ? o.description : undefined, record_audio: o.record_audio === true || undefined, sections }, errors: [], warnings }
}

// ---------- Tolerant import: accept the shapes ChatGPT / Gemini / Claude actually produce ----------

const TYPE_ALIASES: Record<string, QuestionType> = {
  text: 'text', short_text: 'text', shorttext: 'text', string: 'text', input: 'text', short_answer: 'text', name: 'text',
  textarea: 'textarea', long_text: 'textarea', longtext: 'textarea', paragraph: 'textarea', essay: 'textarea',
  open_ended: 'textarea', open: 'textarea', comment: 'textarea', comments: 'textarea', long_answer: 'textarea',
  integer: 'integer', int: 'integer', number: 'integer', numeric: 'integer', count: 'integer',
  decimal: 'decimal', float: 'decimal', double: 'decimal', currency: 'decimal',
  select_one: 'select_one', single_choice: 'select_one', single_select: 'select_one', radio: 'select_one', dropdown: 'select_one',
  select: 'select_one', choice: 'select_one', multiple_choice: 'select_one', mcq: 'select_one', option: 'select_one',
  select_multiple: 'select_multiple', multi_select: 'select_multiple', multiselect: 'select_multiple', checkbox: 'select_multiple',
  checkboxes: 'select_multiple', multiple_select: 'select_multiple', multi_choice: 'select_multiple', multiple_answer: 'select_multiple',
  yes_no: 'yes_no', yesno: 'yes_no', boolean: 'yes_no', bool: 'yes_no', true_false: 'yes_no', acknowledge: 'yes_no',
  rating: 'rating', stars: 'rating', star_rating: 'rating', scale: 'rating', range: 'rating',
  likert: 'likert', agreement: 'likert', likert_scale: 'likert', agree_disagree: 'likert',
  date: 'date', datetime: 'date', day: 'date', time: 'time',
  gps: 'gps', geopoint: 'gps', location: 'gps', coordinates: 'gps', geolocation: 'gps', map: 'gps',
  photo: 'photo', image: 'photo', picture: 'photo', camera: 'photo', file_image: 'photo',
  audio: 'audio', voice: 'audio', recording: 'audio', voice_note: 'audio', audio_recording: 'audio',
  note: 'note', info: 'note', instruction: 'note', instructions: 'note', text_block: 'note', description: 'note', consent_note: 'note',
}

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}

const slugId = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 40) || 'q'

function labelOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const l = v as Record<string, unknown>
    // multilingual labels: prefer English, else the first value
    return String(l.en ?? l.English ?? l.english ?? l['label::English (en)'] ?? Object.values(l)[0] ?? '')
  }
  return v == null ? '' : String(v)
}

function normalize(input: unknown): Record<string, unknown> {
  let root = input as Record<string, unknown> | unknown[]
  if (Array.isArray(root)) root = { title: 'Imported survey', questions: root }
  let o = root as Record<string, unknown>
  for (const wrap of ['form', 'survey_form', 'questionnaire']) if (o[wrap] && typeof o[wrap] === 'object' && !Array.isArray(o[wrap])) o = { ...(o[wrap] as Record<string, unknown>), ...o, [wrap]: undefined }

  // XLSForm-style JSON: { survey: [{type:"select_one yn", name, label}], choices: [{list_name, name, label}] }
  const choiceLists = new Map<string, string[]>()
  if (Array.isArray(o.choices)) {
    for (const c of o.choices as Record<string, unknown>[]) {
      const list = String(pick(c, 'list_name', 'list', 'listName') ?? '')
      if (list) choiceLists.set(list, [...(choiceLists.get(list) ?? []), labelOf(pick(c, 'label', 'name', 'value'))])
    }
  }
  const rawSections = pick(o, 'sections', 'pages', 'groups', 'steps', 'parts')
  const rawQuestions = pick(o, 'questions', 'fields', 'items', 'survey', 'elements')
  let sections: Record<string, unknown>[] = Array.isArray(rawSections)
    ? (rawSections as Record<string, unknown>[])
    : Array.isArray(rawQuestions)
      ? [{ title: 'Questions', questions: rawQuestions }]
      : []
  // XLSForm begin_group/end_group rows → sections
  if (!Array.isArray(rawSections) && Array.isArray(rawQuestions) && (rawQuestions as Record<string, unknown>[]).some((r) => /begin[_ ]group/i.test(String(r?.type ?? '')))) {
    sections = []
    let cur: Record<string, unknown> = { title: 'Questions', questions: [] as unknown[] }
    for (const r of rawQuestions as Record<string, unknown>[]) {
      const t = String(r?.type ?? '')
      if (/begin[_ ]group/i.test(t)) {
        if ((cur.questions as unknown[]).length) sections.push(cur)
        cur = { title: labelOf(r.label) || String(r.name ?? 'Section'), questions: [] }
      } else if (/end[_ ]group/i.test(t)) {
        if ((cur.questions as unknown[]).length) sections.push(cur)
        cur = { title: 'More questions', questions: [] }
      } else (cur.questions as unknown[]).push(r)
    }
    if ((cur.questions as unknown[]).length) sections.push(cur)
  }

  const used = new Set<string>()
  const normSections = sections.map((s, si) => {
    const qs = pick(s, 'questions', 'fields', 'items', 'elements')
    return {
      title: labelOf(pick(s, 'title', 'name', 'label', 'heading')) || `Section ${si + 1}`,
      questions: (Array.isArray(qs) ? (qs as Record<string, unknown>[]) : []).map((q) => normalizeQuestion(q, choiceLists, used)),
    }
  })
  return {
    title: labelOf(pick(o, 'title', 'name', 'form_title', 'survey_title')) || 'Imported survey',
    description: labelOf(pick(o, 'description', 'intro', 'instructions', 'subtitle')) || undefined,
    record_audio: o.record_audio === true || o.record_audio === 'yes' || undefined,
    sections: normSections,
  }
}

function normalizeQuestion(q: Record<string, unknown>, lists: Map<string, string[]>, used: Set<string>): Record<string, unknown> {
  if (!q || typeof q !== 'object') return { id: '', type: '', label: '' }
  const label = labelOf(pick(q, 'label', 'question', 'text', 'title', 'prompt'))
  let rawType = String(pick(q, 'type', 'question_type', 'kind', 'input_type', 'inputType') ?? '').trim()
  let options: unknown = pick(q, 'options', 'choices', 'answers', 'values', 'items')
  // XLSForm "select_one listname"
  const xls = rawType.match(/^(select_one|select_multiple)\s+(\S+)/i)
  if (xls) {
    rawType = xls[1]
    if (!options) options = lists.get(xls[2])
  }
  const key = rawType.toLowerCase().replace(/[\s/-]+/g, '_')
  let type: string = TYPE_ALIASES[key] ?? key
  if (q.multiple === true || q.allow_multiple === true || q.multi === true) type = type === 'select_one' ? 'select_multiple' : type
  const opts = Array.isArray(options) ? options.map((x) => labelOf(typeof x === 'object' && x ? pick(x as Record<string, unknown>, 'label', 'text', 'value', 'name') : x)).filter(Boolean) : undefined
  if (type === 'select_one' && opts && opts.length === 2 && opts.every((x) => /^(yes|no)$/i.test(x))) type = 'yes_no'
  // Rating / scale with explicit labelled options is really a single choice
  if ((type === 'rating' || type === 'likert') && opts && opts.length && opts.length !== 5) type = 'select_one'

  let id = String(pick(q, 'id', 'name', 'key', 'variable', 'field') ?? '').trim()
  id = id ? slugId(id) : slugId(label)
  let unique = id
  for (let n = 2; used.has(unique); n++) unique = `${id.slice(0, 36)}_${n}`
  used.add(unique)

  const cond = pick(q, 'show_if', 'showIf', 'visible_if', 'visibleIf', 'condition', 'depends_on', 'dependsOn') as Record<string, unknown> | undefined
  const showIf = cond && typeof cond === 'object'
    ? { question: slugId(String(pick(cond, 'question', 'field', 'id', 'name') ?? '')), ...(cond.in ? { in: cond.in as string[] } : { equals: (pick(cond, 'equals', 'value', 'is', 'eq') as string) }) }
    : undefined

  const req = pick(q, 'required', 'mandatory', 'isRequired', 'is_required')
  return {
    id: unique,
    type,
    label,
    hint: labelOf(pick(q, 'hint', 'help', 'helper', 'description', 'placeholder')) || undefined,
    required: req === true || req === 'yes' || req === 'true',
    options: opts,
    min: typeof pick(q, 'min', 'minimum') === 'number' ? pick(q, 'min', 'minimum') : undefined,
    max: typeof pick(q, 'max', 'maximum') === 'number' ? pick(q, 'max', 'maximum') : undefined,
    show_if: showIf,
  }
}

function lenient(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
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

export const AI_PROMPT = `You are helping urban-planning students build a field survey for the SPATREN app.
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

const builderSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 36) || 'q'

// Readable, stable ids for CSV columns: derived from labels at save time; skip-logic references follow.
export function finaliseForm(def: FormDef): FormDef {
  const used = new Set<string>()
  const map = new Map<string, string>()
  for (const q of flatQuestions(def)) {
    let id = /^q_[a-z0-9]+$/.test(q.id) && q.label.trim() ? builderSlug(q.label) : q.id
    let unique = id
    for (let n = 2; used.has(unique); n++) unique = `${id}_${n}`
    used.add(unique)
    map.set(q.id, unique)
  }
  return {
    ...def,
    title: def.title.trim(),
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => ({
        ...q,
        id: map.get(q.id)!,
        label: q.label.trim(),
        options: q.options?.map((o) => o.trim()).filter(Boolean),
        show_if: q.show_if ? { ...q.show_if, question: map.get(q.show_if.question) ?? q.show_if.question } : undefined,
      })),
    })),
  }
}

