// Kobo / ODK XLSForm (.xlsx or .xls) → SPATREN form, like uploading an XLSForm to KoboToolbox.
// Sheets: "survey" (type, name, label, hint, required, relevant), "choices" (list_name, name, label), "settings"
// (form_title). Labels in several languages ("label::English (en)") use English when present. SheetJS reads both
// file formats; it is loaded only when someone imports a sheet.
import { parseForm, type FormDef } from './forms.ts'

export type Sheets = Record<string, string[][]>

const MAX_BYTES = 5 * 1024 * 1024

/** Every sheet as rows of trimmed strings. */
export async function readSheets(bytes: Uint8Array): Promise<Sheets> {
  if (bytes.length > MAX_BYTES) throw new Error('That file is over 5 MB; a form or class list is much smaller.')
  const XLSX = await import('xlsx')
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: 3000 })
  const out: Sheets = {}
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false })
    out[name] = rows.map((r) => r.map((c) => String(c ?? '').trim()))
  }
  return out
}

// Kobo's automatic metadata rows aren't questions.
const META = new Set(['start', 'end', 'today', 'deviceid', 'subscriberid', 'simserial', 'phonenumber', 'username', 'email', 'audit',
  'calculate', 'hidden', 'start-geopoint', 'background-audio', 'xml-external', 'csv-external'])
const TYPE_MAP: Record<string, string> = {
  geopoint: 'gps', geotrace: 'gps', geoshape: 'gps', image: 'photo', photo: 'photo', audio: 'audio', range: 'rating',
  barcode: 'text', datetime: 'date', dateTime: 'date', string: 'text',
}
const UNSUPPORTED = /^(video|file|select_one_from_file|select_multiple_from_file|rank|begin[_ ]repeat|end[_ ]repeat)\b/i

/** Rows under a header row → objects keyed by header (lower-cased, first non-empty row is the header). */
function asObjects(rows: string[][] | undefined): Record<string, string>[] {
  if (!rows?.length) return []
  const at = rows.findIndex((r) => r.some(Boolean))
  if (at < 0) return []
  const head = rows[at].map((h) => h.trim().toLowerCase())
  return rows.slice(at + 1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** "label", or the English "label::English (en)", or the first language present. */
function localized(o: Record<string, string>, field: string): string {
  if (o[field]) return o[field]
  const keys = Object.keys(o).filter((k) => k.startsWith(`${field}::`) && o[k])
  return o[keys.find((k) => /english|\(en\)/i.test(k)) ?? keys[0] ?? ''] ?? ''
}

const findSheet = (sheets: Sheets, re: RegExp) => sheets[Object.keys(sheets).find((n) => re.test(n.trim())) ?? '']

export interface XlsFormResult {
  form?: FormDef
  errors: string[]
  warnings: string[]
}

export function xlsformToForm(sheets: Sheets, fallbackTitle = 'Imported form'): XlsFormResult {
  const survey = asObjects(findSheet(sheets, /^survey$/i) ?? sheets[Object.keys(sheets)[0]])
  if (!survey.length || !('type' in survey[0])) {
    return { errors: ['This isn\'t an XLSForm: it needs a "survey" sheet with "type", "name" and "label" columns (like a KoboToolbox form).'], warnings: [] }
  }
  const choiceRows = asObjects(findSheet(sheets, /^choices$/i))
  const settings = asObjects(findSheet(sheets, /^settings$/i))[0] ?? {}
  const skipped: string[] = []

  // list_name → choice name → label (answers are stored by label, Kobo's skip logic compares names).
  const lists = new Map<string, Map<string, string>>()
  const choices = choiceRows.filter((c) => c.list_name).map((c) => {
    const label = localized(c, 'label') || c.name
    const m = lists.get(c.list_name) ?? new Map<string, string>()
    m.set(c.name, label)
    lists.set(c.list_name, m)
    return { list_name: c.list_name, name: c.name, label }
  })
  const listOf = new Map<string, string>()

  const rows = survey.flatMap((q) => {
    const raw = q.type.trim()
    const base = raw.split(/\s+/)[0]
    if (!raw || META.has(base)) return []
    if (UNSUPPORTED.test(raw)) {
      skipped.push(`${q.name || raw} (${base})`)
      return []
    }
    const list = raw.match(/^select_(?:one|multiple)\s+(\S+)/i)?.[1]
    if (list && q.name) listOf.set(q.name, list)
    const type = list ? raw : TYPE_MAP[base] ?? base
    return [{
      type,
      name: q.name,
      label: localized(q, 'label') || q.name,
      hint: localized(q, 'hint') || undefined,
      required: /^(yes|true|1|true\(\))$/i.test(q.required ?? ''),
      ...(type === 'integer' || type === 'decimal' ? rangeOf(q.constraint) : {}),
      show_if: showIfOf(q.relevant, (qname, value) => lists.get(listOf.get(qname) ?? '')?.get(value) ?? value),
    }]
  })

  const res = parseForm(JSON.stringify({ title: settings.form_title || settings.title || fallbackTitle, survey: rows, choices }))
  const warnings = [...res.warnings]
  if (skipped.length) warnings.unshift(`Left out ${skipped.length} question type${skipped.length === 1 ? '' : 's'} SPATREN doesn't support yet: ${skipped.slice(0, 6).join(', ')}.`)
  return { ...res, warnings }
}

/** ${q} = 'value' (or 'yes'/'no', or selected(${q}, 'value')) → show_if; anything more complex shows the question always. */
function showIfOf(relevant: string | undefined, labelFor: (q: string, value: string) => string): { question: string; equals: string } | undefined {
  const r = (relevant ?? '').trim()
  const eq = r.match(/^\$\{(\w+)\}\s*=\s*['"]([^'"]*)['"]$/) ?? r.match(/^selected\(\s*\$\{(\w+)\}\s*,\s*['"]([^'"]*)['"]\s*\)$/)
  if (!eq) return undefined
  const label = labelFor(eq[1], eq[2])
  return { question: eq[1], equals: /^(yes|no)$/i.test(label) ? label[0].toUpperCase() + label.slice(1).toLowerCase() : label }
}

/** ". >= 0 and . <= 120" → min/max */
function rangeOf(constraint: string | undefined): { min?: number; max?: number } {
  const c = constraint ?? ''
  const min = c.match(/\.\s*>=?\s*(-?\d+(?:\.\d+)?)/)?.[1]
  const max = c.match(/\.\s*<=?\s*(-?\d+(?:\.\d+)?)/)?.[1]
  return { ...(min != null ? { min: Number(min) } : {}), ...(max != null ? { max: Number(max) } : {}) }
}
