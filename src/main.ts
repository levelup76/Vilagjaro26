import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'
import {
  Ion,
  Viewer,
  KmlDataSource,
  GeoJsonDataSource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian2,
  Cartesian3,
  Cartographic,
  HeightReference,
  Color,
  ConstantProperty,
  ColorMaterialProperty,
  SceneMode,
  UrlTemplateImageryProvider,
  HeadingPitchRange,
  EllipsoidGeodesic,
  PolylineArrowMaterialProperty,
  JulianDate,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  NearFarScalar,
  DistanceDisplayCondition
} from 'cesium'
import type { DataSource, Entity, PolygonHierarchy } from 'cesium'
import osmtogeojson from 'osmtogeojson'

type DataType = 'url' | 'text'
type DataFormat = 'kml' | 'geojson'

type AreaRecord = {
  id: string
  name: string
  customName?: string
  toleranceKm?: number
  data: string
  dataType: DataType
  format: DataFormat
  aliases: string[]
}

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

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN ?? ''

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root not found')

app.innerHTML = `
  <div class="app-shell">
    <section id="landing" class="landing">
      <div class="landing-card">
        <div class="landing-art" aria-hidden="true"></div>
        <div class="landing-copy">
          <p class="eyebrow">Felfedezés • Játék</p>
          <h1>Világjáró</h1>
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
        </div>
      </div>
    </section>
    <header class="top-bar">
      <div class="brand">Világjáró — Cesium KML játék</div>
      <nav class="nav">
        <button id="nav-editor" class="nav-button active">Szerkesztő</button>
        <button id="nav-player" class="nav-button">Lejátszó</button>
      </nav>
    </header>
    <main class="main">
      <section id="panel" class="panel">
        <div id="token-warning" class="warning hidden">
          Hiányzik a VITE_CESIUM_TOKEN. A térkép nem fog betöltődni.
        </div>

        <section id="editor-view" class="view">
          <div class="panel-stack">
            <div class="section-card accent">
              <div class="section-header">
                <div>
                  <p class="eyebrow">Szerkesztő</p>
                  <h2>Építs saját feladatsort</h2>
                  <p class="section-subtitle">Importáld a KML/GeoJSON adatokat URL-ről vagy fájlból. A lista azonnal betöltődik a térképre.</p>
                </div>
                <div class="pill-row">
                  <span class="pill">KML</span>
                  <span class="pill">GeoJSON</span>
                  <span class="pill pill-ghost">Fájl / URL</span>
                </div>
              </div>
              <div class="form-grid two-col">
                <label>
                  Terület neve
                  <input id="record-name" type="text" placeholder="Pl.: Balaton" />
                </label>
                <label>
                  Egyedi név (opcionális)
                  <input id="record-custom-name" type="text" placeholder="Pl.: Balaton (magyar)" />
                </label>
                <label>
                  Adat típusa
                  <select id="record-format">
                    <option value="kml">KML</option>
                    <option value="geojson">GeoJSON</option>
                  </select>
                </label>
                <label>
                  Adat URL
                  <input id="record-url" type="url" placeholder="https://.../area.kml vagy .geojson" />
                </label>
                <label>
                  Adat fájl
                  <input id="record-file" type="file" accept=".kml,.geojson,.json" />
                </label>
                <label>
                  Tolerancia (km)
                  <input id="record-tolerance" type="number" min="1" step="1" placeholder="Alapértelmezés: 50" />
                </label>
              </div>
              <div class="button-row">
                <button id="add-record" class="primary">Hozzáadás</button>
                <button id="clear-records">Lista törlése</button>
              </div>
            </div>

            <div class="section-card">
              <div class="section-header">
                <div>
                  <p class="eyebrow">OSM</p>
                  <h3>Relation import</h3>
                  <p class="section-subtitle">Adj meg egy relation ID-t, azonnal konvertáljuk GeoJSON-ná és betöltjük.</p>
                </div>
                <span class="pill pill-ghost">OSM</span>
              </div>
              <div class="form-grid">
                <label>
                  OSM Relation ID
                  <input id="osm-relation-id" type="number" placeholder="Pl.: 123924" />
                </label>
              </div>
              <div class="button-row">
                <button id="osm-relation-import">Relation import</button>
              </div>
            </div>

            <div class="section-card subtle">
              <div class="section-header">
                <div>
                  <p class="eyebrow">Adatbázis</p>
                  <h3>Feladatok</h3>
                  <p class="section-subtitle">Kattints a megjelenítéshez vagy töröld, ha nem kell. A JSON-t bármikor elmentheted.</p>
                </div>
                <div class="pill pill-ghost"><span id="record-count">0</span> tétel</div>
              </div>
              <ul id="record-list" class="record-list"></ul>
              <div class="button-row">
                <button id="save-json">JSON mentés</button>
                <label class="file-button">
                  JSON betöltés
                  <input id="load-json" type="file" accept="application/json" />
                </label>
              </div>
            </div>
          </div>
        </section>

        <section id="player-view" class="view hidden">
          <div class="player-hud">
            <div>
              <p class="eyebrow">Lejátszó</p>
              <h2>Válassz módot</h2>
            </div>
            <div class="hud-actions">
              <button id="hud-pins" class="hud-button primary">Gombostűk</button>
              <button id="hud-select" class="hud-button">Nevezd meg!</button>
            </div>
          </div>
          <div class="status">
            <div>Feladat: <span id="task-label">-</span></div>
            <div id="status-extra"></div>
            <div id="feedback" class="feedback"> </div>
          </div>
          <div id="select-mode" class="select-mode hidden">
            <h3>Válaszlehetőségek</h3>
            <div id="option-list" class="option-list"></div>
          </div>
        </section>
      </section>
      <section class="map">
        <div id="cesiumContainer"></div>
      </section>
    </main>
  </div>
`

