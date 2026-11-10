// 70-phone load test against the live Supabase project (read-only, no accounts created):
//  - 70 realtime connections at once, each on the same channel; one "admin" broadcasts, everyone must receive it
//  - each phone polls the REST API at the app's cadence (students every 20 s; here sped up to every 2 s = 10x load)
// Run: node --env-file=.env scripts/loadtest.mjs [phones=70] [seconds=60]
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_KEY
if (!URL || !KEY) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY (.env)')
const PHONES = Number(process.argv[2] ?? 70)
const SECONDS = Number(process.argv[3] ?? 60)

const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : NaN)
const lat = []
let ok = 0
let fail = 0
const errors = new Map()
let received = 0

const clients = Array.from({ length: PHONES }, () =>
  createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 5 } } }),
)

// 1. connect everyone to realtime
const t0 = Date.now()
const channels = await Promise.all(
  clients.map(
    (c, i) =>
      new Promise((resolve) => {
        const ch = c.channel('loadtest-spatren', { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'ping' }, () => received++)
        ch.subscribe((s) => (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && resolve([ch, s, i]))
      }),
  ),
)
const subscribed = channels.filter(([, s]) => s === 'SUBSCRIBED').length
console.info(`realtime: ${subscribed}/${PHONES} connected in ${Date.now() - t0} ms`)

// 2. traffic: REST polling from every phone + periodic broadcasts from phone 0
const stopAt = Date.now() + SECONDS * 1000
let sent = 0
const bcast = setInterval(() => {
  sent++
  void channels[0][0].send({ type: 'broadcast', event: 'ping', payload: { n: sent } })
}, 5000)
await Promise.all(
  clients.map(async (c, i) => {
    await new Promise((r) => setTimeout(r, (i * 2000) / PHONES)) // stagger like real phones
    while (Date.now() < stopAt) {
      const s = performance.now()
      const { error } = await c.from('forms').select('id').limit(1) // RLS-protected read (empty for anon): full auth + policy path
      lat.push(performance.now() - s)
      if (error) {
        fail++
        errors.set(error.message, (errors.get(error.message) ?? 0) + 1)
      } else ok++
      await new Promise((r) => setTimeout(r, 2000))
    }
  }),
)
clearInterval(bcast)
await new Promise((r) => setTimeout(r, 1500))

const expected = sent * (subscribed - 1)
console.info(`REST: ${ok + fail} requests, ${fail} failed; latency p50 ${pct(lat, 0.5).toFixed(0)} ms, p95 ${pct(lat, 0.95).toFixed(0)} ms, max ${Math.max(...lat).toFixed(0)} ms`)
for (const [m, n] of errors) console.info(`  error x${n}: ${m}`)
console.info(`broadcast: ${received}/${expected} deliveries (${((received / Math.max(1, expected)) * 100).toFixed(1)}%)`)
await Promise.all(clients.map((c) => c.removeAllChannels()))
process.exit(0)
