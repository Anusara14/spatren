// Self-check for the Google My Maps export. Run: node scripts/check-kml.ts
import assert from 'node:assert/strict'
import { buildKml } from '../src/lib/kml.ts'

const kml = buildKml([
  { id: 'r1', name: 'Tank <bund> & "steps"', kind: 'observation', notes: 'odd ]]> text', lat: 8.3114, lng: 80.4037, recorded_at: '2026-11-12T09:30:00Z',
    by: 'Anusara', group: 'Group 3', index_no: '242343J', answers: [['ප්‍රශ්නය', 'පිළිතුර']], photos: ['https://x.supabase.co/a.jpg?token=1&t=2', 'https://x.supabase.co/b.jpg'] },
  { id: 'r2', name: 'Market', kind: 'experience', rating: 'Good', lat: 8.35, lng: 80.39, recorded_at: '2026-11-12T10:00:00Z', photos: [] },
], 'SPATREN field map')

assert.match(kml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2">/)
assert.equal(kml.match(/<Placemark /g)?.length, 2)
assert.ok(kml.includes('<coordinates>80.4037,8.3114,0</coordinates>'), 'longitude first')
assert.ok(kml.includes('<name>Tank &lt;bund&gt; &amp; &quot;steps&quot;</name>'))
assert.ok(kml.includes('<Data name="gx_media_links"><value>https://x.supabase.co/a.jpg?token=1&amp;t=2 https://x.supabase.co/b.jpg</value></Data>'))
assert.ok(!/<!\[CDATA\[[^]*?]]>[^<]/.test(kml.replace(/]]]]><!\[CDATA\[>/g, '')), 'CDATA never closed early by the notes')
assert.ok(kml.includes('ප්‍රශ්නය'), 'Sinhala kept')
assert.ok(kml.includes('<styleUrl>#k-experience</styleUrl>') && kml.includes('<Style id="k-observation">'))
assert.ok(!kml.includes('name="Rating"><value></value>'), 'empty fields left out')
console.info('KML map export: all checks passed')