const tokenWarning = document.querySelector<HTMLDivElement>('#token-warning')
if (!Ion.defaultAccessToken) {
  tokenWarning?.classList.remove('hidden')
}

const viewer = new Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  geocoder: false,
  baseLayerPicker: true,
  sceneModePicker: true,
  sceneMode: SceneMode.SCENE2D,
  navigationHelpButton: true,
  infoBox: false,
  selectionIndicator: false
})

viewer.scene.morphTo2D(0)
viewer.scene.screenSpaceCameraController.enableTilt = false

viewer.imageryLayers.removeAll()
viewer.imageryLayers.addImageryProvider(
  new UrlTemplateImageryProvider({
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  })
)

const loadCountryBorders = async () => {
  const url =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'
  try {
    const borders = await GeoJsonDataSource.load(url, {
      stroke: Color.WHITE.withAlpha(0.6),
      fill: Color.TRANSPARENT,
      strokeWidth: 1
    })
    borders.name = 'country-borders'
    borderDataSource = borders
    viewer.dataSources.add(borders)
  } catch {
    setFeedback('Nem sikerült betölteni az országhatárokat.', 'bad')
  }
}

loadCountryBorders()

const navEditor = document.querySelector<HTMLButtonElement>('#nav-editor')
const navPlayer = document.querySelector<HTMLButtonElement>('#nav-player')
const editorView = document.querySelector<HTMLDivElement>('#editor-view')
const playerView = document.querySelector<HTMLDivElement>('#player-view')
const landing = document.querySelector<HTMLDivElement>('#landing')
const landingNew = document.querySelector<HTMLButtonElement>('#landing-new')
const landingContinueInput = document.querySelector<HTMLInputElement>('#landing-continue')
const landingPlayInput = document.querySelector<HTMLInputElement>('#landing-play')

const recordName = document.querySelector<HTMLInputElement>('#record-name')
const recordCustomName = document.querySelector<HTMLInputElement>('#record-custom-name')
const recordFormat = document.querySelector<HTMLSelectElement>('#record-format')
const recordUrl = document.querySelector<HTMLInputElement>('#record-url')
const recordFile = document.querySelector<HTMLInputElement>('#record-file')
const recordTolerance = document.querySelector<HTMLInputElement>('#record-tolerance')
const addRecordButton = document.querySelector<HTMLButtonElement>('#add-record')
const clearRecordsButton = document.querySelector<HTMLButtonElement>('#clear-records')
const recordList = document.querySelector<HTMLUListElement>('#record-list')
const recordCount = document.querySelector<HTMLSpanElement>('#record-count')
const saveJsonButton = document.querySelector<HTMLButtonElement>('#save-json')
const loadJsonInput = document.querySelector<HTMLInputElement>('#load-json')
const osmRelationIdInput = document.querySelector<HTMLInputElement>('#osm-relation-id')
const osmRelationImportButton = document.querySelector<HTMLButtonElement>('#osm-relation-import')

const hudPinsButton = document.querySelector<HTMLButtonElement>('#hud-pins')
const hudSelectButton = document.querySelector<HTMLButtonElement>('#hud-select')
const taskLabel = document.querySelector<HTMLSpanElement>('#task-label')
const feedback = document.querySelector<HTMLDivElement>('#feedback')
const selectMode = document.querySelector<HTMLDivElement>('#select-mode')
const optionList = document.querySelector<HTMLDivElement>('#option-list')
const statusExtra = document.querySelector<HTMLDivElement>('#status-extra')

let db: AreaRecord[] = []
const dataSources = new Map<string, DataSource>()
let borderDataSource: DataSource | null = null
const recordCenters = new Map<string, Cartographic>()
const recordRadii = new Map<string, number>()
let arrowEntity: Entity | null = null
const pinEntities = new Map<string, Entity>()
let guessPin: Entity | null = null

const game: GameState = {
  mode: 'pins',
  queue: [],
  index: 0,
  streak: 0,
  lastFailedId: null,
  running: false,
  attemptsLeft: 12,
  found: 0
}

