// Self-check for the AI follow-up prompt and reply parsing. Run: node scripts/check-ai.ts
import assert from 'node:assert/strict'
import { buildPrompt, parseSuggestion, PROMPT_CARDS } from '../src/lib/ai.ts'

const ok = parseSuggestion('```json\n{"summary":"Vendors moved here after the road was widened.","questions":[{"si":"ඒ කවදද?","en":"When was that?"},{"en":"Who decided it?"},{"si":"","en":"How did it affect you?"},{"si":"x","en":"fourth"}]}\n```')
assert.equal(ok.summary, 'Vendors moved here after the road was widened.')
assert.equal(ok.questions.length, 3) // capped at 3
assert.equal(ok.questions[1].si, 'Who decided it?') // missing Sinhala falls back to English
assert.equal(ok.questions[2].si, 'How did it affect you?') // empty Sinhala too
assert.throws(() => parseSuggestion('{"summary":"x","questions":[]}'), /no questions/)
assert.throws(() => parseSuggestion('not json'))

const p = buildPrompt('Street vendors', ['When was that?'])
assert.match(p, /Street vendors/)
assert.match(p, /do not repeat\): "When was that\?"/)
assert.ok(PROMPT_CARDS.every((c) => c.si && c.en))
console.info('AI follow-ups: all checks passed')
