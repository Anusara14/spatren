import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MlMap, Marker, type GeoJSONSource, type LayerSpecification } from 'maplibre-gl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DISTRICT_BOUNDS } from '../lib/geo'
import type { MeetingPoint } from '../lib/meeting'
import { useTheme, type Theme } from '../lib/theme'
import { IconCube, IconMinus, IconPlus2 } from './icons'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty' // free, no key, OSM-based, includes building heights
const BUILDINGS_3D_FROM_ZOOM = 14
const SACRED_CITY: [number, number] = [80.3964, 8.3495]

export interface MapMarker {
  id: string
  lat: number
  lng: number
  color: string
  label: string
  className?: string
  title?: string
  /** shown above the mini person when zoomed in */
  name?: string
  /** avatar image URL shown inside the pin */
  avatar?: string | null
}

interface MapViewProps {
  markers?: MapMarker[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  trail?: [number, number][] // [lng, lat]
  me?: { lat: number; lng: number } | null
  focus?: { lat: number; lng: number; zoom?: number; key: string } | null
  pitch?: number
  meetingPoints?: MeetingPoint[]
  onMeetingClick?: (p: MeetingPoint) => void
  /** when set, the next map tap reports its coordinates (used to drop a meeting point) */
  onPick?: ((p: { lat: number; lng: number }) => void) | null
  controls?: boolean
  /** bottom offset of the floating zoom controls, CSS length */
  controlsBottom?: string
  /** rendered at the top of the floating control stack (e.g. SOS) */
  topControl?: ReactNode
  /** crosshair mode: reports the map centre as the user pans */
  onCenter?: ((c: { lat: number; lng: number }) => void) | null
}

export default function MapView({
  markers = [], selectedId, onSelect, trail, me, focus, pitch = 58, meetingPoints = [], onMeetingClick, onPick = null, controls = true, controlsBottom = '24px', topControl, onCenter = null,
}: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const pins = useRef(new Map<string, Marker>())
  const mpPins = useRef<Marker[]>([])
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const onCenterRef = useRef(onCenter)
  onCenterRef.current = onCenter
  const onMeetingRef = useRef(onMeetingClick)
  onMeetingRef.current = onMeetingClick
  const meMarker = useRef<Marker | null>(null)
  const ready = useRef(false)
  const pendingTrail = useRef<[number, number][] | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [tilted, setTilted] = useState(pitch > 0)
  const { theme } = useTheme()
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    if (!el.current) return
    const m = new MlMap({
      container: el.current,
      style: STYLE,
      center: SACRED_CITY,
      zoom: 15.2,
      pitch,
      bearing: pitch > 0 ? -18 : 0,
      maxPitch: 75,
      maxBounds: DISTRICT_BOUNDS,
      minZoom: 8,
      attributionControl: { compact: true },
    })
    m.on('load', () => {
      paintCity(m, themeRef.current)
      m.addSource('trail', { type: 'geojson', data: line([]) })
      const width = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], 12, a, 17, b] as unknown as number
      m.addLayer({ id: 'trail-casing', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': width(5, 13) } })
      m.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#BED43D', 'line-width': width(3, 8) } })
      ready.current = true
      if (pendingTrail.current) setTrailData(m, pendingTrail.current)
    })
    m.on('click', (e) => onPickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
    const bucket = () => (m.getZoom() < 14 ? 'far' : m.getZoom() < 16 ? 'mid' : 'near')
    el.current.dataset.zoom = bucket()
    m.on('zoom', () => {
      const b = bucket()
      if (el.current && el.current.dataset.zoom !== b) el.current.dataset.zoom = b
    })
    m.on('move', () => {
      const c = m.getCenter()
      onCenterRef.current?.({ lat: c.lat, lng: c.lng })
    })
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = m
    const pinsMap = pins.current
    return () => {
      pinsMap.clear()
      mpPins.current = []
      meMarker.current = null
      m.remove()
      map.current = null
      ready.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (map.current && ready.current) paintCity(map.current, theme)
  }, [theme])

  // Meeting points: lime flag with a label, everyone gathers here.
  useEffect(() => {
    const m = map.current
    if (!m) return
    mpPins.current.forEach((p) => p.remove())
    mpPins.current = meetingPoints.map((mp) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = 'mp'
      node.setAttribute('aria-label', `Meeting point: ${mp.title}`)
      const label = document.createElement('span')
      label.textContent = mp.title
      node.appendChild(label)
      node.addEventListener('click', (e) => {
        e.stopPropagation()
        onMeetingRef.current?.(mp)
      })
      return new Marker({ element: node, anchor: 'bottom' }).setLngLat([mp.lng, mp.lat]).addTo(m)
    })
  }, [meetingPoints])