const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

const postgame = document.createElement('div')
postgame.className = 'postgame hidden'
postgame.innerHTML = `
  <button id="postgame-restart" class="primary">Ugyanez újra</button>
  <button id="postgame-switch">Módváltás</button>
`
app.appendChild(postgame)

const postgameRestart = postgame.querySelector<HTMLButtonElement>('#postgame-restart')
const postgameSwitch = postgame.querySelector<HTMLButtonElement>('#postgame-switch')

const hidePostgame = () => postgame.classList.add('hidden')
const showPostgame = () => postgame.classList.remove('hidden')


const updateNav = (mode: 'editor' | 'player') => {
  if (!navEditor || !navPlayer || !editorView || !playerView) return
  const isEditor = mode === 'editor'
  navEditor.classList.toggle('active', isEditor)
  navPlayer.classList.toggle('active', !isEditor)
  editorView.classList.toggle('hidden', !isEditor)
  playerView.classList.toggle('hidden', isEditor)
  landing?.classList.add('hidden')
}

const refreshList = () => {
  if (!recordList) return
  if (recordCount) recordCount.textContent = String(db.length)
  recordList.innerHTML = ''
  db.forEach((record) => {
    const shownName = displayName(record)
    const subtitleParts = [record.format.toUpperCase(), record.dataType === 'url' ? 'URL' : 'Fájl']
    if (record.toleranceKm) subtitleParts.push(`${record.toleranceKm} km`)
    const item = document.createElement('li')
    item.className = 'record-item'
    item.innerHTML = `
      <div>
        <strong>${shownName}</strong>
        <small>${subtitleParts.join(' · ')}</small>
      </div>
      <div class="record-actions">
        <button data-action="show" data-id="${record.id}">Megjelenítés</button>
        <button data-action="remove" data-id="${record.id}">Törlés</button>
      </div>
    `
    recordList.appendChild(item)
  })
}

const createId = () => crypto.randomUUID()

const parseRecords = (text: string) => {
  const parsed = JSON.parse(text) as Array<Partial<AreaRecord> & { kml?: string; kmlType?: DataType }>
  if (!Array.isArray(parsed)) throw new Error('Invalid JSON')
  return parsed
    .map((item) => {
      const data = item.data ?? item.kml ?? ''
      const dataType =
        item.dataType ??
        item.kmlType ??
        (/^https?:\/\//.test(data) ? 'url' : 'text')
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
        aliases: Array.isArray(item.aliases) ? item.aliases : []
      } as AreaRecord
    })
    .filter((item) => item.name && item.data)
}

const applyRecords = (records: AreaRecord[]) => {
  db = records
  resetDataSources()
  dataSources.clear()
  recordCenters.clear()
  refreshList()
}

const computeCenter = (dataSource: DataSource, recordId: string) => {
  const positions: Cartesian3[] = []
  dataSource.entities.values.forEach((entity) => {
    if (entity.polygon?.hierarchy) {
      const hierarchy = entity.polygon.hierarchy.getValue(JulianDate.now()) as
        | PolygonHierarchy
        | undefined
      if (hierarchy) {
        const collect = (h: PolygonHierarchy) => {
          positions.push(...h.positions)
          h.holes?.forEach(collect)
        }
        collect(hierarchy)
      }
    }
    if (entity.polyline?.positions) {
      const polyPositions = entity.polyline.positions.getValue(JulianDate.now()) as
        | Cartesian3[]
        | undefined
      if (polyPositions) positions.push(...polyPositions)
    }
    if (entity.position) {
      const pos = entity.position.getValue(JulianDate.now()) as Cartesian3 | undefined
      if (pos) positions.push(pos)
    }
  })
  if (positions.length === 0) return
  const center = positions.reduce(
    (acc, p) => new Cartesian3(acc.x + p.x, acc.y + p.y, acc.z + p.z),
    new Cartesian3(0, 0, 0)
  )
  center.x /= positions.length
  center.y /= positions.length
  center.z /= positions.length
  const cartoCenter = Cartographic.fromCartesian(center)
  recordCenters.set(recordId, cartoCenter)

  let maxRadius = 0
  positions.forEach((pos) => {
    const carto = Cartographic.fromCartesian(pos)
    const dist = new EllipsoidGeodesic(cartoCenter, carto).surfaceDistance
    if (dist > maxRadius) maxRadius = dist
  })
  recordRadii.set(recordId, maxRadius)
}

