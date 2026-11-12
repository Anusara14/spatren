// Read a class list (roster) from an Excel .xlsx or .csv file, e.g. "Level II Studio Groups.xlsx":
//   Group | Topic | Index No. | Name | Elective Module   (Group and Topic often merged down several rows)
// Columns are found by their header text, so other batches' sheets work as long as the headers are recognisable.
// ponytail: xlsx read with fflate + regex over the sheet XML (first sheet only, no formulas); add SheetJS if a sheet ever needs more.
import { strFromU8, unzipSync } from 'fflate'

export interface RosterRow {
  index_no: string
  full_name: string
  grp: string | null
  subgroup: string | null
  elective: string | null
  is_admin: boolean
  is_leader: boolean
}

export interface RosterParse {
  rows: RosterRow[]
  problems: string[]
  columns: Record<keyof typeof MATCHERS, string | null>
}

const MATCHERS = {
  index_no: /index|reg(istration)?\s*(no|number)|student\s*(no|id|number)/i,
  full_name: /name/i,
  grp: /^\s*(group|grp|team|studio)\b/i,
  subgroup: /topic|sub\s*-?\s*group|theme|section/i,
  elective: /elective|module|speciali[sz]ation/i,
  role: /role|position|leader|admin/i,
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

// Excel's last column is XFD (16384); anything past it is a broken or hostile file.
const MAX_COLS = 16384
const colIndex = (ref: string): number => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** All cells of the first worksheet as rows of strings ('' for empty cells). */
export function xlsxRows(bytes: Uint8Array): string[][] {
  // A class list is a few hundred KB of XML; refuse files that inflate past 20 MB (zip bombs).
  const tooBig = { hit: false }
  const files = unzipSync(bytes, {
    filter: (f) => {
      const wanted = f.name === 'xl/sharedStrings.xml' || f.name.startsWith('xl/worksheets/sheet') || f.name === 'xl/workbook.xml'
      if (wanted && f.originalSize > 20_000_000) tooBig.hit = true
      return wanted && f.originalSize <= 20_000_000
    },
  })
  if (tooBig.hit) throw new Error('This Excel file is far too large to be a class list.')
  const shared = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : []
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))[0]
  if (!sheetName) throw new Error("This Excel file has no worksheet.")
  const xml = strFromU8(files[sheetName])
  const out: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = []
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const ref = attrs.match(/\br="([A-Z]{1,3})\d+"/)?.[1]
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const body = c[2] ?? ''
      let v = ''
      if (type === 'inlineStr') v = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
        v = type === 's' ? shared[Number(raw)] ?? '' : decode(raw)
      }
      const at = ref ? colIndex(ref) : cells.length
      if (at >= MAX_COLS) continue
      while (cells.length < at) cells.push('')
      cells[at] = v.trim()
    }
    out.push(cells)
  }
  return out
}

/** RFC 4180-ish CSV (quotes, commas and newlines inside quotes). */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  return rows
}

/** Turn sheet rows into roster rows: find the header row, carry merged Group/Topic cells down, check every row. */
export function parseRoster(table: string[][]): RosterParse {
  const headerAt = table.findIndex((r) => r.some((c) => MATCHERS.index_no.test(c)) && r.some((c) => MATCHERS.full_name.test(c)))
  if (headerAt < 0) throw new Error('No header row found. The sheet needs columns named like "Index No." and "Name" (and optionally Group, Topic, Elective, Role).')
  const header = table[headerAt]
  const find = (re: RegExp, not: number[] = []) => header.findIndex((h, i) => !not.includes(i) && re.test(h))
  const iIndex = find(MATCHERS.index_no)
  const iName = find(MATCHERS.full_name, [iIndex])
  const iGrp = find(MATCHERS.grp, [iIndex, iName])
  const iSub = find(MATCHERS.subgroup, [iIndex, iName, iGrp])
  const iElec = find(MATCHERS.elective, [iIndex, iName, iGrp, iSub])
  const iRole = find(MATCHERS.role, [iIndex, iName, iGrp, iSub, iElec])
  const columns = Object.fromEntries(
    Object.entries({ index_no: iIndex, full_name: iName, grp: iGrp, subgroup: iSub, elective: iElec, role: iRole }).map(([k, i]) => [k, i >= 0 ? header[i] : null]),
  ) as RosterParse['columns']

  const rows: RosterRow[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  let grp: string | null = null
  let sub: string | null = null
  table.slice(headerAt + 1).forEach((r, n) => {
    const line = headerAt + n + 2
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    // A new group restarts the topic; blank cells under a merged cell keep the value above.
    if (cell(iGrp)) { grp = cell(iGrp); sub = null }
    if (cell(iSub)) sub = cell(iSub)
    const index = cell(iIndex).replace(/\s/g, '').toUpperCase()
    const name = cell(iName)
    if (!index && !name) return
    if (!/^[A-Z0-9]{3,20}$/.test(index)) return problems.push(`Row ${line}: "${cell(iIndex) || '(empty)'}" isn't an index number.`)
    if (!name) return problems.push(`Row ${line}: ${index} has no name.`)
    if (seen.has(index)) return problems.push(`Row ${line}: ${index} appears twice.`)
    seen.add(index)
    const role = cell(iRole).toLowerCase()
    rows.push({
      index_no: index,
      full_name: name.slice(0, 120),
      grp: grp?.slice(0, 60) ?? null,
      subgroup: sub?.slice(0, 60) ?? null,
      elective: cell(iElec).slice(0, 60) || null,
      is_admin: /\badmin|coordinator|\brep(resentative)?\b/.test(role),
      is_leader: /lead/.test(role),
    })
  })
  return { rows, problems, columns }
}

/** Read a picked .xlsx or .csv file into roster rows. */
export async function readRosterFile(file: File): Promise<RosterParse> {
  if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB; a class list is much smaller. Pick the roster sheet.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (/\.xls$/i.test(file.name) && !isZip) throw new Error('Old .xls files aren\'t supported. In Excel choose File → Save As → Excel Workbook (.xlsx), then pick that.')
  const table = isZip ? xlsxRows(bytes) : csvRows(new TextDecoder().decode(bytes))
  return parseRoster(table)
}
