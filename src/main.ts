import 'ol/ol.css'
import './style.css'
import { OLMapEngine } from './ol-map-engine'
import type { MapEngine, LonLat, AreaRecord, Dataset, DatasetCamera, DataFormat, DataType } from './map-engine'
import osmtogeojson from 'osmtogeojson'

type GameMode = 'pins' | 'select'

type GameState = {
  mode: GameMode
  queue: string[]
  index: number
  streak: number
  lastFailedId: string | null
  running: boolean
  attemptsLeft: number
  found: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLASH_CORRECT = '#22c55e'
const FLASH_WRONG   = '#ef4444'

// ---------------------------------------------------------------------------
// App shell HTML
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root not found')

app.innerHTML = `
  <div class="app-shell">
    <section id="landing" class="landing">
      <div class="landing-card">
        <div class="landing-art" aria-hidden="true">
          <img src="/hero.jpg" alt="Világjáró illusztráció" />
        </div>
        <div class="landing-copy">
          <p class="landing-subtitle">Válassz feladatsort, nézd meg a térképet, és induljon a játék!</p>
          <div class="landing-actions">
            <button id="landing-new" class="primary">Új feladatsor</button>
            <label class="file-button ghost">
              Szerkesztés folytatása
              <input id="landing-continue" type="file" accept="application/json" />
            </label>
            <label class="file-button strong">
              Játék
              <input id="landing-play" type="file" accept="application/json" />
            </label>
          </div>
          <div class="landing-demos">
            <p class="landing-demo-title">Demók</p>
            <div class="landing-demo-buttons">
              <button class="landing-demo" data-demo="/games/kozepeuropafolyoivizei.json">Közép-Európa folyói vizei</button>
              <button class="landing-demo" data-demo="/games/kozepeuropavarosai.json">Közép-Európa városai</button>
              <button class="landing-demo" data-demo="/games/magyarorszagkozeptajai.json">Magyarország középtájai</button>
            </div>
          </div>
        </div>
      </div>
    </section>
    <header class="top-bar">
      <div class="brand">Világjáró — OpenLayers játék</div>
      <nav class="nav">
        <button id="nav-editor" class="nav-button active">Szerkesztő</button>
        <button id="nav-player" class="nav-button">Lejátszó</button>
      </nav>
      <div id="player-bar" class="player-bar">
        <div class="player-info">
          <div class="player-task">Feladat: <span id="task-label">-</span></div>
          <div class="player-meta">
            <div id="status-extra" class="player-streak"></div>
            <div id="feedback" class="feedback player-feedback"> </div>
          </div>
        </div>
        <div class="player-actions">
          <button id="hud-pins" class="hud-button primary">Gombostűk</button>
          <button id="hud-select" class="hud-button">Nevezd meg!</button>
        </div>
        <button id="game-exit" class="game-exit" aria-label="Vissza a főoldalra">×</button>
      </div>
    </header>
    <main class="main">
      <section id="panel" class="panel">
        <section id="editor-view" class="view">
          <div class="editor-layout">

            <div class="editor-meta-bar">
              <input id="dataset-title" type="text" class="meta-input meta-title-input" placeholder="Feladatsor neve…" />
              <textarea id="dataset-description" rows="2" class="meta-input meta-desc-input" placeholder="Rövid leírás (opcionális)…"></textarea>
            </div>

            <div class="add-card" id="add-card">
              <div class="add-card-top">
                <p class="eyebrow" style="margin:0">Terület hozzáadása</p>
                <div class="source-tabs-bar" id="source-tabs-bar">
                  <button class="source-tab active" data-tab="url" type="button">🔗 URL</button>
                  <button class="source-tab" data-tab="file" type="button">📎 Fájl</button>
                  <button class="source-tab" data-tab="osm" type="button">🌍 OSM</button>
                </div>
              </div>

              <div class="form-grid">
                <label>
                  Terület neve <span class="req-star">*</span>
                  <input id="record-name" type="text" placeholder="Pl.: Balaton" />
                </label>
                <label>
                  Egyedi megjelenítési név
                  <input id="record-custom-name" type="text" placeholder="Pl.: Balaton (tó)" />
                </label>
              </div>

              <div id="tab-url" class="tab-pane">
                <div class="form-grid two-col">
                  <label>
                    Formátum
                    <select id="record-format">
                      <option value="kml">KML</option>
                      <option value="geojson">GeoJSON</option>
                    </select>
                  </label>
                  <label>
                    Adat URL
                    <input id="record-url" type="url" placeholder="https://…/area.kml" />
                  </label>
                </div>
              </div>

              <div id="tab-file" class="tab-pane hidden">
                <label class="file-drop-label">
                  <div class="file-drop-zone" id="file-drop-zone">
                    <span class="file-drop-icon">📎</span>
                    <span class="file-drop-text">Kattints vagy húzd ide a fájlt</span>
                    <span class="file-drop-hint">.kml · .geojson · .json</span>
                    <input id="record-file" type="file" accept=".kml,.geojson,.json" />
                  </div>
                  <span id="file-name-display" class="file-name-display hidden"></span>
                </label>
              </div>

              <div id="tab-osm" class="tab-pane hidden">
                <p class="tab-hint">OSM Relation ID alapján letöltjük és GeoJSON-ná alakítjuk a területet.</p>
                <div class="osm-input-row">
                  <input id="osm-relation-id" type="number" placeholder="Pl.: 123924" />
                  <button id="osm-relation-import" type="button">Lekérés</button>
                </div>
              </div>

              <div class="add-card-bottom">
                <label class="tolerance-row">
                  <span>Tűrési kör <abbr title="Ennyi km-en belüli kattintás helyes. Alapért.: 50 km">ⓘ</abbr></span>
                  <span class="tolerance-field">
                    <input id="record-tolerance" type="number" min="0" step="1" placeholder="50" />
                    <span class="tolerance-unit">km</span>
                  </span>
                </label>
                <div class="add-actions">
                  <button id="add-record" class="primary" type="button">Hozzáadás</button>
                  <button id="cancel-edit" type="button" class="hidden">Mégse</button>
                </div>
              </div>
            </div>

            <div class="records-section">
              <div class="records-header">
                <span class="records-title">Feladatok</span>
                <span class="pill pill-ghost"><span id="record-count">0</span> tétel</span>
              </div>
              <div id="record-empty" class="record-empty">
                <div class="record-empty-icon">🗺️</div>
                <p class="record-empty-title">Még nincs elem</p>
                <p class="record-empty-hint">Adj hozzá területet URL-lel, fájllal vagy OSM azonosítóval</p>
              </div>
              <ul id="record-list" class="record-list"></ul>
            </div>

            <div class="editor-footer">
              <div class="editor-footer-start">
                <button id="save-json" type="button">💾 Mentés</button>
                <label class="file-button">
                  📂 Betöltés
                  <input id="load-json" type="file" accept="application/json" />
                </label>
              </div>
              <div class="editor-footer-end">
                <button id="clear-records" type="button" class="editor-clear-btn">🗑 Töröl</button>
                <button id="editor-play" type="button" class="primary">▶ Játék</button>
              </div>
            </div>

          </div>
        </section>

        <section id="player-view" class="view hidden">
          <div id="select-mode" class="select-mode hidden">
            <h3>Válaszlehetőségek</h3>
            <div id="option-list" class="option-list"></div>
          </div>
        </section>
      </section>
      <div id="splitter" class="splitter" role="separator" aria-label="Panel átméretezése"></div>
      <section class="map">
        <div id="mapContainer"></div>
      </section>
    </main>
  </div>
`

// ---------------------------------------------------------------------------
// Postgame overlay
// ---------------------------------------------------------------------------

const postgame = document.createElement('div')
postgame.className = 'postgame hidden'
postgame.innerHTML = `
  <div class="postgame-copy">
    <h3 id="postgame-title"></h3>
    <p id="postgame-result"></p>
  </div>
  <div class="postgame-actions">
    <button id="postgame-restart" class="primary">Újra játszom</button>
    <button id="postgame-switch">Másik játékmód</button>
  </div>
`
app.appendChild(postgame)

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const navEditor           = document.querySelector<HTMLButtonElement>('#nav-editor')
const navPlayer           = document.querySelector<HTMLButtonElement>('#nav-player')
const editorView          = document.querySelector<HTMLDivElement>('#editor-view')
const playerView          = document.querySelector<HTMLDivElement>('#player-view')
const landing             = document.querySelector<HTMLDivElement>('#landing')
const recordNameInput     = document.querySelector<HTMLInputElement>('#record-name')
const recordCustomName    = document.querySelector<HTMLInputElement>('#record-custom-name')
const datasetTitleInput   = document.querySelector<HTMLInputElement>('#dataset-title')
const datasetDescInput    = document.querySelector<HTMLTextAreaElement>('#dataset-description')
const recordFormat        = document.querySelector<HTMLSelectElement>('#record-format')
const recordUrl           = document.querySelector<HTMLInputElement>('#record-url')
const recordFile          = document.querySelector<HTMLInputElement>('#record-file')
const recordTolerance     = document.querySelector<HTMLInputElement>('#record-tolerance')
const addRecordButton     = document.querySelector<HTMLButtonElement>('#add-record')
const cancelEditButton    = document.querySelector<HTMLButtonElement>('#cancel-edit')
const clearRecordsButton  = document.querySelector<HTMLButtonElement>('#clear-records')
const recordList          = document.querySelector<HTMLUListElement>('#record-list')
const recordCount         = document.querySelector<HTMLSpanElement>('#record-count')
const saveJsonButton      = document.querySelector<HTMLButtonElement>('#save-json')
const loadJsonInput       = document.querySelector<HTMLInputElement>('#load-json')
const osmRelationIdInput  = document.querySelector<HTMLInputElement>('#osm-relation-id')
const osmImportButton     = document.querySelector<HTMLButtonElement>('#osm-relation-import')
const splitter            = document.querySelector<HTMLDivElement>('#splitter')
const panelShell          = document.querySelector<HTMLElement>('#panel')
const hudPinsButton       = document.querySelector<HTMLButtonElement>('#hud-pins')
const hudSelectButton     = document.querySelector<HTMLButtonElement>('#hud-select')
const gameExitButton      = document.querySelector<HTMLButtonElement>('#game-exit')
const taskLabel           = document.querySelector<HTMLSpanElement>('#task-label')
const feedback            = document.querySelector<HTMLDivElement>('#feedback')
const selectMode          = document.querySelector<HTMLDivElement>('#select-mode')
const optionList          = document.querySelector<HTMLDivElement>('#option-list')
const statusExtra         = document.querySelector<HTMLDivElement>('#status-extra')
const landingNew          = document.querySelector<HTMLButtonElement>('#landing-new')
const landingContinueInput = document.querySelector<HTMLInputElement>('#landing-continue')
const landingPlayInput    = document.querySelector<HTMLInputElement>('#landing-play')
const landingDemoButtons  = Array.from(document.querySelectorAll<HTMLButtonElement>('.landing-demo'))
const postgameTitle       = postgame.querySelector<HTMLHeadingElement>('#postgame-title')
const postgameResult      = postgame.querySelector<HTMLParagraphElement>('#postgame-result')
const postgameRestart     = postgame.querySelector<HTMLButtonElement>('#postgame-restart')
const postgameSwitch      = postgame.querySelector<HTMLButtonElement>('#postgame-switch')

// ---------------------------------------------------------------------------
// Map engine init
// ---------------------------------------------------------------------------

const engine: MapEngine = new OLMapEngine()
const mapContainer = document.querySelector<HTMLDivElement>('#mapContainer')!
engine.mount(mapContainer)

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let db: AreaRecord[] = []
let datasetTitle = ''
let datasetDescription = ''
let datasetCamera: DatasetCamera | undefined
let editingId: string | null = null
let interactionLocked = false

const game: GameState = {
  mode: 'pins',
  queue: [],
  index: 0,
  streak: 0,
  lastFailedId: null,
  running: false,
  attemptsLeft: 12,
  found: 0,
}

// ---------------------------------------------------------------------------
// Map click handler (registered once, delegates by game state)
// ---------------------------------------------------------------------------

engine.onMapClick(async ({ lonLat, recordId }) => {
  if (!game.running || interactionLocked) return
  if (game.mode !== 'pins') return

  const target = currentTarget()
  if (!target) return

  const inside   = engine.isPointInsidePolygon(target.id, lonLat)
  const polyDist = engine.closestPolylineDistanceKm(target.id, lonLat)
  const polyBnd  = engine.closestPolygonBoundaryDistanceKm(target.id, lonLat)
  const center   = engine.getCenter(target.id)

  if (!inside && polyDist === null && polyBnd === null && center === null) {
    setFeedback('Nincs alakzat ehhez a tételhez.', 'bad')
    return
  }

  const candidates: number[] = [
    inside ? 0 : null,
    polyBnd,
    polyDist,
    center ? engine.distanceKm(lonLat, center) : null,
  ].filter((v): v is number => typeof v === 'number')

  const dist = candidates.length > 0 ? Math.min(...candidates) : Infinity
  const tolerance = getToleranceKm(target)
  const success = inside || dist <= tolerance

  await handlePinsAttempt(success, dist, lonLat, center ?? undefined, recordId)
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const createId = () => crypto.randomUUID()
const displayName = (record: AreaRecord) => record.customName?.trim() || record.name
const getToleranceKm = (record: AreaRecord) =>
  Number.isFinite(record.toleranceKm) ? (record.toleranceKm as number) : 50
const currentTarget = () => db.find((r) => r.id === game.queue[game.index])

const setFeedback = (message: string, variant: 'good' | 'bad' | 'neutral' = 'neutral') => {
  if (!feedback) return
  feedback.textContent = message
  feedback.className = `feedback ${variant}`
}

const updateHudButtons = (mode: GameMode) => {
  hudPinsButton?.classList.toggle('primary', mode === 'pins')
  hudSelectButton?.classList.toggle('primary', mode === 'select')
}

const setGameRunning = (running: boolean) => document.body.classList.toggle('game-running', running)

const setLandingVisible = (visible: boolean) => {
  landing?.classList.toggle('hidden', !visible)
  document.body.classList.toggle('landing-open', visible)
}

updateHudButtons(game.mode)
setLandingVisible(true)

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

const soundFiles = {
  start:    '/sounds/start.mp3',
  correct:  '/sounds/correct.mp3',
  wrong:    '/sounds/wrong.mp3',
  streak:   '/sounds/streak.mp3',
  click:    '/sounds/click.mp3',
  nextTask: '/sounds/nextTask.mp3',
  end:      '/sounds/end.mp3',
} as const

type SoundName = keyof typeof soundFiles
const soundCache = new Map<SoundName, HTMLAudioElement>()

const playSound = (name: SoundName, volume = 1) => {
  let audio = soundCache.get(name)
  if (!audio) {
    audio = new Audio(soundFiles[name])
    audio.preload = 'auto'
    soundCache.set(name, audio)
  }
  try { audio.currentTime = 0; audio.volume = volume; void audio.play() } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// JSON parsing — backward-compat with legacy kml/kmlType fields
// Handles both old (camera in radians) and new (camera in degrees) formats.
// ---------------------------------------------------------------------------

const RAD_TO_DEG = 180 / Math.PI
const isLikelyRadians = (v: number) => Math.abs(v) <= Math.PI * 2

const parseRecords = (text: string): Dataset => {
  const parsed = JSON.parse(text) as
    | Array<Partial<AreaRecord> & { kml?: string; kmlType?: DataType }>
    | {
        title?: string
        description?: string
        camera?: Partial<DatasetCamera>
        items?: Array<Partial<AreaRecord> & { kml?: string; kmlType?: DataType }>
      }

  const toRecord = (item: Partial<AreaRecord> & { kml?: string; kmlType?: DataType }) => {
    const data = item.data ?? item.kml ?? ''
    const dataType =
      item.dataType ?? item.kmlType ?? (/^https?:\/\//.test(data) ? 'url' : 'text')
    const format = item.format ?? 'kml'
    const toleranceKm = typeof item.toleranceKm === 'number' ? item.toleranceKm : undefined
    return {
      id: item.id ?? createId(),
      name: item.name ?? 'Ismeretlen',
      customName: item.customName,
      toleranceKm,
      data,
      dataType,
      format,
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
    } as AreaRecord
  }

  const normCamera = (cam: Partial<DatasetCamera>): DatasetCamera | undefined => {
    const { longitude, latitude, height } = cam
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || typeof height !== 'number')
      return undefined
    // Legacy: Cesium stored lon/lat in radians — auto-detect and convert
    const lon = isLikelyRadians(longitude) ? longitude * RAD_TO_DEG : longitude
    const lat = isLikelyRadians(latitude)  ? latitude  * RAD_TO_DEG : latitude
    return { longitude: lon, latitude: lat, height }
  }

  const cameraRaw = parsed && 'camera' in parsed ? parsed.camera : undefined

  if (Array.isArray(parsed)) {
    return { items: parsed.map(toRecord).filter((r) => r.name && r.data) }
  }

  if (parsed && Array.isArray(parsed.items)) {
    return {
      title: parsed.title,
      description: parsed.description,
      camera: cameraRaw ? normCamera(cameraRaw) : undefined,
      items: parsed.items.map(toRecord).filter((r) => r.name && r.data),
    }
  }

  throw new Error('Invalid JSON')
}

// ---------------------------------------------------------------------------
// Dataset apply
// ---------------------------------------------------------------------------

const applyDataset = (dataset: Dataset) => {
  db = dataset.items
  datasetTitle       = dataset.title ?? ''
  datasetDescription = dataset.description ?? ''
  datasetCamera      = dataset.camera
  if (datasetTitleInput) datasetTitleInput.value = datasetTitle
  if (datasetDescInput)  datasetDescInput.value  = datasetDescription
  engine.clearRecords()
  refreshList()
  if (datasetCamera) engine.jumpToCamera(datasetCamera)
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const refreshList = () => {
  if (!recordList) return
  if (recordCount) recordCount.textContent = String(db.length)
  const emptyState = document.querySelector<HTMLDivElement>('#record-empty')
  if (emptyState) emptyState.classList.toggle('hidden', db.length > 0)
  recordList.innerHTML = ''
  db.forEach((record) => {
    const shownName    = displayName(record)
    const subtitleParts = [record.format.toUpperCase(), record.dataType === 'url' ? 'URL' : 'Fájl']
    if (record.toleranceKm !== undefined) subtitleParts.push(`${record.toleranceKm} km`)
    const item = document.createElement('li')
    item.className = 'record-item'
    item.innerHTML = `
      <div class="record-item-info">
        <strong>${shownName}</strong>
        <small>${subtitleParts.join(' · ')}</small>
      </div>
      <div class="record-actions">
        <button data-action="edit"   data-id="${record.id}" class="icon-btn" title="Szerkesztés">✏️</button>
        <button data-action="show"   data-id="${record.id}" class="icon-btn" title="Megjelenítés">👁</button>
        <button data-action="remove" data-id="${record.id}" class="icon-btn icon-btn--danger" title="Törlés">🗑</button>
      </div>
    `
    recordList.appendChild(item)
  })
}

const syncDatasetMeta = () => {
  datasetTitle       = datasetTitleInput?.value.trim() ?? ''
  datasetDescription = datasetDescInput?.value.trim()  ?? ''
}

datasetTitleInput?.addEventListener('input', syncDatasetMeta)
datasetDescInput?.addEventListener('input', syncDatasetMeta)

const showPostgame = (title: string, result: string) => {
  if (postgameTitle)  postgameTitle.textContent  = title
  if (postgameResult) postgameResult.textContent = result
  postgame.classList.remove('hidden')
  document.body.classList.add('postgame-visible')
}

const hidePostgame = () => {
  postgame.classList.add('hidden')
  document.body.classList.remove('postgame-visible')
}

const setupSplitter = () => {
  if (!splitter || !panelShell) return
  const min = 300, max = 560
  let startX = 0, startWidth = 360, dragging = false

  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    const next = Math.min(max, Math.max(min, startWidth + e.clientX - startX))
    document.documentElement.style.setProperty('--panel-width', `${next}px`)
  }
  const onUp = () => {
    dragging = false
    splitter.classList.remove('dragging')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  splitter.addEventListener('mousedown', (e) => {
    startX = e.clientX
    startWidth = panelShell.getBoundingClientRect().width
    dragging = true
    splitter.classList.add('dragging')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  })
}

setupSplitter()

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

const updateNav = (mode: 'editor' | 'player') => {
  if (!navEditor || !navPlayer || !editorView || !playerView) return
  const isEditor = mode === 'editor'
  navEditor.classList.toggle('active', isEditor)
  navPlayer.classList.toggle('active', !isEditor)
  editorView.classList.toggle('hidden', !isEditor)
  playerView.classList.toggle('hidden', isEditor)
  setLandingVisible(false)
  document.body.classList.toggle('mode-editor', isEditor)
  document.body.classList.toggle('mode-player', !isEditor)
  setGameRunning(false)
  if (!isEditor) engine.styleAll()
}

navEditor?.addEventListener('click', () => updateNav('editor'))
navPlayer?.addEventListener('click', () => updateNav('player'))

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

const shuffle = <T,>(arr: T[]) => {
  const c = [...arr]
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[c[i], c[j]] = [c[j], c[i]]
  }
  return c
}

const buildQueue = (
  length: number,
  opts?: { keepLastFailed?: boolean; prioritizeFailed?: boolean; allowRepeats?: boolean }
): string[] => {
  const ids = db.map((r) => r.id)
  if (ids.length === 0) return []
  const keepLF = opts?.keepLastFailed ?? true
  const prioLF = opts?.prioritizeFailed ?? true
  const allowR = opts?.allowRepeats ?? true
  const queue: string[] = []
  if (keepLF && game.lastFailedId && ids.includes(game.lastFailedId) && prioLF)
    queue.push(game.lastFailedId)
  const pool = ids.filter((id) => !queue.includes(id))
  while (queue.length < length && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length)
    queue.push(pool.splice(i, 1)[0])
  }
  if (allowR) {
    while (queue.length < length) queue.push(ids[Math.floor(Math.random() * ids.length)])
  }
  return queue
}

// ---------------------------------------------------------------------------
// Bearing / cardinal direction
// ---------------------------------------------------------------------------

const bearingDegrees = (from: LonLat, to: LonLat) => {
  const toRad = (d: number) => (d * Math.PI) / 180
  const [lon1, lat1] = from.map(toRad)
  const [lon2, lat2] = to.map(toRad)
  const dLon = lon2 - lon1
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const cardinal = (deg: number) => {
  const dirs = ['É', 'ÉK', 'K', 'DK', 'D', 'DNy', 'Ny', 'ÉNy']
  return dirs[Math.round(deg / 45) % 8]
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

const applyHighlight = (activeId?: string) => {
  engine.styleAll(activeId)
  if (game.mode === 'select' && activeId) engine.showPin(activeId, true)
}

const renderOptions = () => {
  if (!optionList) return
  const target = currentTarget()
  if (!target) return
  const options = shuffle([target, ...shuffle(db.filter((r) => r.id !== target.id)).slice(0, 3)])
  optionList.innerHTML = ''
  options.forEach((record) => {
    const btn = document.createElement('button')
    btn.className = 'option-button'
    btn.textContent = displayName(record)
    btn.dataset.id = record.id
    optionList.appendChild(btn)
  })
}

const updateTaskUI = async () => {
  const target = currentTarget()
  if (!taskLabel || !statusExtra) return
  if (!target) { taskLabel.textContent = '-'; return }

  taskLabel.textContent =
    game.mode === 'pins' ? displayName(target) : 'Nevezd meg a kijelölt területet'

  if (game.mode === 'select') {
    statusExtra.textContent = `Streak: ${game.streak} / 7`
    selectMode?.classList.remove('hidden')
    await engine.ensureAllLoaded(db)
    applyHighlight(target.id)
    engine.showPin(target.id, true)
    renderOptions()
  } else {
    const used = 12 - game.attemptsLeft
    statusExtra.textContent = `Lépések: ${used} / 12 · Találat: ${game.found}`
    selectMode?.classList.add('hidden')
    engine.hidePins()
    await engine.ensureAllLoaded(db)
    engine.clearArrow()
  }
}

const startGame = async (mode: GameMode) => {
  if (db.length === 0) { setFeedback('Nincs betöltött adatbázis.', 'bad'); return }
  interactionLocked = false
  game.mode = mode
  updateHudButtons(mode)
  const qs = mode === 'pins' ? Math.min(12, db.length) : 7
  game.queue = buildQueue(qs, {
    keepLastFailed: mode === 'select',
    prioritizeFailed: mode === 'select',
    allowRepeats: db.length < qs,
  })
  game.index = 0
  game.running = true
  game.streak = 0
  game.lastFailedId = null
  game.attemptsLeft = 12
  game.found = 0
  setGameRunning(true)
  engine.clearArrow()
  engine.hidePins()
  engine.clearGuessPin()
  engine.styleAll()
  playSound('start', 0.9)
  setFeedback('Játék indítva.', 'neutral')
  hidePostgame()
  await engine.ensureAllLoaded(db)
  await engine.zoomToAll(datasetCamera)
  await updateTaskUI()
}

// ---------------------------------------------------------------------------
// Game handlers
// ---------------------------------------------------------------------------

const handleSelectCorrect = async () => {
  if (interactionLocked) return
  interactionLocked = true
  game.streak += 1
  const target = currentTarget()
  if (target) await engine.flashRecord(target.id, FLASH_CORRECT, { duration: 1200 })
  playSound('correct')
  if (game.streak >= 7) {
    if (statusExtra) statusExtra.textContent = 'Streak: 7 / 7'
    setFeedback('Szuper! 7 egymás utáni helyes válasz. Játék vége.', 'good')
    game.running = false
    setGameRunning(false)
    playSound('end')
    showPostgame('Gratulálunk!', 'Eredmény: 7/7 helyes sorozat')
    return
  }
  game.index += 1
  if (game.index >= game.queue.length) { game.queue = buildQueue(7); game.index = 0 }
  setFeedback('Helyes!', 'good')
  await updateTaskUI()
  interactionLocked = false
}

const handleSelectIncorrect = async () => {
  const target = currentTarget()
  game.streak = 0
  game.lastFailedId = target?.id ?? null
  game.queue = buildQueue(7, { keepLastFailed: true, prioritizeFailed: false })
  game.index = 0
  if (target) await engine.flashRecord(target.id, FLASH_WRONG, { duration: 1200 })
  playSound('wrong')
  setFeedback(
    target ? `Nem jó. Helyes: ${displayName(target)}. Új feladatsor indul.` : 'Nem jó.',
    'bad'
  )
  await updateTaskUI()
}

const advancePinsQueue = () => {
  game.index += 1
  if (game.index >= game.queue.length) {
    const qs = Math.min(12, db.length)
    game.queue = buildQueue(qs, { allowRepeats: db.length < qs })
    game.index = 0
  }
}

const handlePinsAttempt = async (
  success: boolean,
  distance: number,
  clickPoint: LonLat,
  targetCenter: LonLat | undefined,
  clickedRecordId: string | undefined
) => {
  if (!game.running || interactionLocked) return
  interactionLocked = true
  try {
    const targetId = currentTarget()?.id
    game.attemptsLeft -= 1

    if (targetCenter) {
      const dir = cardinal(bearingDegrees(clickPoint, targetCenter))
      engine.setGuessPin(clickPoint, `${dir} · ${distance.toFixed(1)} km`)
    }

    if (success) {
      engine.clearArrow()
      game.found += 1
      playSound('correct')
      setFeedback('Talált!', 'good')
      if (targetId) await engine.flashRecord(targetId, FLASH_CORRECT, { duration: 1000, restoreHighlight: false })
      advancePinsQueue()
      await updateTaskUI()
    } else {
      playSound('wrong')
      if (targetCenter) {
        engine.showArrow(clickPoint, targetCenter, distance)
        setFeedback(`Mellé. ${distance.toFixed(1)} km · ${cardinal(bearingDegrees(clickPoint, targetCenter))}`, 'bad')
      } else {
        setFeedback('Mellé. Próbáld újra.', 'bad')
      }
      const flashId = clickedRecordId ?? targetId
      if (flashId) await engine.flashRecord(flashId, FLASH_WRONG, { duration: 1000, restoreHighlight: false })
    }

    if (game.attemptsLeft <= 0) {
      game.running = false
      setGameRunning(false)
      setFeedback(`Vége! Találatok: ${game.found} / 12`, game.found >= 6 ? 'good' : 'neutral')
      playSound('end')
      showPostgame(
        game.found >= 9 ? 'Gratulálunk!' : 'Ne add fel! Próbáld újra!',
        `Eredmény: ${game.found} / 12 találat`
      )
      await updateTaskUI()
      return
    }
    await updateTaskUI()
  } finally {
    interactionLocked = false
  }
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

const switchSourceTab = (tabName: string) => {
  document.querySelectorAll<HTMLButtonElement>('.source-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName)
  })
  ;['url', 'file', 'osm'].forEach((name) => {
    const pane = document.getElementById(`tab-${name}`)
    if (pane) pane.classList.toggle('hidden', name !== tabName)
  })
  const addActions = document.querySelector<HTMLDivElement>('.add-actions')
  if (addActions) addActions.classList.toggle('hidden', tabName === 'osm')
}

const resetForm = () => {
  if (recordNameInput)  recordNameInput.value  = ''
  if (recordCustomName) recordCustomName.value  = ''
  if (recordUrl)        recordUrl.value         = ''
  if (recordFile)       recordFile.value        = ''
  if (recordTolerance)  recordTolerance.value   = ''
  editingId = null
  if (addRecordButton) addRecordButton.textContent = 'Hozzáadás'
  cancelEditButton?.classList.add('hidden')
  if (recordFormat) recordFormat.value = 'kml'
  const fileDisplay = document.getElementById('file-name-display')
  if (fileDisplay) fileDisplay.classList.add('hidden')
  const dropZone = document.getElementById('file-drop-zone')
  if (dropZone) dropZone.classList.remove('has-file')
  switchSourceTab('url')
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

landingNew?.addEventListener('click', () => updateNav('editor'))

landingContinueInput?.addEventListener('change', async () => {
  const file = landingContinueInput.files?.[0]
  if (!file) return
  try {
    applyDataset(parseRecords(await file.text()))
    setFeedback('Feladatsor betöltve.', 'good')
    updateNav('editor')
  } catch { setFeedback('Nem sikerült betölteni a feladatsort.', 'bad') }
  finally { landingContinueInput.value = '' }
})

landingPlayInput?.addEventListener('change', async () => {
  const file = landingPlayInput.files?.[0]
  if (!file) return
  try {
    applyDataset(parseRecords(await file.text()))
    updateNav('player')
    await startGame('pins')
  } catch { setFeedback('Nem sikerült betölteni a feladatsort.', 'bad') }
  finally { landingPlayInput.value = '' }
})

landingDemoButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const path = btn.dataset.demo
    if (!path) return
    try {
      const res = await fetch(path)
      if (!res.ok) throw new Error('Failed to load demo')
      applyDataset(parseRecords(await res.text()))
      game.running = false
      setGameRunning(false)
      selectMode?.classList.add('hidden')
      setFeedback('Demo betöltve. Válassz játékmódot!', 'neutral')
      updateNav('player')
    } catch { setFeedback('Nem sikerült betölteni a demót.', 'bad') }
  })
})

gameExitButton?.addEventListener('click', () => {
  game.running = false
  setGameRunning(false)
  hidePostgame()
  engine.clearGuessPin()
  engine.clearArrow()
  engine.hidePins()
  if (feedback) feedback.textContent = ' '
  setLandingVisible(true)
})

hudPinsButton?.addEventListener('click',   () => void startGame('pins'))
hudSelectButton?.addEventListener('click', () => void startGame('select'))

postgameRestart?.addEventListener('click', () => { hidePostgame(); void startGame(game.mode) })
postgameSwitch?.addEventListener('click', () => {
  hidePostgame()
  void startGame(game.mode === 'pins' ? 'select' : 'pins')
})

addRecordButton?.addEventListener('click', async () => {
  const name = recordNameInput?.value.trim() ?? ''
  if (!name) { setFeedback('Adj meg nevet a területhez.', 'bad'); return }

  const customName   = recordCustomName?.value.trim()
  const toleranceRaw = recordTolerance?.value.trim() ?? ''
  const toleranceKm: number | undefined =
    toleranceRaw === '' ? undefined : Number(toleranceRaw)
  const validTol = typeof toleranceKm === 'number' && Number.isFinite(toleranceKm)
    ? toleranceKm : undefined
  const file   = recordFile?.files?.[0]
  const url    = recordUrl?.value.trim()
  const format = (recordFormat?.value as DataFormat) ?? 'kml'
  syncDatasetMeta()

  if (editingId) {
    const record = db.find((r) => r.id === editingId)
    if (!record) { setFeedback('Nem található a módosítandó tétel.', 'bad'); resetForm(); return }
    record.name        = name
    record.customName  = customName
    record.toleranceKm = validTol

    let dataChanged = false
    if (file) {
      const text = await file.text()
      if (format === 'geojson') {
        try { JSON.parse(text) } catch { setFeedback('Érvénytelen GeoJSON.', 'bad'); return }
      }
      record.data = text; record.dataType = 'text'; record.format = format; dataChanged = true
    } else if (url) {
      record.data = url; record.dataType = 'url'; record.format = format; dataChanged = true
    }
    if (dataChanged) { engine.removeRecord(record.id); await engine.loadRecord(record) }
    refreshList()
    setFeedback('Frissítve.', 'good')
    resetForm()
    return
  }

  if (!file && !url) { setFeedback('Adj meg URL-t vagy válassz fájlt.', 'bad'); return }

  let data: string
  let dataType: DataType
  if (file) {
    const text = await file.text()
    if (format === 'geojson') {
      try { JSON.parse(text) } catch { setFeedback('Érvénytelen GeoJSON.', 'bad'); return }
    }
    data = text; dataType = 'text'
  } else {
    data = url!; dataType = 'url'
  }

  const record: AreaRecord = {
    id: createId(), name, customName, toleranceKm: validTol,
    data, dataType, format, aliases: [],
  }
  db.push(record)
  await engine.loadRecord(record, { zoom: true })
  refreshList()
  resetForm()
})

cancelEditButton?.addEventListener('click', () => {
  resetForm()
  setFeedback('Szerkesztés megszakítva.', 'neutral')
})

clearRecordsButton?.addEventListener('click', () => {
  db = []
  datasetTitle = ''
  datasetDescription = ''
  engine.clearRecords()
  editingId = null
  if (datasetTitleInput) datasetTitleInput.value = ''
  if (datasetDescInput)  datasetDescInput.value  = ''
  resetForm()
  refreshList()
  setFeedback('Lista törölve.', 'neutral')
})

recordList?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement
  const action = target?.dataset?.action
  const id     = target?.dataset?.id
  if (!action || !id) return
  const record = db.find((r) => r.id === id)
  if (!record) return

  if (action === 'remove') {
    db = db.filter((r) => r.id !== id)
    engine.removeRecord(id)
    if (editingId === id) resetForm()
    refreshList()
  }
  if (action === 'show') await engine.loadRecord(record, { zoom: true })
  if (action === 'edit') {
    editingId = id
    if (recordNameInput)  recordNameInput.value  = record.name
    if (recordCustomName) recordCustomName.value  = record.customName ?? ''
    if (recordFormat)     recordFormat.value      = record.format
    if (recordTolerance)  recordTolerance.value   = record.toleranceKm?.toString() ?? ''
    if (record.dataType === 'url') {
      switchSourceTab('url')
      if (recordUrl) recordUrl.value = record.data
    } else {
      switchSourceTab('file')
      if (recordUrl)  recordUrl.value  = ''
      if (recordFile) recordFile.value = ''
      const fd = document.getElementById('file-name-display')
      if (fd) { fd.textContent = '📄 (betöltött fájl)'; fd.classList.remove('hidden') }
      const dz = document.getElementById('file-drop-zone')
      if (dz) dz.classList.add('has-file')
    }
    if (addRecordButton) addRecordButton.textContent = 'Mentés'
    cancelEditButton?.classList.remove('hidden')
    setFeedback('Szerkesztés mód: módosítsd és ments.', 'neutral')
  }
})