const loadDataSource = async (record: AreaRecord, options?: { replace?: boolean; zoom?: boolean }) => {
  if (options?.replace) {
    resetDataSources()
    dataSources.clear()
    recordCenters.clear()
    recordRadii.clear()
  }

  if (dataSources.has(record.id)) {
    const existing = dataSources.get(record.id)
    if (options?.zoom && existing) {
      await viewer.flyTo(existing)
    }
    return
  }

  const payload = record.dataType === 'url' ? record.data : record.data
  const dataSource =
    record.format === 'geojson'
      ? await GeoJsonDataSource.load(
          record.dataType === 'text' ? JSON.parse(payload) : payload,
          { clampToGround: false }
        )
      : await KmlDataSource.load(payload, {
          camera: viewer.scene.camera,
          canvas: viewer.scene.canvas
        })

  dataSource.name = record.name
  dataSource.entities.values.forEach((entity) => {
    ;(entity as { recordId?: string }).recordId = record.id
    if (entity.label) {
      entity.label.show = new ConstantProperty(false)
    }
    if (entity.billboard) {
      entity.billboard.show = new ConstantProperty(false)
    }
    if (entity.point) {
      entity.point.show = new ConstantProperty(false)
    }
    if (entity.polygon) {
      entity.polygon.height = new ConstantProperty(0)
      entity.polygon.heightReference = new ConstantProperty(HeightReference.NONE)
    }
    if (entity.polyline) {
      entity.polyline.clampToGround = new ConstantProperty(false)
    }
  })

  viewer.dataSources.add(dataSource)
  dataSources.set(record.id, dataSource)
  computeCenter(dataSource, record.id)

  if (options?.zoom) {
    await viewer.flyTo(dataSource)
  }
}

const ensureAllLoaded = async () => {
  for (const record of db) {
    await loadDataSource(record)
  }
}

const resetDataSources = () => {
  viewer.dataSources.removeAll()
  if (borderDataSource) {
    viewer.dataSources.add(borderDataSource)
  }
  recordCenters.clear()
  recordRadii.clear()
  pinEntities.forEach((entity) => viewer.entities.remove(entity))
  pinEntities.clear()
  if (guessPin) {
    viewer.entities.remove(guessPin)
    guessPin = null
  }
}

const buildQueue = (length: number, keepLastFailed = true) => {
  const ids = db.map((record) => record.id)
  if (ids.length === 0) return []
  const queue: string[] = []
  if (keepLastFailed && game.lastFailedId && ids.includes(game.lastFailedId)) {
    queue.push(game.lastFailedId)
  }
  const pool = ids.filter((id) => !queue.includes(id))
  while (queue.length < length && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length)
    queue.push(pool.splice(index, 1)[0])
  }
  while (queue.length < length && ids.length > 0) {
    const index = Math.floor(Math.random() * ids.length)
    queue.push(ids[index])
  }
  return queue
}

const currentTarget = () => db.find((record) => record.id === game.queue[game.index])

const setFeedback = (message: string, variant: 'good' | 'bad' | 'neutral' = 'neutral') => {
  if (!feedback) return
  feedback.textContent = message
  feedback.className = `feedback ${variant}`
}

const updateHudButtons = (mode: GameMode) => {
  hudPinsButton?.classList.toggle('primary', mode === 'pins')
  hudSelectButton?.classList.toggle('primary', mode === 'select')
}

updateHudButtons(game.mode)

const displayName = (record: AreaRecord) => record.customName?.trim() || record.name

const getToleranceKm = (record: AreaRecord) => record.toleranceKm && record.toleranceKm > 0
  ? record.toleranceKm
  : 50

const updateTaskUI = async () => {
  const target = currentTarget()
  if (!taskLabel || !statusExtra) return
  if (!target) {
    taskLabel.textContent = '-'
    return
  }
  taskLabel.textContent = game.mode === 'pins' ? displayName(target) : 'Nevezd meg a kijelölt területet'

  if (game.mode === 'select') {
    statusExtra.textContent = `Streak: ${game.streak} / 7`
    selectMode?.classList.remove('hidden')
    await loadSetSources()
    applyHighlight(target.id)
    showPin(target.id, true)
    renderOptions()
  } else {
    const used = 12 - game.attemptsLeft
    statusExtra.textContent = `Lépések: ${used} / 12 · Találat: ${game.found}`
    selectMode?.classList.add('hidden')
    hidePins()
    await ensureAllLoaded()
    clearArrow()
  }
}

const startGame = async (mode: GameMode) => {
  if (db.length === 0) {
    setFeedback('Nincs betöltött adatbázis.', 'bad')
    return
  }
  game.mode = mode
  updateHudButtons(mode)
  game.queue = buildQueue(mode === 'pins' ? Math.min(12, db.length) : 7, mode === 'select')
  game.index = 0
  game.running = true
  game.streak = 0
  game.lastFailedId = null
  game.attemptsLeft = 12
  game.found = 0
  clearArrow()
  hidePins()
  clearGuessPin()
  setFeedback('Játék indítva.', 'neutral')
  hidePostgame()
  await updateTaskUI()
}

