// Self-check for Kobo/ODK XLSForm import (.xlsx and .xls). Run: node scripts/check-xlsform.ts
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { flatQuestions } from '../src/lib/forms.ts'
import { parseRoster } from '../src/lib/roster.ts'
import { readSheets, xlsformToForm } from '../src/lib/xlsform.ts'

// A typical KoboToolbox form: metadata rows, a group, a multilingual label, choices, skip logic, a number limit,
// and a video question SPATREN can't take.
const survey = [
  ['type', 'name', 'label::English (en)', 'label::Sinhala (si)', 'hint', 'required', 'relevant', 'constraint'],
  ['start', 'start', '', '', '', '', '', ''],
  ['deviceid', 'deviceid', '', '', '', '', '', ''],
  ['begin_group', 'household', 'Household', 'නිවස', '', '', '', ''],
  ['text', 'resp_name', 'Respondent name', 'නම', 'First name is fine', 'yes', '', ''],
  ['integer', 'members', 'People in the household', 'සාමාජිකයින්', '', 'true', '', '. >= 1 and . <= 30'],
  ['select_one yn', 'owns', 'Do you own the house?', 'ඔබට නිවස අයිතිද?', '', 'yes', '', ''],
  ['select_one tenure', 'tenure', 'How do you hold the land?', '', '', '', "${owns} = 'no'", ''],
  ['end_group', '', '', '', '', '', '', ''],
  ['select_multiple transport', 'transport', 'How do you travel to town?', '', '', '', '', ''],
  ['geopoint', 'where', 'House location', '', '', '', '', ''],
  ['image', 'house_photo', 'Photo of the house', '', '', '', '', ''],
  ['video', 'walk', 'Walk-through video', '', '', '', '', ''],
  ['date', 'visit_date', 'Visit date', '', '', '', '', ''],
  ['calculate', 'score', '', '', '', '', '', ''],
]
const choices = [
  ['list_name', 'name', 'label::English (en)'],
  ['yn', 'yes', 'Yes'], ['yn', 'no', 'No'],
  ['tenure', 'deed', 'Deed'], ['tenure', 'permit', 'Government permit'], ['tenure', 'none', 'No document'],
  ['transport', 'bus', 'Bus'], ['transport', 'tuk', 'Three-wheeler'], ['transport', 'walk', 'Walk'],
]
const settings = [['form_title', 'form_id'], ['Household survey 2026', 'hh_2026']]

function workbook(bookType: 'xlsx' | 'xls'): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(survey), 'survey')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(choices), 'choices')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(settings), 'settings')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }))
}

for (const bookType of ['xlsx', 'xls'] as const) {
  const res = xlsformToForm(await readSheets(workbook(bookType)), 'fallback')
  assert.deepEqual(res.errors, [], bookType)
  const f = res.form!
  assert.equal(f.title, 'Household survey 2026')
  assert.deepEqual(f.sections.map((s) => s.title), ['Household', 'More questions'])
  const qs = flatQuestions(f)
  const by = Object.fromEntries(qs.map((q) => [q.id, q]))
  assert.deepEqual(qs.map((q) => q.id), ['resp_name', 'members', 'owns', 'tenure', 'transport', 'where', 'house_photo', 'visit_date'])
  assert.equal(by.resp_name.label, 'Respondent name') // English label chosen
  assert.equal(by.resp_name.hint, 'First name is fine')
  assert.equal(by.resp_name.required, true)
  assert.equal(by.members.type, 'integer')
  assert.deepEqual([by.members.min, by.members.max, by.members.required], [1, 30, true])
  assert.equal(by.owns.type, 'yes_no')
  assert.deepEqual(by.tenure.options, ['Deed', 'Government permit', 'No document'])
  assert.deepEqual(by.tenure.show_if, { question: 'owns', equals: 'No' }) // Kobo choice name 'no' → the answer SPATREN stores
  assert.equal(by.transport.type, 'select_multiple')
  assert.deepEqual(by.transport.options, ['Bus', 'Three-wheeler', 'Walk'])
  assert.equal(by.where.type, 'gps')
  assert.equal(by.house_photo.type, 'photo')
  assert.equal(by.visit_date.type, 'date')
  assert.ok(res.warnings[0].includes('walk (video)'), res.warnings[0]) // left out, and said so
}

// Not an XLSForm: a clear message instead of a broken form
const plain = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(plain, XLSX.utils.aoa_to_sheet([['Name', 'Age'], ['A', '1']]), 'Sheet1')
const notForm = xlsformToForm(await readSheets(new Uint8Array(XLSX.write(plain, { type: 'array', bookType: 'xls' }))))
assert.equal(notForm.form, undefined)
assert.match(notForm.errors[0], /survey/)

// Class lists as old .xls work too
const roster = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(roster, XLSX.utils.aoa_to_sheet([['Group', 'Index No.', 'Name'], ['Group 1', '251001A', 'Perera A.'], ['', '251002B', 'Silva B.']]), 'List')
const sheets = await readSheets(new Uint8Array(XLSX.write(roster, { type: 'array', bookType: 'xls' })))
const r = parseRoster(sheets.List)
assert.deepEqual(r.rows.map((x) => [x.index_no, x.grp]), [['251001A', 'Group 1'], ['251002B', 'Group 1']])

// Oversized files are refused before parsing
await assert.rejects(readSheets(new Uint8Array(6 * 1024 * 1024)), /over 5 MB/)

console.info('XLSForm import (.xlsx and .xls), .xls class lists: all checks passed')
