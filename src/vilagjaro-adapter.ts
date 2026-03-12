// ---------------------------------------------------------------------------
// vilagjaro-adapter.ts
//
// Self-contained Világjáró game-mode adapter for the 7streak host system.
//
// Usage (inside 7streak):
//   import { VilagjároGameMode } from '@/vilagjaro/src/vilagjaro-adapter'
//
//   const game = new VilagjároGameMode()
//   game.mount(document.getElementById('game-host')!)
//   await game.loadDataset('/games/magyarorszagkozeptajai.json')
//   game.on('answer:correct', ({ streak }) => hostHud.setStreak(streak))
//   game.on('round:end',      (e)          => hostHud.showResult(e))
//   await game.startRound('select')   // 'select' = 7-streak mode
// ---------------------------------------------------------------------------

import 'ol/ol.css'
import { OLMapEngine } from './ol-map-engine'
import type {
  MapEngine,
  LonLat,
  AreaRecord,
  Dataset,
  DatasetCamera,
  DataType,
  DataFormat,
} from './map-engine'

// ===========================================================================
// Public contract types (re-exported so 7streak can import them too)
// ===========================================================================

export type { Dataset, AreaRecord, DatasetCamera, LonLat } from './map-engine'

/** Game modes Világjáró supports. */
export type VilagjároMode = 'select' | 'pins'

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/** Fired on every correct answer (both modes). */
export interface AnswerCorrectPayload {
  /** ID of the target record that was answered correctly. */
  correctId: string
  /** Display name of the correct record. */
  correctName: string
  /** Current streak length (relevant for select mode). */
  streak: number
  /** Distance from click to target in km (pins mode only). */
  distanceKm?: number
}

/** Fired on every wrong answer (both modes). */
export interface AnswerWrongPayload {
  /** ID of the correct (missed) record. */
  correctId: string
  /** Display name of the correct record. */
  correctName: string
  /** Streak reset to 0. */
  streak: 0
  /** Distance from click to target in km (pins mode only). */
  distanceKm?: number
  /** Cardinal direction from click toward target (pins mode only). */
  direction?: string
}

/** Fired once when the round is over (win or time/attempts exhausted). */
export interface RoundEndPayload {
  mode: VilagjároMode
  /**
   * select → streak achieved (max 7)
   * pins   → number of correct placements (max 12)
   */
  score: number
  maxScore: number
  /** true if the player hit the win condition. */
  won: boolean
}

/** Fired whenever the active question changes. */
export interface QuestionPayload {
  /** ID of the record the player must find / name. */
  targetId: string
  /** Displayable label (customName ?? name). */
  targetName: string
  /**
   * Present in select mode: the 4 shuffled option buttons.
   * The host can render its own buttons or rely on the built-in ones.
   */
  options?: Array<{ id: string; name: string }>
  streak: number
  attemptsLeft: number
  found: number
}

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface PluginEventMap {
  'answer:correct':  AnswerCorrectPayload
  'answer:wrong':    AnswerWrongPayload
  'round:end':       RoundEndPayload
  'question:change': QuestionPayload
}

export type PluginEvent = keyof PluginEventMap

// ===========================================================================
// SevenStreakPlugin — the interface every game mode must implement
// ===========================================================================

export interface SevenStreakPlugin {
  /** Unique slug used by 7streak to identify the module. */
  readonly pluginId: string

  /** Human-readable label shown in the 7streak game-mode picker. */
  readonly displayName: string

  /**
   * Mount the game into `container`.
   * The adapter owns the entire container from this point on.
   * Must be called before loadDataset / startRound.
   */
  mount(container: HTMLElement): void

  /**
   * Tear down everything: destroy the map, clear the container, reset state.
   * After destroy() the instance is no longer usable.
   */
  destroy(): void

  /**
   * Load (or replace) the dataset.
   * Accepts a parsed Dataset object OR the raw JSON string from a .json file.
   * Safe to call before or after mount().
   */
  loadDataset(input: Dataset | string): Promise<void>

  /**
   * Start a fresh round.
   * @param mode  'select' → name the highlighted area (streak mechanic)
   *              'pins'   → click the area on the map (12 attempts)
   * Default: 'select'
   */
  startRound(mode?: VilagjároMode): Promise<void>