saveJsonButton?.addEventListener('click', () => {
  syncDatasetMeta()
  const payload: Dataset = {
    title: datasetTitle || undefined,
    description: datasetDescription || undefined,
    camera: engine.getCameraPosition(),
    items: db,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'vilagjaro-db.json'
  link.click()
  URL.revokeObjectURL(link.href)
})

loadJsonInput?.addEventListener('change', async () => {
  const file = loadJsonInput.files?.[0]
  if (!file) return
  try {
    applyDataset(parseRecords(await file.text()))
    setFeedback('JSON betöltve.', 'good')
  } catch { setFeedback('Nem sikerült betölteni a JSON fájlt.', 'bad') }
  finally { loadJsonInput.value = '' }
})

optionList?.addEventListener('click', async (event) => {
  if (!game.running || game.mode !== 'select' || interactionLocked) return
  const target = event.target as HTMLElement
  if (!target?.dataset?.id) return
  const active = currentTarget()
  if (active && target.dataset.id === active.id) await handleSelectCorrect()
  else await handleSelectIncorrect()
})

// ---------------------------------------------------------------------------
// OSM Overpass
// ---------------------------------------------------------------------------

const fetchOverpass = async (query: string) => {
  const controller = new AbortController()
  const tid = window.setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch('/overpass/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(await res.text() || 'Overpass error')
    return await res.json()
  } finally {
    window.clearTimeout(tid)
  }
}

osmImportButton?.addEventListener('click', async () => {
  const relId = Number(osmRelationIdInput?.value)
  if (!relId) { setFeedback('Adj meg egy OSM Relation ID-t.', 'bad'); return }
  try {
    setFeedback('OSM relation lekérdezés...', 'neutral')
    const osmJson = await fetchOverpass(
      `[out:json][timeout:25];(relation(${relId}););out body;>;out skel qt;`
    )
    const geojson = osmtogeojson(osmJson) as GeoJSON.FeatureCollection
    const features = geojson.features.filter((f) => f.geometry)
    if (features.length === 0) { setFeedback('Nincs találat a relation ID-hoz.', 'bad'); return }
    const name = (features[0].properties?.name as string | undefined) ?? `OSM relation ${relId}`
    const record: AreaRecord = {
      id: createId(), name,
      data: JSON.stringify({ type: 'FeatureCollection', features }),
      dataType: 'text', format: 'geojson', aliases: [],
    }
    db.push(record)
    refreshList()
    await engine.loadRecord(record, { zoom: true })
    setFeedback('Relation import kész.', 'good')
  } catch (err) {
    console.error(err)
    setFeedback('OSM relation import sikertelen.', 'bad')
  }
})

// ---------------------------------------------------------------------------
// Source tab switching + file drop
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('.source-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchSourceTab(btn.dataset.tab ?? 'url'))
})

recordFile?.addEventListener('change', () => {
  const file = recordFile.files?.[0]
  const fileDisplay = document.getElementById('file-name-display')
  const dropZone    = document.getElementById('file-drop-zone')
  if (file) {
    if (fileDisplay) { fileDisplay.textContent = `📄 ${file.name}`; fileDisplay.classList.remove('hidden') }
    if (dropZone) dropZone.classList.add('has-file')
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (recordFormat) recordFormat.value = (ext === 'geojson' || ext === 'json') ? 'geojson' : 'kml'
  } else {
    if (fileDisplay) fileDisplay.classList.add('hidden')
    if (dropZone) dropZone.classList.remove('has-file')
  }
})

document.querySelector<HTMLButtonElement>('#editor-play')?.addEventListener(
  'click', () => updateNav('player')
)