const handleSelectCorrect = async () => {
  game.streak += 1
  flashActive(Color.LIME)
  playTone(880)
  if (game.streak >= 7) {
    setFeedback('Szuper! 7 egymás utáni helyes válasz. Játék vége.', 'good')
    game.running = false
    showPostgame()
    return
  }
  game.index += 1
  if (game.index >= game.queue.length) {
    game.queue = buildQueue(7)
    game.index = 0
  }
  setFeedback('Helyes!', 'good')
  await updateTaskUI()
}

const handleSelectIncorrect = async () => {
  const target = currentTarget()
  game.streak = 0
  game.lastFailedId = target?.id ?? null
  game.queue = buildQueue(7)
  game.index = 0
  flashActive(Color.RED)
  playTone(220)
  if (target) {
    setFeedback(`Nem jó. Helyes: ${displayName(target)}. Új feladatsor indul.`, 'bad')
  } else {
    setFeedback('Nem jó. Új feladatsor indul.', 'bad')
  }
  await updateTaskUI()
}

const advancePinsQueue = () => {
  game.index += 1
  if (game.index >= game.queue.length) {
    game.queue = buildQueue(Math.min(12, db.length), false)
    game.index = 0
  }
}

const handlePinsAttempt = async (
  success: boolean,
  distance?: number,
  clickPoint?: Cartographic,
  targetPoint?: Cartographic
) => {
  if (!game.running) return
  game.attemptsLeft -= 1
  if (clickPoint && targetPoint && typeof distance === 'number') {
    const brng = bearingDegrees(clickPoint, targetPoint)
    const dir = cardinal(brng)
    setGuessPin(clickPoint, `${dir} · ${distance.toFixed(1)} km`)
  }

  if (success) {
    clearArrow()
    game.found += 1
    playTone(880)
    setFeedback('Talált!', 'good')
    advancePinsQueue()
  } else {
    playTone(220)
    if (clickPoint && targetPoint && typeof distance === 'number') {
      showArrow(clickPoint, targetPoint, distance)
      const brng = bearingDegrees(clickPoint, targetPoint)
      const dir = cardinal(brng)
      setFeedback(`Mellé. ${distance.toFixed(1)} km · ${dir}`, 'bad')
    } else {
      setFeedback('Mellé. Próbáld újra.', 'bad')
    }
  }

  if (game.attemptsLeft <= 0) {
    game.running = false
    setFeedback(`Vége! Találatok: ${game.found} / 12`, game.found >= 6 ? 'good' : 'neutral')
    showPostgame()
    await updateTaskUI()
    return
  }

  if (success) {
    await updateTaskUI()
  } else {
    // Stay on the same target; only refresh counters/status text
    if (statusExtra) {
      const used = 12 - game.attemptsLeft
      statusExtra.textContent = `Lépések: ${used} / 12 · Találat: ${game.found}`
    }
  }
}

const applyHighlight = (activeId: string) => {
  dataSources.forEach((source, id) => {
    const isActive = id === activeId
    source.entities.values.forEach((entity) => {
      if (entity.polygon) {
        entity.polygon.outline = new ConstantProperty(true)
        entity.polygon.outlineColor = new ConstantProperty(
          isActive ? Color.YELLOW : Color.WHITE.withAlpha(0.8)
        )
        entity.polygon.material = new ColorMaterialProperty(
          (isActive ? Color.YELLOW : Color.CYAN).withAlpha(isActive ? 0.45 : 0.2)
        )
      }
      if (entity.polyline) {
        entity.polyline.material = new ColorMaterialProperty(
          isActive ? Color.YELLOW : Color.CYAN.withAlpha(0.9)
        )
        entity.polyline.width = new ConstantProperty(isActive ? 4 : 2.5)
      }
    })
  })
  if (game.mode === 'select') {
    showPin(activeId, true)
  }
}

const flashActive = (color: Color) => {
  const target = currentTarget()
  if (!target) return
  const source = dataSources.get(target.id)
  if (!source) return
  source.entities.values.forEach((entity) => {
    if (entity.polygon) {
      entity.polygon.material = new ColorMaterialProperty(color.withAlpha(0.6))
      entity.polygon.outlineColor = new ConstantProperty(color)
    }
    if (entity.polyline) {
      entity.polyline.material = new ColorMaterialProperty(color)
    }
  })
  window.setTimeout(() => applyHighlight(target.id), 350)
}

const getCenter = (id: string) => {
  if (recordCenters.has(id)) return recordCenters.get(id)!
  const source = dataSources.get(id)
  if (!source) return null
  computeCenter(source, id)
  return recordCenters.get(id) ?? null
}

const metersPerPixelAtCenter = () => {
  const canvas = viewer.scene.canvas
  const centerPx = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
  const rightPx = new Cartesian2(centerPx.x + 1, centerPx.y)
  const p1 = viewer.camera.pickEllipsoid(centerPx, viewer.scene.globe.ellipsoid)
  const p2 = viewer.camera.pickEllipsoid(rightPx, viewer.scene.globe.ellipsoid)
  if (!p1 || !p2) return null
  return Cartesian3.distance(p1, p2)
}