  /**
   * Submit an answer in select mode.
   * `recordId` is the id from QuestionPayload.options[n].id.
   * No-op in pins mode (answers come from map clicks automatically).
   */
  submitAnswer(recordId: string): void

  /** Subscribe to a plugin event. */
  on<E extends PluginEvent>(event: E, handler: (payload: PluginEventMap[E]) => void): void

  /** Unsubscribe from a plugin event. */
  off<E extends PluginEvent>(event: E, handler: (payload: PluginEventMap[E]) => void): void
}

// ===========================================================================
// VilagjároGameMode — concrete implementation
// ===========================================================================

export class VilagjároGameMode implements SevenStreakPlugin {
  readonly pluginId    = 'vilagjaro'
  readonly displayName = 'Világjáró'

  // ── Map engine ────────────────────────────────────────────────────────────
  private engine: MapEngine | null = null

  // ── Dataset ───────────────────────────────────────────────────────────────
  private db:            AreaRecord[]     = []
  private datasetCamera: DatasetCamera | undefined

  // ── Round state ───────────────────────────────────────────────────────────
  private gameMode:     VilagjároMode = 'select'
  private queue:        string[]      = []
  private index         = 0
  private streak        = 0
  private lastFailedId: string | null = null
  private attemptsLeft  = 12
  private found         = 0
  private running       = false
  private locked        = false

  // ── DOM refs ──────────────────────────────────────────────────────────────
  private container:  HTMLElement | null = null
  private mapEl:      HTMLElement | null = null
  private questionEl: HTMLElement | null = null
  private optionsEl:  HTMLElement | null = null

  // ── Event bus ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly listeners = new Map<string, Set<(p: any) => void>>()

  // =========================================================================
  // SevenStreakPlugin — lifecycle
  // =========================================================================

