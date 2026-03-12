// ---------------------------------------------------------------------------
// ol-map-engine.ts — OpenLayers implementation of MapEngine
// ---------------------------------------------------------------------------

import OLMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import XYZ from 'ol/source/XYZ'
import GeoJSONFormat from 'ol/format/GeoJSON'
import KMLFormat from 'ol/format/KML'
import Feature from 'ol/Feature'
import Overlay from 'ol/Overlay'
import { fromLonLat, toLonLat } from 'ol/proj'
import { getDistance } from 'ol/sphere'
import { Fill, Stroke, Style } from 'ol/style'
import { boundingExtent, getCenter as olGetCenter, isEmpty } from 'ol/extent'
import type { Extent } from 'ol/extent'
import type { Geometry, LineString, MultiLineString, Polygon, MultiPolygon } from 'ol/geom'
import type { MapBrowserEvent } from 'ol'
import type { FeatureLike } from 'ol/Feature'

import type {
  MapEngine,
  AreaRecord,
  DatasetCamera,
  LonLat,
  MapClickEvent,
  FlashOptions,
} from './map-engine'

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const INACTIVE_FILL   = 'rgba(0, 216, 255, 0.30)'
const ACTIVE_FILL     = 'rgba(255, 140, 0, 0.70)'
const INACTIVE_STROKE = 'rgba(255,255,255,0.70)'
const ACTIVE_STROKE   = 'rgba(255,220,0,0.85)'
const STROKE_WIDTH    = 1.8
const ACTIVE_STROKE_WIDTH = 2.8

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '')
  const n = parseInt(clean, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const buildStyle = (fill: string, stroke: string, strokeWidth: number): Style =>
  new Style({
    fill: new Fill({ color: fill }),
    stroke: new Stroke({ color: stroke, width: strokeWidth }),
  })

const INACTIVE_STYLE = buildStyle(INACTIVE_FILL, INACTIVE_STROKE, STROKE_WIDTH)
const ACTIVE_STYLE   = buildStyle(ACTIVE_FILL,   ACTIVE_STROKE,   ACTIVE_STROKE_WIDTH)

// ---------------------------------------------------------------------------
// SVG pin factory
// ---------------------------------------------------------------------------

const pinSvgUrl = (gradient: [string, string]) => {
  const [c1, c2] = gradient
  const svg = `<svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
      <stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient></defs>
    <path d="M18 47c7-11 14-17.2 14-27A14 14 0 1 0 4 20c0 9.8 7 16 14 27Z" fill="url(#g)"/>
    <circle cx="18" cy="18" r="6" fill="#0f172a" fill-opacity="0.82"/>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const TARGET_PIN_URL = pinSvgUrl(['#5ad7ff', '#ff8adf'])
const GUESS_PIN_URL  = pinSvgUrl(['#ffcc70', '#ff8adf'])

// ---------------------------------------------------------------------------
// OLMapEngine
// ---------------------------------------------------------------------------

export class OLMapEngine implements MapEngine {
  private map!: OLMap
  private view!: View

  // One VectorLayer + VectorSource per loaded record
  private readonly layers = new Map<string, VectorLayer<VectorSource>>()
  private readonly sources = new Map<string, VectorSource>()

  // Computed centroids and extents per record
  private readonly centers = new Map<string, LonLat>()
  private readonly extents = new Map<string, Extent>()

  // Pin overlays (target pins, one per record)
  private readonly pinOverlays = new Map<string, Overlay>()

  // Arrow overlay (one at a time)
  private arrowOverlay: Overlay | null = null

  // Guess pin overlay
  private guessPinOverlay: Overlay | null = null

  // Country borders layer (separate, never cleared with records)
  private borderLayer: VectorLayer<VectorSource> | null = null

  // Click handler
  private clickCallback: ((event: MapClickEvent) => void) | null = null

  // Current active record id for styling
  private activeId: string | undefined = undefined

  // Flash animation handle
  private flashRaf: number | null = null

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  mount(container: HTMLElement): void {
    this.view = new View({
      center: fromLonLat([19, 47]),
      zoom: 5,
      minZoom: 3,
      maxZoom: 18,
    })

    this.map = new OLMap({
      target: container,
      layers: [
        new TileLayer({
          source: new XYZ({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maxZoom: 19,
          }),
        }),
      ],
      view: this.view,
      controls: [],
    })

    // Country borders
    this.loadBorders()

    // Click handler
    this.map.on('click', (evtRaw) => {
      if (!this.clickCallback) return
      const evt = evtRaw as MapBrowserEvent<PointerEvent>
      const coord = toLonLat(evt.coordinate) as LonLat

      // Hit-test: find the topmost record layer feature
      let recordId: string | undefined
      this.map.forEachFeatureAtPixel(
        evt.pixel,
        (_feat: FeatureLike, layer) => {
          if (recordId) return true // stop after first hit
          // Find which record this layer belongs to
          this.layers.forEach((vl, id) => {
            if (!recordId && vl === layer) recordId = id
          })
          return Boolean(recordId)
        },
        { hitTolerance: 4 }
      )

      this.clickCallback({ lonLat: coord, recordId })
    })
  }

  destroy(): void {
    this.map?.setTarget(undefined as unknown as HTMLElement)
  }

  // ---------------------------------------------------------------------------
  // Borders
  // ---------------------------------------------------------------------------

  private loadBorders(): void {
    const url =
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
    const source = new VectorSource({
      url,
      format: new GeoJSONFormat(),
    })
    this.borderLayer = new VectorLayer({
      source,
      style: new Style({
        stroke: new Stroke({ color: 'rgba(255,255,255,0.55)', width: 1 }),
        fill: new Fill({ color: 'transparent' }),
      }),
      zIndex: 1,
    })
    this.map.addLayer(this.borderLayer)
  }

  // ---------------------------------------------------------------------------
  // Record management
  // ---------------------------------------------------------------------------

  async loadRecord(record: AreaRecord, opts?: { zoom?: boolean }): Promise<void> {
    if (this.sources.has(record.id)) {
      if (opts?.zoom) await this.zoomToRecord(record.id)
      return
    }

    let features: Feature<Geometry>[]

    if (record.format === 'geojson') {
      const fmt = new GeoJSONFormat({ featureProjection: 'EPSG:3857' })
      if (record.dataType === 'text') {
        features = fmt.readFeatures(JSON.parse(record.data)) as Feature<Geometry>[]
      } else {
        const res = await fetch(record.data)
        const json = await res.json()
        features = fmt.readFeatures(json) as Feature<Geometry>[]
      }
    } else {
      // KML
      const fmt = new KMLFormat({ extractStyles: false })
      let kmlText: string
      if (record.dataType === 'text') {
        kmlText = record.data
      } else {
        const res = await fetch(record.data)
        kmlText = await res.text()
      }
      features = fmt.readFeatures(kmlText, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }) as Feature<Geometry>[]
    }

    // Filter out point features (city centres etc.) and tag with recordId
    features = features.filter((f) => {
      const type = f.getGeometry()?.getType()
      return type !== 'Point' && type !== 'MultiPoint'
    })

    features.forEach((f) => f.set('recordId', record.id))

    const source = new VectorSource({ features })
    const layer = new VectorLayer({
      source,
      style: INACTIVE_STYLE,
      zIndex: 2,
    })

    this.map.addLayer(layer)
    this.sources.set(record.id, source)
    this.layers.set(record.id, layer)

    this.computeCenter(record.id)

    if (opts?.zoom) await this.zoomToRecord(record.id)
  }

  removeRecord(id: string): void {
    const layer = this.layers.get(id)
    if (layer) this.map.removeLayer(layer)
    this.layers.delete(id)
    this.sources.delete(id)
    this.centers.delete(id)
    this.extents.delete(id)
    this.removePinOverlay(id)
  }

  clearRecords(): void {
    for (const id of [...this.layers.keys()]) {
      this.removeRecord(id)
    }
    this.clearArrow()
    this.clearGuessPin()
  }

  async ensureAllLoaded(records: AreaRecord[]): Promise<void> {
    for (const record of records) {
      await this.loadRecord(record)
    }
  }

  // ---------------------------------------------------------------------------
  // Centroid / extent
  // ---------------------------------------------------------------------------

  private computeCenter(id: string): void {
    const source = this.sources.get(id)
    if (!source) return

    const ext = source.getExtent()
    if (!ext || isEmpty(ext)) return

    this.extents.set(id, ext)
    const center3857 = olGetCenter(ext)
    this.centers.set(id, toLonLat(center3857) as LonLat)
  }

  // ---------------------------------------------------------------------------
  // Styling
  // ---------------------------------------------------------------------------

  styleAll(activeId?: string): void {
    this.activeId = activeId
    for (const [id, layer] of this.layers) {
      layer.setStyle(id === activeId ? ACTIVE_STYLE : INACTIVE_STYLE)
    }
  }

  async flashRecord(id: string, cssColour: string, opts?: FlashOptions): Promise<void> {
    const layer = this.layers.get(id)
    if (!layer) return

    const duration = opts?.duration ?? 1200
    const [tr, tg, tb] = hexToRgb(cssColour)
    const [fr, fg, fb] = hexToRgb(
      id === this.activeId ? '#ff8c00' : '#00d8ff'
    )

    // Cancel any running flash
    if (this.flashRaf !== null) {
      cancelAnimationFrame(this.flashRaf)
      this.flashRaf = null
    }

    return new Promise<void>((resolve) => {
      const start = performance.now()

      const tick = () => {
        const t = Math.min((performance.now() - start) / duration, 1)
        const eased = t * t * (3 - 2 * t) // smoothstep
        const r = Math.round(lerp(fr, tr, eased))
        const g = Math.round(lerp(fg, tg, eased))
        const b = Math.round(lerp(fb, tb, eased))

        const fill = `rgba(${r},${g},${b},0.55)`
        const stroke = `rgba(${r},${g},${b},0.85)`
        layer.setStyle(buildStyle(fill, stroke, ACTIVE_STROKE_WIDTH))
        this.map.render()

        if (t < 1) {
          this.flashRaf = requestAnimationFrame(tick)
        } else {
          this.flashRaf = null
          const restore = opts?.restoreHighlight ?? true
          if (restore) {
            this.styleAll(opts?.activeId ?? this.activeId)
          }
          resolve()
        }
      }

      this.flashRaf = requestAnimationFrame(tick)
    })
  }

  // ---------------------------------------------------------------------------
  // Arrow overlay
  // ---------------------------------------------------------------------------

  showArrow(from: LonLat, to: LonLat, distanceKm: number): void {
    this.clearArrow()

    // Build a small arrow canvas
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 52
    const ctx = canvas.getContext('2d')!

    // Arrow line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(10, 26)
    ctx.lineTo(165, 26)
    ctx.stroke()

    // Arrowhead
    ctx.fillStyle = '#f97316'
    ctx.beginPath()
    ctx.moveTo(190, 26)
    ctx.lineTo(162, 14)
    ctx.lineTo(162, 38)
    ctx.closePath()
    ctx.fill()

    // Label background
    const label = `${distanceKm.toFixed(1)} km`
    ctx.font = 'bold 14px Inter, system-ui, sans-serif'
    const metrics = ctx.measureText(label)
    const lw = metrics.width + 14
    const lh = 22
    const lx = (canvas.width - lw) / 2
    const ly = 2
    ctx.fillStyle = 'rgba(255,255,255,0.93)'
    ctx.beginPath()
    ctx.roundRect(lx, ly, lw, lh, 5)
    ctx.fill()
    ctx.fillStyle = '#0f172a'
    ctx.fillText(label, lx + 7, ly + 15)

    // Rotate the canvas so the arrow points from `from` toward `to`
    const fromPx = this.map.getPixelFromCoordinate(fromLonLat(from))
    const toPx   = this.map.getPixelFromCoordinate(fromLonLat(to))

    let angle = 0
    if (fromPx && toPx) {
      angle = Math.atan2(toPx[1] - fromPx[1], toPx[0] - fromPx[0])
    }

    const el = document.createElement('div')
    el.style.cssText = `transform: rotate(${angle}rad); transform-origin: left center; pointer-events: none;`
    el.appendChild(canvas)

    this.arrowOverlay = new Overlay({
      element: el,
      position: fromLonLat(from),
      positioning: 'center-left',
      stopEvent: false,
    })
    this.map.addOverlay(this.arrowOverlay)
  }

  clearArrow(): void {
    if (this.arrowOverlay) {
      this.map.removeOverlay(this.arrowOverlay)
      this.arrowOverlay = null
    }
  }

  // ---------------------------------------------------------------------------
  // Target pins
  // ---------------------------------------------------------------------------

  showPin(id: string, visible: boolean): void {
    if (!visible) {
      const ov = this.pinOverlays.get(id)
      if (ov) ov.getElement()!.style.display = 'none'
      return
    }

    if (this.pinOverlays.has(id)) {
      const ov = this.pinOverlays.get(id)!
      ov.getElement()!.style.display = ''
      return
    }

    const center = this.centers.get(id)
    if (!center) return

    const el = this.makePinElement(TARGET_PIN_URL)
    const overlay = new Overlay({
      element: el,
      position: fromLonLat(center),
      positioning: 'bottom-center',
      stopEvent: false,
    })
    this.pinOverlays.set(id, overlay)
    this.map.addOverlay(overlay)
  }

  hidePins(): void {
    for (const ov of this.pinOverlays.values()) {
      const el = ov.getElement()
      if (el) el.style.display = 'none'
    }
  }

  private removePinOverlay(id: string): void {
    const ov = this.pinOverlays.get(id)
    if (ov) this.map.removeOverlay(ov)
    this.pinOverlays.delete(id)
  }

  private makePinElement(svgUrl: string, size = 28): HTMLElement {
    const img = document.createElement('img')
    img.src = svgUrl
    img.width = size
    img.height = Math.round(size * 48 / 36)
    img.style.pointerEvents = 'none'
    return img
  }

  // ---------------------------------------------------------------------------
  // Guess pin
  // ---------------------------------------------------------------------------

  setGuessPin(lonLat: LonLat, text: string): void {
    this.clearGuessPin()

    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;'

    const label = document.createElement('div')
    label.style.cssText =
      'background:rgba(255,255,255,0.93);color:#0f172a;font:600 13px Inter,system-ui,sans-serif;' +
      'padding:3px 9px;border-radius:6px;white-space:nowrap;margin-bottom:3px;' +
      'box-shadow:0 1px 4px rgba(0,0,0,0.18);'
    label.textContent = text

    const img = this.makePinElement(GUESS_PIN_URL)

    el.appendChild(label)
    el.appendChild(img)

    this.guessPinOverlay = new Overlay({
      element: el,
      position: fromLonLat(lonLat),
      positioning: 'bottom-center',
      stopEvent: false,
    })
    this.map.addOverlay(this.guessPinOverlay)
  }

  clearGuessPin(): void {
    if (this.guessPinOverlay) {
      this.map.removeOverlay(this.guessPinOverlay)
      this.guessPinOverlay = null
    }
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  async zoomToAll(fallback?: DatasetCamera): Promise<void> {
    if (this.extents.size === 0) {
      if (fallback) this.jumpToCamera(fallback)
      return
    }

    const allCoords: number[][] = []
    for (const ext of this.extents.values()) {
      allCoords.push([ext[0], ext[1]], [ext[2], ext[3]])
    }
    const combined = boundingExtent(allCoords)

    return new Promise<void>((resolve) => {
      this.view.fit(combined, {
        padding: [40, 40, 40, 40],
        duration: 900,
        callback: () => resolve(),
      })
    })
  }

  async zoomToRecord(id: string): Promise<void> {
    const ext = this.extents.get(id)
    if (!ext) return
    return new Promise<void>((resolve) => {
      this.view.fit(ext, {
        padding: [60, 60, 60, 60],
        duration: 700,
        maxZoom: 12,
        callback: () => resolve(),
      })
    })
  }

  jumpToCamera(camera: DatasetCamera): void {
    this.view.setCenter(fromLonLat([camera.longitude, camera.latitude]))
    // Convert approximate height to zoom level (rough formula)
    const zoom = Math.max(3, Math.min(16, Math.log2(591657550 / camera.height) + 1))
    this.view.setZoom(zoom)
  }

  getCameraPosition(): DatasetCamera {
    const center3857 = this.view.getCenter() ?? fromLonLat([19, 47])
    const [longitude, latitude] = toLonLat(center3857)
    const zoom = this.view.getZoom() ?? 5
    const height = 591657550 / Math.pow(2, zoom - 1)
    return { longitude, latitude, height }
  }

  // ---------------------------------------------------------------------------
  // Spatial queries
  // ---------------------------------------------------------------------------

  distanceKm(a: LonLat, b: LonLat): number {
    return getDistance(a, b) / 1000
  }

  getCenter(id: string): LonLat | null {
    return this.centers.get(id) ?? null
  }

  closestPolylineDistanceKm(id: string, point: LonLat): number | null {
    const source = this.sources.get(id)
    if (!source) return null

    let minDist = Infinity
    let found = false

    source.getFeatures().forEach((feature) => {
      const geom = feature.getGeometry()
      if (!geom) return

      const type = geom.getType()
      if (type !== 'LineString' && type !== 'MultiLineString') return

      found = true
      const coords3857: number[][] =
        type === 'LineString'
          ? (geom as LineString).getCoordinates()
          : (geom as MultiLineString).getCoordinates().flat()

      for (let i = 0; i < coords3857.length - 1; i++) {
        const a4326 = toLonLat(coords3857[i]) as LonLat
        const b4326 = toLonLat(coords3857[i + 1]) as LonLat
        const segKm = this.distanceKm(a4326, b4326)
        const steps = Math.max(2, Math.ceil(segKm / 20))
        for (let s = 0; s <= steps; s++) {
          const t = s / steps
          const lon = a4326[0] + (b4326[0] - a4326[0]) * t
          const lat = a4326[1] + (b4326[1] - a4326[1]) * t
          minDist = Math.min(minDist, this.distanceKm([lon, lat], point))
        }
      }
    })

    return found ? minDist : null
  }

  isPointInsidePolygon(id: string, point: LonLat): boolean {
    const source = this.sources.get(id)
    if (!source) return false

    const point3857 = fromLonLat(point)

    for (const feature of source.getFeatures()) {
      const geom = feature.getGeometry()
      if (!geom) continue
      const type = geom.getType()
      if (type === 'Polygon') {
        if ((geom as Polygon).intersectsCoordinate(point3857)) return true
      } else if (type === 'MultiPolygon') {
        if ((geom as MultiPolygon).intersectsCoordinate(point3857)) return true
      }
    }
    return false
  }

  closestPolygonBoundaryDistanceKm(id: string, point: LonLat): number | null {
    const source = this.sources.get(id)
    if (!source) return null

    let minDist = Infinity
    let found = false

    const processRing = (ring3857: number[][]) => {
      found = true
      for (let i = 0; i < ring3857.length; i++) {
        const a4326 = toLonLat(ring3857[i]) as LonLat
        const b4326 = toLonLat(ring3857[(i + 1) % ring3857.length]) as LonLat
        const segKm = this.distanceKm(a4326, b4326)
        const steps = Math.max(2, Math.ceil(segKm / 20))
        for (let s = 0; s <= steps; s++) {
          const t = s / steps
          const lon = a4326[0] + (b4326[0] - a4326[0]) * t
          const lat = a4326[1] + (b4326[1] - a4326[1]) * t
          minDist = Math.min(minDist, this.distanceKm([lon, lat], point))
        }
      }
    }

    source.getFeatures().forEach((feature) => {
      const geom = feature.getGeometry()
      if (!geom) return
      const type = geom.getType()
      if (type === 'Polygon') {
        ;(geom as Polygon).getCoordinates().forEach(processRing)
      } else if (type === 'MultiPolygon') {
        ;(geom as MultiPolygon).getCoordinates().forEach((poly) => poly.forEach(processRing))
      }
    })

    return found ? minDist : null
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  onMapClick(callback: ((event: MapClickEvent) => void) | null): void {
    this.clickCallback = callback
  }
}
