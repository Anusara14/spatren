// Self-check for the tolerant form importer. Run: node scripts/check-forms.ts
import assert from 'node:assert/strict'
import { flatQuestions, parseForm } from '../src/lib/forms.ts'

// 1. Gemini/ChatGPT style: flat "questions", synonyms for keys and types, no ids, code fence, trailing comma.
const gemini = parseForm(`Here you go:
\`\`\`json
{
  "survey_title": "Market survey",
  "questions": [
    { "question": "Stall name", "type": "short_text", "mandatory": true },
    { "question": "Main product", "type": "radio", "choices": ["Vegetables", "Fish", "Clothes"] },
    { "question": "Payment methods", "type": "checkbox", "choices": [{"label": "Cash"}, {"label": "Card"}] },
    { "question": "Has electricity?", "type": "boolean" },
    { "question": "Stall location", "type": "location" },
    { "question": "Photo of stall", "type": "image" },
    { "question": "Vendor story", "type": "voice" },
  ]
}
\`\`\``)
assert.deepEqual(gemini.errors, [], `gemini errors: ${gemini.errors}`)
const g = flatQuestions(gemini.form!)
assert.equal(gemini.form!.title, 'Market survey')
assert.deepEqual(g.map((q) => q.type), ['text', 'select_one', 'select_multiple', 'yes_no', 'gps', 'photo', 'audio'])
assert.equal(g[0].id, 'stall_name')
assert.equal(g[0].required, true)
assert.deepEqual(g[2].options, ['Cash', 'Card'])

// 2. XLSForm-as-JSON (survey + choices, begin_group) with skip logic.
const xls = parseForm(JSON.stringify({
  title: 'Household',
  survey: [
    { type: 'begin_group', name: 'hh', label: 'Household' },
    { type: 'select_one yn', name: 'has_toilet', label: 'Toilet at home?' },
    { type: 'integer', name: 'members', label: 'Members', min: 1, max: 30 },
    { type: 'end_group' },
    { type: 'text', name: 'why', label: 'Why not?', show_if: { question: 'has_toilet', equals: 'No' } },
  ],
  choices: [{ list_name: 'yn', name: 'yes', label: 'Yes' }, { list_name: 'yn', name: 'no', label: 'No' }],
}))
assert.deepEqual(xls.errors, [])
assert.equal(xls.form!.sections[0].title, 'Household')
const x = flatQuestions(xls.form!)
assert.equal(x[0].type, 'yes_no') // Yes/No choice list becomes yes_no
assert.equal(x[1].max, 30)
assert.equal(x[2].show_if?.question, 'has_toilet')

// 3. Bad pieces degrade to warnings instead of blocking the import.
const messy = parseForm(JSON.stringify({ title: 'T', questions: [
  { id: 'a', type: 'slider_thing', label: 'A' },
  { id: 'b', type: 'text', label: 'B', show_if: { question: 'zzz', equals: 'x' } },
] }))
assert.deepEqual(messy.errors, [])
assert.equal(messy.warnings.length, 2)
assert.equal(flatQuestions(messy.form!)[0].type, 'text')
assert.equal(flatQuestions(messy.form!)[1].show_if, undefined)

// 4. Real errors still stop it: a choice question with no options, and non-JSON.
assert.ok(parseForm(JSON.stringify({ title: 'T', questions: [{ type: 'radio', label: 'Pick' }] })).errors.length > 0)
assert.ok(parseForm('not json at all').errors.length > 0)

// 5. Bare array of questions.
const arr = parseForm(JSON.stringify([{ label: 'Age', type: 'number' }]))
assert.equal(flatQuestions(arr.form!)[0].type, 'integer')

console.info('forms importer: all checks passed')