  mount(container: HTMLElement): void {
    this.container = container
    container.innerHTML = ''
    container.style.cssText =
      'position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;'

    // ── Question header (hidden by default) ──
    this.questionEl = document.createElement('div')
    this.questionEl.className = 'vjr-question-bar'
    this.questionEl.style.cssText =
      'display:none;padding:10px 16px;background:#0f172a;color:#f8fafc;' +
      'font:600 14px Inter,system-ui,sans-serif;border-bottom:1px solid #1e293b;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    container.appendChild(this.questionEl)

    // ── Map ──
    this.mapEl = document.createElement('div')
    this.mapEl.className = 'vjr-map'
    this.mapEl.style.cssText = 'flex:1;min-height:200px;position:relative;'
    container.appendChild(this.mapEl)

    // ── Option buttons (select mode, hidden by default) ──
    this.optionsEl = document.createElement('div')
    this.optionsEl.className = 'vjr-options'
    this.optionsEl.style.cssText =
      'display:none;padding:10px 12px;gap:8px;flex-wrap:wrap;justify-content:center;' +
      'background:#0f172a;border-top:1px solid #1e293b;'
    container.appendChild(this.optionsEl)

    // ── Wire up engine ──
    this.engine = new OLMapEngine()
    this.engine.mount(this.mapEl)

    // ── Map click → pins handler ──
    this.engine.onMapClick(async ({ lonLat, recordId }) => {
      if (!this.running || this.locked || this.gameMode !== 'pins') return
      await this.handlePinsClick(lonLat, recordId)
    })

    // ── Option button clicks ──
    this.optionsEl.addEventListener('click', (e) => {
      if (!this.running || this.gameMode !== 'select' || this.locked) return
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-vjr-id]')
      if (btn?.dataset.vjrId) this.submitAnswer(btn.dataset.vjrId)
    })
  }

  destroy(): void {
    this.engine?.onMapClick(null)
    this.engine?.destroy()
    this.engine = null
    if (this.container) this.container.innerHTML = ''
    this.container   = null
    this.mapEl       = null
    this.questionEl  = null
    this.optionsEl   = null
    this.db          = []
    this.running     = false
    this.locked      = false
    this.listeners.clear()
  }

  // =========================================================================
  // SevenStreakPlugin — dataset
  // =========================================================================

  async loadDataset(input: Dataset | string): Promise<void> {
    const dataset = typeof input === 'string' ? parseDataset(input) : input
    this.db           = dataset.items
    this.datasetCamera = dataset.camera
    if (!this.engine) return
    this.engine.clearRecords()
    if (dataset.camera) this.engine.jumpToCamera(dataset.camera)
  }

  // =========================================================================
  // SevenStreakPlugin — round management
  // =========================================================================

  async startRound(mode: VilagjároMode = 'select'): Promise<void> {
    if (!this.engine) throw new Error('[Világjáró] Call mount() before startRound()')
    if (this.db.length === 0) throw new Error('[Világjáró] Call loadDataset() before startRound()')

    this.gameMode     = mode
    this.queue        = this.buildQueue(mode === 'pins' ? Math.min(12, this.db.length) : 7)
    this.index        = 0
    this.streak       = 0
    this.lastFailedId = null
    this.attemptsLeft = 12
    this.found        = 0
    this.running      = true
    this.locked       = false

    this.engine.clearArrow()
    this.engine.hidePins()
    this.engine.clearGuessPin()
    this.engine.styleAll()

    await this.engine.ensureAllLoaded(this.db)
    await this.engine.zoomToAll(this.datasetCamera)
    await this.renderQuestion()
  }

  // =========================================================================
  // SevenStreakPlugin — answer submission (select mode)
  // =========================================================================

  submitAnswer(recordId: string): void {
    if (!this.running || this.gameMode !== 'select' || this.locked) return
    this.locked = true
    const target = this.currentTarget()
    if (!target) { this.locked = false; return }
    if (recordId === target.id) void this.onSelectCorrect()
    else                        void this.onSelectWrong()
  }

  // =========================================================================
  // SevenStreakPlugin — event bus
  // =========================================================================

  on<E extends PluginEvent>(event: E, handler: (payload: PluginEventMap[E]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
  }

  off<E extends PluginEvent>(event: E, handler: (payload: PluginEventMap[E]) => void): void {
    this.listeners.get(event)?.delete(handler)
  }

  // =========================================================================
  // Private — event emit
  // =========================================================================

  private emit<E extends PluginEvent>(event: E, payload: PluginEventMap[E]): void {
    this.listeners.get(event)?.forEach((h) => h(payload))
  }

  // =========================================================================
  // Private — helpers
  // =========================================================================

  private currentTarget(): AreaRecord | undefined {
    return this.db.find((r) => r.id === this.queue[this.index])
  }

  private label(record: AreaRecord): string {
    return record.customName?.trim() || record.name
  }

  private buildQueue(length: number): string[] {
    const ids = this.db.map((r) => r.id)
    if (ids.length === 0) return []
    const queue: string[] = []
    if (this.lastFailedId && ids.includes(this.lastFailedId))
      queue.push(this.lastFailedId)
    const pool = ids.filter((id) => !queue.includes(id))
    while (queue.length < length && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length)
      queue.push(pool.splice(i, 1)[0])
    }
    while (queue.length < length)
      queue.push(ids[Math.floor(Math.random() * ids.length)])
    return queue
  }

  private shuffle<T>(arr: T[]): T[] {
    const c = [...arr]
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[c[i], c[j]] = [c[j], c[i]]
    }
    return c
  }

  // =========================================================================
  // Private — render question UI
  // =========================================================================

  private async renderQuestion(): Promise<void> {
    const target = this.currentTarget()
    if (!target || !this.engine) return

    if (this.gameMode === 'select') {
      // Question bar
      if (this.questionEl) {
        this.questionEl.style.display = 'block'
        this.questionEl.textContent   = 'Nevezd meg a kijelölt területet!'
      }

      // Four shuffled option buttons
      if (this.optionsEl) {
        this.optionsEl.style.display = 'flex'
        const options = this.shuffle([
          target,
          ...this.shuffle(this.db.filter((r) => r.id !== target.id)).slice(0, 3),
        ])
        this.optionsEl.innerHTML = ''
        options.forEach((rec) => {
          const btn       = document.createElement('button')
          btn.dataset.vjrId = rec.id
          btn.textContent   = this.label(rec)
          btn.className     = 'vjr-option-btn'
          btn.style.cssText =
            'padding:8px 20px;border-radius:10px;border:2px solid #38bdf8;' +
            'background:rgba(56,189,248,0.12);color:#f8fafc;cursor:pointer;' +
            'font:600 13px Inter,system-ui,sans-serif;transition:background .15s;'
          btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(56,189,248,0.28)' })
          btn.addEventListener('mouseout',  () => { btn.style.background = 'rgba(56,189,248,0.12)' })
          this.optionsEl!.appendChild(btn)
        })
      }

      await this.engine.ensureAllLoaded(this.db)
      this.engine.styleAll(target.id)
      this.engine.showPin(target.id, true)
    } else {
      // Pins mode
      if (this.questionEl) {
        this.questionEl.style.display = 'block'
        this.questionEl.textContent   = `Mutasd meg: ${this.label(target)}`
      }
      if (this.optionsEl) this.optionsEl.style.display = 'none'
      this.engine.hidePins()
      this.engine.clearArrow()
    }

    // Emit question:change so 7streak HUD can display progress
    this.emit('question:change', {
      targetId:   target.id,
      targetName: this.label(target),
      options:
        this.gameMode === 'select'
          ? this.shuffle([
              target,
              ...this.shuffle(this.db.filter((r) => r.id !== target.id)).slice(0, 3),
            ]).map((r) => ({ id: r.id, name: this.label(r) }))
          : undefined,
      streak:       this.streak,
      attemptsLeft: this.attemptsLeft,
      found:        this.found,
    })
  }

  // =========================================================================
  // Private — select mode game flow
  // =========================================================================

  private async onSelectCorrect(): Promise<void> {
    const target = this.currentTarget()
    this.streak += 1
    if (target) await this.engine!.flashRecord(target.id, '#22c55e', { duration: 900 })

    this.emit('answer:correct', {
      correctId:   target?.id   ?? '',
      correctName: target ? this.label(target) : '',
      streak:      this.streak,
    })

    // Win condition: 7 correct in a row
    if (this.streak >= 7) {
      this.running = false
      this.emit('round:end', { mode: 'select', score: 7, maxScore: 7, won: true })
      this.locked = false
      return
    }

    this.index += 1
    if (this.index >= this.queue.length) {
      this.queue = this.buildQueue(7)
      this.index = 0
    }
    await this.renderQuestion()
    this.locked = false
  }

  private async onSelectWrong(): Promise<void> {
    const target = this.currentTarget()
    this.streak       = 0
    this.lastFailedId = target?.id ?? null

    if (target) await this.engine!.flashRecord(target.id, '#ef4444', { duration: 900 })

    this.emit('answer:wrong', {
      correctId:   target?.id   ?? '',
      correctName: target ? this.label(target) : '',
      streak:      0,
    })

    // Rebuild queue with the missed item first, reset index
    this.queue = this.buildQueue(7)
    this.index = 0
    await this.renderQuestion()
    this.locked = false
  }

  // =========================================================================
  // Private — pins mode game flow
  // =========================================================================

  private async handlePinsClick(lonLat: LonLat, clickedRecordId: string | undefined): Promise<void> {
    if (!this.engine) return
    this.locked = true

    const target = this.currentTarget()
    if (!target) { this.locked = false; return }

    const inside   = this.engine.isPointInsidePolygon(target.id, lonLat)
    const polyDist = this.engine.closestPolylineDistanceKm(target.id, lonLat)
    const polyBnd  = this.engine.closestPolygonBoundaryDistanceKm(target.id, lonLat)
    const center   = this.engine.getCenter(target.id)

    const candidates = (
      [inside ? 0 : null, polyBnd, polyDist, center ? this.engine.distanceKm(lonLat, center) : null]
    ).filter((v): v is number => typeof v === 'number')

    const dist      = candidates.length > 0 ? Math.min(...candidates) : Infinity
    const tolerance = Number.isFinite(target.toleranceKm) ? target.toleranceKm! : 50
    const success   = inside || dist <= tolerance

    this.attemptsLeft -= 1

    if (success) {
      this.engine.clearArrow()
      this.found += 1
      await this.engine.flashRecord(target.id, '#22c55e', { duration: 800, restoreHighlight: false })

      this.emit('answer:correct', {
        correctId:   target.id,
        correctName: this.label(target),
        streak:      this.streak,
        distanceKm:  dist,
      })

      // Advance queue
      this.index += 1
      if (this.index >= this.queue.length) {
        const qs   = Math.min(12, this.db.length)
        this.queue = this.buildQueue(qs)
        this.index = 0
      }
    } else {
      const dir = center ? cardinal(bearingDegrees(lonLat, center)) : undefined
      if (center) this.engine.showArrow(lonLat, center, dist)
      await this.engine.flashRecord(
        clickedRecordId ?? target.id, '#ef4444', { duration: 800, restoreHighlight: false }
      )

      this.emit('answer:wrong', {
        correctId:   target.id,
        correctName: this.label(target),
        streak:      0,
        distanceKm:  dist,
        direction:   dir,
      })
    }

    // Check end condition
    if (this.attemptsLeft <= 0) {
      this.running = false
      this.emit('round:end', {
        mode:     'pins',
        score:    this.found,
        maxScore: 12,
        won:      this.found >= 6,
      })
      this.locked = false
      return
    }

    await this.renderQuestion()
    this.locked = false
  }
}