const ensureMinPixelSize = (recordId: string) => {
  const center = getCenter(recordId)
  const radius = recordRadii.get(recordId)
  if (!center || !radius) return
  const desiredPx = 50
  const desiredMpp = (2 * radius) / desiredPx
  const mpp = metersPerPixelAtCenter()
  if (mpp !== null && mpp > desiredMpp) {
    const factor = desiredMpp / mpp
    const currentHeight = viewer.camera.positionCartographic?.height ?? 350000
    const newHeight = Math.max(currentHeight * factor, 5000)
    viewer.camera.setView({
      destination: Cartesian3.fromRadians(center.longitude, center.latitude, newHeight)
    })
  }
}

const distanceKm = (a: Cartographic, b: Cartographic) =>
  new EllipsoidGeodesic(a, b).surfaceDistance / 1000

const clearArrow = () => {
  if (arrowEntity) {
    viewer.entities.remove(arrowEntity)
    arrowEntity = null
  }
}

const ensurePin = (recordId: string) => {
  if (pinEntities.has(recordId)) return pinEntities.get(recordId)!
  const center = getCenter(recordId)
  if (!center) return null
  const pinSvg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse"><stop stop-color="#5ad7ff"/><stop offset="1" stop-color="#ff8adf"/></linearGradient></defs><path d="M18 47c7-11 14-17.2 14-27A14 14 0 1 0 4 20c0 9.8 7 16 14 27Z" fill="url(#g1)"/><circle cx="18" cy="18" r="6" fill="#0f172a" fill-opacity="0.82"/></svg>`)
  const entity = viewer.entities.add({
    position: Cartesian3.fromRadians(center.longitude, center.latitude, center.height ?? 0),
    billboard: {
      image: `data:image/svg+xml,${pinSvg}`,
      width: 28,
      height: 36,
      verticalOrigin: VerticalOrigin.BOTTOM,
      scaleByDistance: new NearFarScalar(1000.0, 1.2, 2000000.0, 0.5),
      distanceDisplayCondition: new DistanceDisplayCondition(0.0, 5000000.0),
      show: new ConstantProperty(false)
    }
  }) as Entity
  pinEntities.set(recordId, entity)
  return entity
}

const showPin = (recordId: string, visible: boolean) => {
  const pin = ensurePin(recordId)
  if (pin?.billboard) pin.billboard.show = new ConstantProperty(visible)
}

const showArrow = (from: Cartographic, to: Cartographic, distanceKm: number) => {
  clearArrow()
  const positions = Cartesian3.fromRadiansArray([from.longitude, from.latitude, to.longitude, to.latitude])
  const labelPosition = Cartesian3.fromRadians(
    (from.longitude + to.longitude) / 2,
    (from.latitude + to.latitude) / 2,
    0
  )
  arrowEntity = viewer.entities.add({
    polyline: {
      positions,
      width: 5,
      material: new PolylineArrowMaterialProperty(Color.fromCssColorString('#f97316'))
    },
    label: {
      text: `${distanceKm.toFixed(1)} km`,
      font: '16px Inter',
      fillColor: Color.fromCssColorString('#0f172a'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      pixelOffset: new Cartesian2(0, -12),
      style: LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString('#ffffff').withAlpha(0.9),
      backgroundPadding: new Cartesian2(8, 6),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER
    },
    position: labelPosition
  }) as Entity
}

const hidePins = () => {
  pinEntities.forEach((entity) => {
    if (entity.billboard) entity.billboard.show = new ConstantProperty(false)
  })
}

const clearGuessPin = () => {
  if (guessPin) {
    viewer.entities.remove(guessPin)
    guessPin = null
  }
}

const setGuessPin = (position: Cartographic, text: string) => {
  const pinSvg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse"><stop stop-color="#ffcc70"/><stop offset="1" stop-color="#ff8adf"/></linearGradient></defs><path d="M18 47c7-11 14-17.2 14-27A14 14 0 1 0 4 20c0 9.8 7 16 14 27Z" fill="url(#g1)"/><circle cx="18" cy="18" r="6" fill="#0f172a" fill-opacity="0.82"/></svg>`)
  const cartesian = Cartesian3.fromRadians(position.longitude, position.latitude, position.height ?? 0)
  clearGuessPin()
  guessPin = viewer.entities.add({
    position: cartesian,
    billboard: {
      image: `data:image/svg+xml,${pinSvg}`,
      width: 28,
      height: 36,
      verticalOrigin: VerticalOrigin.BOTTOM,
      scaleByDistance: new NearFarScalar(500.0, 1.3, 1500000.0, 0.6)
    },
    label: {
      text,
      font: '15px Inter',
      fillColor: Color.fromCssColorString('#0f172a'),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      pixelOffset: new Cartesian2(0, -40),
      style: LabelStyle.FILL_AND_OUTLINE,
      showBackground: true,
      backgroundColor: Color.fromCssColorString('#ffffff').withAlpha(0.92),
      backgroundPadding: new Cartesian2(10, 6),
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER
    }
  }) as Entity
}

const playTone = (frequency: number, duration = 160) => {
  const AudioCtx = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  const audioContext = new AudioCtx()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.value = 0.08
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + duration / 1000)
}