  // Team markers: add / move / restyle / remove. Each pin carries three looks (dot · head · mini person);
  // CSS picks one from the map's zoom bucket, so zooming never touches React or the DOM tree.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const mk of markers) {
      seen.add(mk.id)
      let pin = pins.current.get(mk.id)
      if (!pin) {
        const node = document.createElement('div')
        node.innerHTML =
          '<span class="mk-dot"></span><span class="mk-person"><span class="mk-name"></span><span class="mk-head"></span><span class="mk-body"></span><span class="mk-shadow"></span></span>'
        node.addEventListener('click', (e) => {
          e.stopPropagation()
          onSelectRef.current?.(mk.id)
        })
        pin = new Marker({ element: node, anchor: 'bottom' }).setLngLat([mk.lng, mk.lat]).addTo(m)
        pins.current.set(mk.id, pin)
      }
      pin.setLngLat([mk.lng, mk.lat])
      const node = pin.getElement()
      const cls = `mk ${mk.className ?? ''} ${selectedId === mk.id ? 'sel' : ''}`
      if (node.className !== cls) node.className = cls
      node.style.setProperty('--c', mk.color)
      node.title = mk.title ?? mk.label
      const name = node.querySelector('.mk-name') as HTMLElement
      if (name.textContent !== (mk.name ?? mk.label)) name.textContent = mk.name ?? mk.label
      const head = node.querySelector('.mk-head') as HTMLElement
      if (mk.avatar) {
        let img = head.querySelector('img')
        if (!img) {
          head.textContent = ''
          img = document.createElement('img')
          img.alt = ''
          img.decoding = 'async'
          img.referrerPolicy = 'no-referrer'
          head.appendChild(img)
        }
        if (img.getAttribute('src') !== mk.avatar) img.src = mk.avatar
      } else if (head.textContent !== mk.label) head.textContent = mk.label
    }
    for (const [id, pin] of pins.current) {
      if (!seen.has(id)) {
        pin.remove()
        pins.current.delete(id)
      }
    }
  }, [markers, selectedId])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!me) {
      meMarker.current?.remove()
      meMarker.current = null
      return
    }
    if (!meMarker.current) {
      const node = document.createElement('div')
      node.className = 'me-pin'
      node.appendChild(document.createElement('span'))
      meMarker.current = new Marker({ element: node, anchor: 'bottom' }).setLngLat([me.lng, me.lat]).addTo(m)
    } else meMarker.current.setLngLat([me.lng, me.lat])
  }, [me])

  useEffect(() => {
    const m = map.current
    if (!m) return
    pendingTrail.current = trail ?? []
    if (ready.current) setTrailData(m, pendingTrail.current)
  }, [trail])

  useEffect(() => {
    if (!focus || !map.current) return
    map.current.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 16.5, pitch: tilted ? Math.max(pitch, 50) : 0, duration: 1400, essential: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  function toggleTilt() {
    const m = map.current
    if (!m) return
    const next = !tilted
    setTilted(next)
    m.easeTo({ pitch: next ? 58 : 0, bearing: next ? -18 : 0, duration: 700 })
  }

  return (
    <>
      <div ref={el} className={`map ${onPick ? 'picking' : ''}`} />
      {onCenter && (
        <div className="crosshair" aria-hidden="true">
          <span className="meet-flag" />
        </div>
      )}
      {controls && (
        <div className="map-ctrls" style={{ bottom: controlsBottom }}>
          {topControl}
          <button className="glass-btn" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><IconPlus2 /></button>
          <button className="glass-btn" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><IconMinus /></button>
          <button className="glass-btn" aria-pressed={tilted} aria-label={tilted ? 'Switch to flat view' : 'Switch to 3D view'} onClick={toggleTilt}>
            <IconCube />
          </button>
        </div>
      )}
    </>
  )
}

type GeoData = Parameters<GeoJSONSource['setData']>[0]

function setTrailData(m: MlMap, coords: [number, number][]): void {
  ;(m.getSource('trail') as GeoJSONSource | undefined)?.setData(line(coords))
}

function line(coords: [number, number][]): GeoData {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
}

const PALETTES = {
  light: {
    bg: '#e8ebea', water: '#c4d7df', park: '#d6e1c2', building2d: '#f1f3f2', landuse: '#e2e5e2',
    massLow: '#f6f7f6', massHigh: '#ffffff', road: '#ffffff', casing: '#d4dadb', rail: '#cfd5d6',
    label: '#5d6d79', waterLabel: '#6f8f9c', halo: 'rgba(255,255,255,0.92)', light: 0.3,
    sky: '#dfe6ea', horizon: '#f2f4f4', fog: '#eef1f1',
  },
  dark: {
    bg: '#0e0e0f', water: '#17232b', park: '#141c16', building2d: '#1c1c1e', landuse: '#121213',
    massLow: '#242426', massHigh: '#36363a', road: '#29292c', casing: '#1a1a1c', rail: '#232325',
    label: '#9a9aa0', waterLabel: '#73889a', halo: 'rgba(0,0,0,0.9)', light: 0.45,
    sky: '#000000', horizon: '#151517', fog: '#0e0e0f',
  },
} as const

// Paper-white city (or its night twin): pale ground, quiet roads, soft-lit massing, minimal labels.
// Keyed on OpenMapTiles source-layers so it survives style updates on OpenFreeMap. Safe to call again on theme change.
function paintCity(m: MlMap, theme: Theme): void {
  const P = PALETTES[theme]
  const set = (id: string, prop: string, v: unknown) => {
    try {
      m.setPaintProperty(id, prop, v)
    } catch {
      /* property not valid for this layer type */
    }
  }
  for (const layer of m.getStyle().layers ?? []) {
    const sl = (layer as LayerSpecification & { 'source-layer'?: string })['source-layer'] ?? ''
    const id = layer.id
    if (id.startsWith('trail')) continue
    if (layer.type === 'background') set(id, 'background-color', P.bg)
    else if (layer.type === 'fill') {
      if (sl === 'water') set(id, 'fill-color', P.water)
      else if (sl === 'park' || sl === 'landcover' || /park|grass|wood|forest|scrub/.test(id)) {
        set(id, 'fill-color', P.park)
        set(id, 'fill-opacity', 0.7)
      } else if (sl === 'building') {
        set(id, 'fill-color', P.building2d)
        m.setLayerZoomRange(id, 13, BUILDINGS_3D_FROM_ZOOM)
      } else if (sl === 'landuse') set(id, 'fill-color', P.landuse)
      set(id, 'fill-outline-color', 'rgba(0,0,0,0)')
    } else if (layer.type === 'fill-extrusion') {
      m.setLayerZoomRange(id, BUILDINGS_3D_FROM_ZOOM, 24)
      set(id, 'fill-extrusion-color', ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, P.massLow, 25, P.massHigh])
      // Rural Sri Lankan buildings rarely carry heights in OSM: give each a believable minimum mass, rising in as you zoom.
      set(id, 'fill-extrusion-height', ['interpolate', ['linear'], ['zoom'], BUILDINGS_3D_FROM_ZOOM, 0, BUILDINGS_3D_FROM_ZOOM + 0.8, ['max', ['coalesce', ['get', 'render_height'], 0], 6]])
      set(id, 'fill-extrusion-base', ['coalesce', ['get', 'render_min_height'], 0])
      set(id, 'fill-extrusion-opacity', 1)
      set(id, 'fill-extrusion-vertical-gradient', true)
    } else if (layer.type === 'line') {
      if (sl === 'transportation') set(id, 'line-color', /casing|outline/.test(id) ? P.casing : /rail/.test(id) ? P.rail : P.road)
      else if (sl === 'waterway') set(id, 'line-color', P.water)
      else if (sl === 'boundary') set(id, 'line-opacity', 0.25)
    } else if (layer.type === 'symbol') {
      if (sl === 'poi' || sl === 'housenumber' || sl === 'aerodrome_label' || /shield/.test(id)) m.setLayoutProperty(id, 'visibility', 'none')
      else {
        set(id, 'text-color', sl === 'water_name' ? P.waterLabel : P.label)
        set(id, 'text-halo-color', P.halo)
        set(id, 'text-halo-width', 1.4)
      }
    }
  }
  if (m.getLayer('trail-casing')) set('trail-casing', 'line-color', theme === 'dark' ? '#000000' : '#ffffff')
  m.setLight({ anchor: 'viewport', color: '#ffffff', intensity: P.light, position: [1.4, 205, 35] })
  try {
    m.setSky({ 'sky-color': P.sky, 'horizon-color': P.horizon, 'fog-color': P.fog, 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85, 'atmosphere-blend': 0 })
  } catch {
    /* renderer without sky support */
  }
}
