// ---------------------------------------------------------------------------
// map-engine.ts — engine-agnostic MapEngine interface + shared types
// ---------------------------------------------------------------------------

/** [longitude°, latitude°] — always in decimal degrees */
export type LonLat = [number, number]

export type DataFormat = 'kml' | 'geojson'
export type DataType = 'text' | 'url'

export type DatasetCamera = {
  /** decimal degrees */
  longitude: number
  /** decimal degrees */
  latitude: number
  /** metres above sea level */
  height: number
}

export type AreaRecord = {
  id: string
  name: string
  customName?: string
  aliases: string[]
  toleranceKm?: number
  data: string
  dataType: DataType
  format: DataFormat
}

export type Dataset = {
  title?: string
  description?: string
  camera?: DatasetCamera
  items: AreaRecord[]
}

// ---------------------------------------------------------------------------
// Callback types
// ---------------------------------------------------------------------------

/** Fired when the user clicks on the map (during a game). */
export type MapClickEvent = {
  /** World position of the click in decimal degrees */
  lonLat: LonLat
  /** record id if the click hit a known feature, otherwise undefined */
  recordId: string | undefined
}

export type FlashOptions = {
  /** Duration in ms. Default: 1200 */
  duration?: number
  /** Whether to restore the normal style after flash. Default: true */
  restoreHighlight?: boolean
  /** Record id to set as active after restoration */
  activeId?: string
}

// ---------------------------------------------------------------------------
// Style tokens — engine implementations must honour these
// ---------------------------------------------------------------------------

export type RecordStyleState = 'active' | 'inactive' | 'hidden'

// ---------------------------------------------------------------------------
// MapEngine interface
// ---------------------------------------------------------------------------

export interface MapEngine {
  // --- lifecycle -----------------------------------------------------------

  /** Mount the map into the given container element. */
  mount(container: HTMLElement): void

  /** Cleanly destroy the map and release resources. */
  destroy(): void

  // --- record management ---------------------------------------------------

  /**
   * Load and render a record's geometry.
   * If already loaded, only zooms (when zoom:true).
   */
  loadRecord(record: AreaRecord, opts?: { zoom?: boolean }): Promise<void>

  /** Remove a single record's geometry and overlays from the map. */
  removeRecord(id: string): void

  /** Remove all records and overlays (keeps base tile layer + borders). */
  clearRecords(): void

  /** Ensure all records in the given list are loaded. */
  ensureAllLoaded(records: AreaRecord[]): Promise<void>

  // --- styling -------------------------------------------------------------

  /** Apply active/inactive style to all loaded records. */
  styleAll(activeId?: string): void

  /**
   * Animate a record from its current colour to `cssColour` and back.
   * Resolves after the animation ends.
   */
  flashRecord(id: string, cssColour: string, opts?: FlashOptions): Promise<void>

  // --- overlays ------------------------------------------------------------

  /** Place (or replace) the directional arrow overlay. */
  showArrow(from: LonLat, to: LonLat, distanceKm: number): void

  /** Remove the directional arrow overlay. */
  clearArrow(): void

  /** Show/hide the SVG target pin for a record at its centroid. */
  showPin(id: string, visible: boolean): void

  /** Hide all target pins. */
  hidePins(): void

  /** Place (or replace) the user's guess pin. */
  setGuessPin(lonLat: LonLat, text: string): void

  /** Remove the user's guess pin. */
  clearGuessPin(): void

  // --- camera --------------------------------------------------------------

  /**
   * Animate the camera to fit all loaded records into view.
   * Falls back to `fallback` camera position if no records are loaded.
   */
  zoomToAll(fallback?: DatasetCamera): Promise<void>

  /** Fly/zoom to a single record's extent. */
  zoomToRecord(id: string): Promise<void>

  /** Instantly jump to a lon/lat/height position (no animation). */
  jumpToCamera(camera: DatasetCamera): void

  /** Return the current camera centre as { longitude°, latitude°, height }. */
  getCameraPosition(): DatasetCamera

  // --- spatial queries (pure geometry, no game state) ----------------------

  /** Geodesic distance between two points in km. */
  distanceKm(a: LonLat, b: LonLat): number

  /** Centroid of a loaded record in decimal degrees, or null. */
  getCenter(id: string): LonLat | null

  /**
   * Minimum distance from `point` to any polyline vertex of the record, in km.
   * Returns null if the record has no polyline geometry.
   */
  closestPolylineDistanceKm(id: string, point: LonLat): number | null

  /** Returns true if `point` lies inside the record's polygon(s). */
  isPointInsidePolygon(id: string, point: LonLat): boolean

  /**
   * Minimum distance from `point` to the boundary of the record's polygon(s), in km.
   * Returns null if the record has no polygon geometry.
   */
  closestPolygonBoundaryDistanceKm(id: string, point: LonLat): number | null

  // --- interaction ---------------------------------------------------------

  /**
   * Register a callback that fires on every map click.
   * Only one callback is active at a time; calling again replaces the previous one.
   */
  onMapClick(callback: ((event: MapClickEvent) => void) | null): void
}