// ===========================================================================
// Module-private utilities (not exported — used only by VilagjároGameMode)
// ===========================================================================

// ---------------------------------------------------------------------------
// Dataset parser (backward-compatible with legacy Cesium radian camera values)
// ---------------------------------------------------------------------------

const RAD_TO_DEG      = 180 / Math.PI
const isLikelyRadians = (v: number) => Math.abs(v) <= Math.PI * 2

function parseDataset(text: string): Dataset {
  type RawItem = Partial<AreaRecord> & { kml?: string; kmlType?: DataType }
  type RawRoot =
    | RawItem[]
    | { title?: string; description?: string; camera?: Partial<DatasetCamera>; items?: RawItem[] }

  const parsed = JSON.parse(text) as RawRoot

  const toRecord = (item: RawItem): AreaRecord => {
    const data       = item.data ?? item.kml ?? ''
    const dataType: DataType  = item.dataType ?? item.kmlType ?? (/^https?:\/\//.test(data) ? 'url' : 'text')
    const format: DataFormat  = item.format ?? 'kml'
    return {
      id:          item.id ?? crypto.randomUUID(),
      name:        item.name ?? 'Ismeretlen',
      customName:  item.customName,
      aliases:     Array.isArray(item.aliases) ? item.aliases : [],
      toleranceKm: typeof item.toleranceKm === 'number' ? item.toleranceKm : undefined,
      data, dataType, format,
    }
  }

  const normCamera = (cam: Partial<DatasetCamera>): DatasetCamera | undefined => {
    const { longitude, latitude, height } = cam
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || typeof height !== 'number')
      return undefined
    return {
      longitude: isLikelyRadians(longitude) ? longitude * RAD_TO_DEG : longitude,
      latitude:  isLikelyRadians(latitude)  ? latitude  * RAD_TO_DEG : latitude,
      height,
    }
  }

  if (Array.isArray(parsed)) {
    return { items: parsed.map(toRecord).filter((r) => r.name && r.data) }
  }

  return {
    title:       parsed.title,
    description: parsed.description,
    camera:      parsed.camera ? normCamera(parsed.camera) : undefined,
    items:       (parsed.items ?? []).map(toRecord).filter((r) => r.name && r.data),
  }
}

// ---------------------------------------------------------------------------
// Bearing & cardinal direction
// ---------------------------------------------------------------------------

function bearingDegrees(from: LonLat, to: LonLat): number {
  const toRad       = (d: number) => (d * Math.PI) / 180
  const [lon1, lat1] = from.map(toRad)
  const [lon2, lat2] = to.map(toRad)
  const dLon = lon2 - lon1
  const y    = Math.sin(dLon) * Math.cos(lat2)
  const x    = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function cardinal(deg: number): string {
  const dirs = ['É', 'ÉK', 'K', 'DK', 'D', 'DNy', 'Ny', 'ÉNy']
  return dirs[Math.round(deg / 45) % 8]
}