const bearingDegrees = (from: Cartographic, to: Cartographic) => {
  const dLon = to.longitude - from.longitude
  const y = Math.sin(dLon) * Math.cos(to.latitude)
  const x =
    Math.cos(from.latitude) * Math.sin(to.latitude) -
    Math.sin(from.latitude) * Math.cos(to.latitude) * Math.cos(dLon)
  const brng = (Math.atan2(y, x) * 180) / Math.PI
  return (brng + 360) % 360
}

const cardinal = (deg: number) => {
  const dirs = ['É', 'ÉK', 'K', 'DK', 'D', 'DNy', 'Ny', 'ÉNy']
  const index = Math.round(deg / 45) % 8
  return dirs[index]
}

const zoomToActiveTarget = async () => {
  const target = currentTarget()
  if (!target) return
  const source = dataSources.get(target.id)
  if (!source) return
  try {
    const currentHeight = viewer.camera.positionCartographic?.height ?? 350000
    const offset = new HeadingPitchRange(0, -Math.PI / 2, currentHeight)
    await viewer.flyTo(source, { duration: 0.6, offset })
    ensureMinPixelSize(target.id)
  } catch {
    // ignore zoom errors
  }
}

const loadSetSources = async () => {
  resetDataSources()
  dataSources.clear()
  const ids = game.queue
  for (const id of ids) {
    const record = db.find((item) => item.id === id)
    if (record) {
      await loadDataSource(record)
    }
  }
  await zoomToActiveTarget()
}

const shuffle = <T,>(items: T[]) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const renderOptions = () => {
  if (!optionList) return
  const queueIds = new Set(game.queue)
  const queueRecords = db.filter((record) => queueIds.has(record.id))
  const distractors = db.filter((record) => !queueIds.has(record.id))
  const extra = shuffle(distractors).slice(0, 5)
  const options = shuffle([...queueRecords, ...extra])

  optionList.innerHTML = ''
  options.forEach((record) => {
    const button = document.createElement('button')
    button.className = 'option-button'
    button.textContent = displayName(record)
    button.dataset.id = record.id
    optionList.appendChild(button)
  })
}

handler.setInputAction(async (movement: { position: Cartesian2 }) => {
  if (!game.running) return
  if (game.mode === 'pins') {
    const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid)
    if (!cartesian) {
      setFeedback('Nem sikerült pozíciót olvasni.', 'bad')
      return
    }
    const clickPoint = Cartographic.fromCartesian(cartesian)
    clearGuessPin()
    const target = currentTarget()
    if (!target) return
    const center = getCenter(target.id)
    if (!center) {
      setFeedback('Nincs középpont ehhez az alakzathoz.', 'bad')
      return
    }
    const dist = distanceKm(clickPoint, center)
    const tolerance = getToleranceKm(target)
    const success = dist <= tolerance
    await handlePinsAttempt(success, dist, clickPoint, center)
    return
  }
}, ScreenSpaceEventType.LEFT_CLICK)

navEditor?.addEventListener('click', () => updateNav('editor'))
navPlayer?.addEventListener('click', () => updateNav('player'))

landingNew?.addEventListener('click', () => updateNav('editor'))

landingContinueInput?.addEventListener('change', async () => {
  const file = landingContinueInput.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const records = parseRecords(text)
    applyRecords(records)
    setFeedback('Feladatsor betöltve.', 'good')
    updateNav('editor')
  } catch {
    setFeedback('Nem sikerült betölteni a feladatsort.', 'bad')
  } finally {
    landingContinueInput.value = ''
  }
})

landingPlayInput?.addEventListener('change', async () => {
  const file = landingPlayInput.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const records = parseRecords(text)
    applyRecords(records)
    setFeedback('Feladatsor betöltve. Indul a Gombostűk mód!', 'good')
    updateNav('player')
    await startGame('pins')
  } catch {
    setFeedback('Nem sikerült betölteni a feladatsort.', 'bad')
  } finally {
    landingPlayInput.value = ''
  }
})

hudPinsButton?.addEventListener('click', () => startGame('pins'))
hudSelectButton?.addEventListener('click', () => startGame('select'))

postgameRestart?.addEventListener('click', () => {
  hidePostgame()
  startGame(game.mode)
})

postgameSwitch?.addEventListener('click', () => {
  hidePostgame()
  const nextMode = game.mode === 'pins' ? 'select' : 'pins'
  startGame(nextMode)
})

