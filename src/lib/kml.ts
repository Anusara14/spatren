// Records → KML for Google My Maps (Import a layer) and Google Earth. Each located record is a pin with its photos:
// My Maps shows the images listed in gx_media_links in the pin's card; Google Earth shows the <img> tags.
// Photos are links (signed, valid for a year), so the file stays small enough for My Maps (5 MB, 2000 pins per layer).

export interface KmlPlace {
  id: string
  name: string
  kind: string
  category?: string | null
  notes?: string | null
  lat: number
  lng: number
  recorded_at: string
  by?: string | null
  group?: string | null
  index_no?: string | null
  rating?: string | null
  answers?: [string, string][]
  photos: string[]
}

// KML colours are aabbggrr.
const KIND_COLOR: Record<string, string> = {
  observation: 'ff3dd4be', survey: 'ffe0a03c', interview: 'ff4a99f2', note: 'ffb1a59a', experience: 'ff50b93f',
}

const esc = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`
const data = (name: string, value: unknown) => (value == null || value === '' ? '' : `<Data name="${esc(name)}"><value>${esc(value)}</value></Data>`)

function description(p: KmlPlace): string {
  const rows: [string, unknown][] = [['Type', p.category || p.kind], ['When', new Date(p.recorded_at).toLocaleString()], ['By', p.by], ['Group', p.group], ['Rating', p.rating]]
  return [
    p.notes ? `<p>${esc(p.notes)}</p>` : '',
    rows.filter(([, v]) => v).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join('<br>'),
    p.answers?.length ? `<p>${p.answers.map(([q, a]) => `<b>${esc(q)}</b><br>${esc(a)}`).join('<br>')}</p>` : '',
    p.photos.map((u) => `<img src="${esc(u)}" width="320"><br>`).join(''),
  ].filter(Boolean).join('<br>')
}

export function buildKml(places: KmlPlace[], title: string): string {
  const kinds = [...new Set(places.map((p) => p.kind))]
  const styles = kinds.map((k) => `<Style id="k-${esc(k)}"><IconStyle><color>${KIND_COLOR[k] ?? 'ff13283c'}</color><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`)
  const pins = places.map((p) => `<Placemark id="${esc(p.id)}">
<name>${esc(p.name)}</name>
<description>${cdata(description(p))}</description>
<styleUrl>#k-${esc(p.kind)}</styleUrl>
<ExtendedData>${data('Type', p.category || p.kind)}${data('Kind', p.kind)}${data('When', p.recorded_at)}${data('By', p.by)}${data('Index', p.index_no)}${data('Group', p.group)}${data('Rating', p.rating)}${data('Notes', p.notes)}${data('gx_media_links', p.photos.join(' '))}</ExtendedData>
<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
</Placemark>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${esc(title)}</name>
${styles.join('\n')}
${pins.join('\n')}
</Document>
</kml>
`
}
