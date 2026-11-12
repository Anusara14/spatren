// Self-check for class-list import, people search, group colours and per-batch map regions.
// Run: node scripts/check-roster.ts
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { csvRows, parseRoster, xlsxRows } from '../src/lib/roster.ts'
import { matchesPerson } from '../src/lib/people.ts'
import { ANURADHAPURA, groupColor, groupsOf, regionFor, SRI_LANKA } from '../src/lib/geo.ts'

// A minimal .xlsx shaped like "Level II Studio Groups.xlsx": a title row, shared strings, merged Group/Topic cells.
const strings = ['Studio groups 2026', 'Group', 'Topic', 'Index No.', 'Name', 'Elective Module', 'Group 1', 'Social', '242353N', 'Serasinghe R.K.', 'Housing',
  '242304R', 'Abinayan K.', 'Cultural', '242303M', 'Abhimani W.S.', 'Land Use', 'Group 2', 'Political', '242352k', 'Senevirathna &amp; Co', 'Ecology', 'Role', 'Leader']
const sst = `<sst><${''}si><t>${strings.join('</t></si><si><t>')}</t></si></sst>`.replace('<si>', '<si>')
const s = (i: number) => `t="s"><v>${i}</v>`
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" ${s(0)}</c></row>
<row r="2"><c r="A2" ${s(1)}</c><c r="B2" ${s(2)}</c><c r="C2" ${s(3)}</c><c r="D2" ${s(4)}</c><c r="E2" ${s(5)}</c><c r="F2" ${s(22)}</c></row>
<row r="3"><c r="A3" ${s(6)}</c><c r="B3" ${s(7)}</c><c r="C3" ${s(8)}</c><c r="D3" ${s(9)}</c><c r="E3" ${s(10)}</c><c r="F3" ${s(23)}</c></row>
<row r="4"><c r="C4" ${s(11)}</c><c r="D4" ${s(12)}</c><c r="E4" ${s(10)}</c></row>
<row r="5"><c r="B5" ${s(13)}</c><c r="C5" ${s(14)}</c><c r="D5" ${s(15)}</c><c r="E5" ${s(16)}</c></row>
<row r="6"/>
<row r="7"><c r="A7" ${s(17)}</c><c r="B7" ${s(18)}</c><c r="C7" ${s(19)}</c><c r="D7" ${s(20)}</c><c r="E7" ${s(21)}</c></row>
<row r="8"><c r="C8" t="inlineStr"><is><t>BAD-1</t></is></c><c r="D8" t="inlineStr"><is><t>Someone</t></is></c></row>
<row r="9"><c r="C9" ${s(8)}</c><c r="D9" ${s(9)}</c></row>
</sheetData></worksheet>`
const xlsx = zipSync({ 'xl/sharedStrings.xml': strToU8(sst), 'xl/worksheets/sheet1.xml': strToU8(sheet), 'xl/workbook.xml': strToU8('<workbook/>') })
const table = xlsxRows(xlsx)
assert.equal(table[2][3], 'Serasinghe R.K.')
assert.equal(table[3][0], '') // merged cell below "Group 1" is empty in the file

const p = parseRoster(table)
assert.equal(p.columns.subgroup, 'Topic')
assert.equal(p.columns.elective, 'Elective Module')
assert.deepEqual(p.rows.map((r) => [r.index_no, r.grp, r.subgroup]), [
  ['242353N', 'Group 1', 'Social'],
  ['242304R', 'Group 1', 'Social'], // carried down from the merged Group and Topic cells
  ['242303M', 'Group 1', 'Cultural'],
  ['242352K', 'Group 2', 'Political'], // lower-case index fixed; a new group restarts the topic
])
assert.equal(p.rows[0].is_leader, true)
assert.equal(p.rows[3].full_name, 'Senevirathna & Co') // XML entities decoded
assert.equal(p.problems.length, 2) // a bad index and a duplicate
assert.ok(p.problems.some((x) => x.includes('BAD-1')))
assert.ok(p.problems.some((x) => x.includes('appears twice')))
assert.throws(() => parseRoster([['just', 'numbers'], ['1', '2']]), /No header row/)

// CSV with quotes, a BOM and roles
const csv = parseRoster(csvRows('﻿Index,Name,Group,Role\r\n251001A,"Perera, A.",Group 1,admin\n251002B,Silva B.,Group 1,Group Leader\n'))
assert.deepEqual(csv.rows.map((r) => [r.index_no, r.full_name, r.is_admin, r.is_leader]), [['251001A', 'Perera, A.', true, false], ['251002B', 'Silva B.', false, true]])

// Roles: "rep" only as a word, so "Reporter" isn't made an admin
const roles = parseRoster(csvRows(['Index,Name,Role', '111A,A,Class rep', '222B,B,Reporter', '333C,C,Representative', '444D,D,Group leader'].join('\n')))
assert.deepEqual(roles.rows.map((r) => [r.index_no, r.is_admin, r.is_leader]), [['111A', true, false], ['222B', false, false], ['333C', true, false], ['444D', false, true]])

// People search: first name, last name, initials, nickname or index
const person = { full_name: 'Serasinghe R.K.', nickname: 'Ravindu', index_no: '242353N' }
for (const q of ['sera', 'Serasinghe', 'ravi', 'r k', 'RAVINDU sera', '2353', '242353n']) assert.equal(matchesPerson(person, q), true, q)
for (const q of ['', '  ', 'perera', 'asinghe', 'ravi x']) assert.equal(matchesPerson(person, q), false, q)

// Groups: any number, in natural order, each with a colour
assert.deepEqual(groupsOf([{ grp: 'Group 10' }, { grp: 'Group 2' }, { grp: null }, { grp: 'Group 2' }]), ['Group 2', 'Group 10'])
assert.equal(groupColor('Group 1'), '#BED43D')
assert.notEqual(groupColor('Group 4'), groupColor('Group 5'))
assert.match(groupColor('Studio Blue'), /^#[0-9A-F]{6}$/i)
assert.equal(groupColor(null), '#8A9BA8')

// Map region per batch place
assert.equal(regionFor('Anuradhapura'), ANURADHAPURA)
assert.equal(regionFor(null), ANURADHAPURA) // the existing batch
assert.equal(regionFor('Kandy'), SRI_LANKA)

console.info('roster import, people search, groups, regions: all checks passed')