addRecordButton?.addEventListener('click', async () => {
  const name = recordName?.value.trim() ?? ''
  if (!name) {
    setFeedback('Adj meg nevet a területhez.', 'bad')
    return
  }

  const customName = recordCustomName?.value.trim()
  const toleranceValue = Number(recordTolerance?.value)
  const toleranceKm = Number.isFinite(toleranceValue) && toleranceValue > 0 ? toleranceValue : undefined

  const file = recordFile?.files?.[0]
  const url = recordUrl?.value.trim()
  const format = (recordFormat?.value as DataFormat) ?? 'kml'

  if (!file && !url) {
    setFeedback('Adj meg URL-t vagy válassz fájlt.', 'bad')
    return
  }

  let record: AreaRecord
  if (file) {
    const text = await file.text()
    if (format === 'geojson') {
      try {
        JSON.parse(text)
      } catch {
        setFeedback('Érvénytelen GeoJSON fájl.', 'bad')
        return
      }
    }
    record = {
      id: createId(),
      name,
      customName,
      toleranceKm,
      data: text,
      dataType: 'text',
      format,
      aliases: []
    }
  } else {
    record = {
      id: createId(),
      name,
      customName,
      toleranceKm,
      data: url!,
      dataType: 'url',
      format,
      aliases: []
    }
  }

  db.push(record)
  await loadDataSource(record, { zoom: true })
  refreshList()

  if (recordName) recordName.value = ''
  if (recordCustomName) recordCustomName.value = ''
  if (recordUrl) recordUrl.value = ''
  if (recordFile) recordFile.value = ''
  if (recordTolerance) recordTolerance.value = ''
})

clearRecordsButton?.addEventListener('click', () => {
  db = []
  resetDataSources()
  dataSources.clear()
  recordCenters.clear()
  recordRadii.clear()
  pinEntities.forEach((entity) => viewer.entities.remove(entity))
  pinEntities.clear()
  clearGuessPin()
  refreshList()
  setFeedback('Lista törölve.', 'neutral')
})

recordList?.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement
  if (!target?.dataset?.action) return
  const action = target.dataset.action
  const id = target.dataset.id
  if (!id) return
  const record = db.find((item) => item.id === id)
  if (!record) return

  if (action === 'remove') {
    db = db.filter((item) => item.id !== id)
    const source = dataSources.get(id)
    if (source) viewer.dataSources.remove(source)
    dataSources.delete(id)
    recordCenters.delete(id)
    recordRadii.delete(id)
    const pin = pinEntities.get(id)
    if (pin) viewer.entities.remove(pin)
    pinEntities.delete(id)
    refreshList()
  }

  if (action === 'show') {
    await loadDataSource(record, { zoom: true })
  }
})

saveJsonButton?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
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
    const text = await file.text()
    const records = parseRecords(text)
    applyRecords(records)
    setFeedback('JSON betöltve.', 'good')
  } catch {
    setFeedback('Nem sikerült betölteni a JSON fájlt.', 'bad')
  } finally {
    loadJsonInput.value = ''
  }
})

optionList?.addEventListener('click', async (event) => {
  if (!game.running || game.mode !== 'select') return
  const target = event.target as HTMLElement
  if (!target?.dataset?.id) return
  const selectedId = target.dataset.id
  const active = currentTarget()
  if (active && selectedId === active.id) {
    await handleSelectCorrect()
  } else {
    await handleSelectIncorrect()
  }
})

const fetchOverpass = async (query: string) => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch('/overpass/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || 'Overpass error')
    }
    return await response.json()
  } finally {
    window.clearTimeout(timeoutId)
  }
}

osmRelationImportButton?.addEventListener('click', async () => {
  const relationId = Number(osmRelationIdInput?.value)
  if (!relationId) {
    setFeedback('Adj meg egy OSM Relation ID-t.', 'bad')
    return
  }

  try {
    setFeedback('OSM relation lekérdezés...', 'neutral')
    const query = `[out:json][timeout:25];(relation(${relationId}););out body;>;out skel qt;`
    const osmJson = await fetchOverpass(query)
    const geojson = osmtogeojson(osmJson) as GeoJSON.FeatureCollection
    const features = geojson.features.filter((feature) => feature.geometry)

    if (features.length === 0) {
      setFeedback('Nincs találat a relation ID-hoz.', 'bad')
      return
    }

    const name =
      (features[0].properties?.name as string | undefined) ??
      `OSM relation ${relationId}`
    const record: AreaRecord = {
      id: createId(),
      name,
      data: JSON.stringify({ type: 'FeatureCollection', features }),
      dataType: 'text',
      format: 'geojson',
      aliases: []
    }

    db.push(record)
    refreshList()
    await loadDataSource(record, { zoom: true })
    setFeedback('Relation import kész.', 'good')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OSM relation import sikertelen.'
    setFeedback('OSM relation import sikertelen.', 'bad')
    console.error(message)
  }
})
