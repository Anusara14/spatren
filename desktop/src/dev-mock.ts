// Development only (npm run dev, open /?mock): a stand-in for the Rust side so every screen can be checked in a
// normal browser with sample data. Never part of a release build (main.tsx imports it only when import.meta.env.DEV).
import type { Package, Transcript } from './lib/model'

const subgroups = ['Social', 'Economic', 'Cultural', 'Political', 'Ecology', 'Housing']
const topics = ['Living near the tank', 'Pilgrims and trade', 'Temple festivals', 'Local decisions', 'Water and farming', 'House extensions']
const pkgs: Package[] = subgroups.map((sg, n) => ({
  id: `spatren-24000${n}J-20261111-1500`,
  dir: '/mock',
  manifest: {
    app: 'SPATREN', format: 1, exported_at: '2026-11-11T12:00:00Z',
    collector: { index_no: `24000${n}J`, nickname: ['Nimal', 'Kasuni', 'Tharindu', 'Dilini', 'Ravindu', 'Sachini'][n], name: null, group: `Group ${(n % 3) + 1}`, subgroup: sg },
    records: [
      {
        record_id: `rec-${n}`, kind: 'interview', form_title: null, title: null, notes: n === 2 ? 'Near Ruwanweliseya, two vendors' : null,
        recorded_at: `2026-11-1${1 + (n % 3)}T0${3 + n}:30:00Z`, consent: n !== 4,
        location: n === 5 ? null : { lat: 8.33 + n * 0.006, lng: 80.39 + (n % 3) * 0.008, accuracy_m: 6 },
        interview: { open: true, topic: topics[n], participants: 1 + (n % 2), audio_seconds: n === 3 ? 45 : 234, asked: [{ at_s: 40, si: 'මේ ප්‍රදේශයේ ජීවිතය ගැන කියන්න', en: 'Tell me about life here', ai: false }] },
        audio: [{ file: 'audio/test-interview.webm', name: 'interview.webm', type: 'audio/webm', bytes: 1015890 }],
      },
    ],
  },
}))

const files = new Map<string, string>()
let segs: Transcript['segments'] = []

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case 'list_packages':
      return pkgs
    case 'read_transcript': {
      const k = `${args.pkg}/${args.record}`
      if (files.has(k)) return files.get(k)
      if (!['rec-0', 'rec-1', 'rec-2'].includes(String(args.record))) return null
      if (!segs.length) segs = await (await fetch('/test-segs.json')).json()
      const codes = { 'rec-0': ['c-water'], 'rec-1': ['c-trade'], 'rec-2': ['c-heritage'] }[String(args.record)]!
      const t: Transcript = {
        model: 'whisper-small-sinhala (Aadhil96)', created_at: '2026-11-11T10:00:00Z', edited_at: args.record === 'rec-0' ? '2026-11-11T11:00:00Z' : null,
        machine_text: segs.map((s) => s.text).join(' '),
        segments: segs.map((s, i) => ({ ...s, speaker: i % 3 === 0 ? 'I' : 'R', codes: i % 4 === 1 ? codes : undefined, star: i === 2 && args.record !== 'rec-1', en: i === 0 ? 'Sinhala is my mother tongue, so I love it.' : undefined })),
      }
      return JSON.stringify(t)
    }
    case 'write_transcript':
      files.set(`${args.pkg}/${args.record}`, String(args.json))
      return null
    case 'read_app_file':
      return files.get(`app/${args.name}`) ?? JSON.stringify({ codes: [
        { id: 'c-water', name: 'Water and the tank', color: '#5aa9e6' },
        { id: 'c-trade', name: 'Pilgrim trade', color: '#f4a259' },
        { id: 'c-heritage', name: 'Heritage rules', color: '#bed43d' },
      ] })
    case 'write_app_file':
      files.set(`app/${args.name}`, String(args.text))
      return null
    case 'model_status':
      return { installed: true, engine: true, path: 'C:\\Users\\you\\AppData\\Roaming\\lk.spatren.desktop\\models\\ggml-sinhala-small.bin' }
    case 'list_zips':
      return []
    case 'plugin:app|version':
      return '1.0.0'
    case 'plugin:event|unlisten':
      return null
    case 'plugin:event|listen':
      return 1
    default:
      throw new Error(`mock: ${cmd} is not available in the browser preview`)
  }
}

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke,
    transformCallback: () => 1,
    convertFileSrc: (p: string) => `/${p.split('/').pop()}`,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => undefined },
})
