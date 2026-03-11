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
  CallbackProperty,
  SceneMode,
  UrlTemplateImageryProvider,
  HeadingPitchRange,
  BoundingSphere,
  EllipsoidGeodesic,
  PolylineArrowMaterialProperty,
  JulianDate,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  NearFarScalar,
  DistanceDisplayCondition,
  DataSource,
  Entity,
  PolygonHierarchy
} from 'cesium'
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

type DataFormat = 'kml' | 'geojson'
type DataType = 'text' | 'url'

type DatasetCamera = {
  longitude: number
  latitude: number
  height: number
}

type AreaRecord = {
  id: string
  name: string
  customName?: string
  aliases: string[]
  toleranceKm?: number
  data: string
  dataType: DataType
  format: DataFormat
}

type Dataset = {
  title?: string
  description?: string
  camera?: DatasetCamera
  items: AreaRecord[]
}

const POLYGON_FILL_ALPHA = 0.3
const ACTIVE_POLYGON_FILL_ALPHA = 0.7
const POLYGON_OUTLINE_ALPHA = 0.7
const POLYLINE_ALPHA = 0.7
const ACTIVE_FILL = Color.ORANGE
const INACTIVE_FILL = Color.CYAN
const ACTIVE_OUTLINE = Color.YELLOW
const INACTIVE_OUTLINE = Color.WHITE
const POLYLINE_ACTIVE = Color.YELLOW
const POLYLINE_INACTIVE = Color.CYAN

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN ?? ''

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
      <div class="brand">Világjáró — Cesium KML játék</div>
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
                <button id="cancel-edit" class="hidden">Mégse</button>
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
              <div class="dataset-meta">
                <label>
                  Feladatsor címe
                  <input id="dataset-title" type="text" placeholder="Pl.: Európa fővárosai" />
                </label>
                <label>
                  Feladatsor leírása
                  <textarea id="dataset-description" rows="2" placeholder="Pl.: Európai fővárosok gyakorló csomag"></textarea>
                </label>
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
          <div id="select-mode" class="select-mode hidden">
            <h3>Válaszlehetőségek</h3>
            <div id="option-list" class="option-list"></div>
          </div>
        </section>
      </section>
      <div id="splitter" class="splitter" role="separator" aria-label="Panel átméretezése"></div>
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
viewer.scene.screenSpaceCameraController.minimumPitch = -Math.PI / 2
viewer.scene.screenSpaceCameraController.maximumPitch = -Math.PI / 2

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

const navEditor = document.querySelector<HTMLButtonElement>('#nav-editor')
const navPlayer = document.querySelector<HTMLButtonElement>('#nav-player')
const editorView = document.querySelector<HTMLDivElement>('#editor-view')
const playerView = document.querySelector<HTMLDivElement>('#player-view')
const landing = document.querySelector<HTMLDivElement>('#landing')
const setLandingVisible = (visible: boolean) => {
  landing?.classList.toggle('hidden', !visible)
  document.body.classList.toggle('landing-open', visible)
}

setLandingVisible(true)

const landingNew = document.querySelector<HTMLButtonElement>('#landing-new')
const landingContinueInput = document.querySelector<HTMLInputElement>('#landing-continue')
const landingPlayInput = document.querySelector<HTMLInputElement>('#landing-play')
const landingDemoButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.landing-demo')
)

const recordName = document.querySelector<HTMLInputElement>('#record-name')
const recordCustomName = document.querySelector<HTMLInputElement>('#record-custom-name')
const datasetTitleInput = document.querySelector<HTMLInputElement>('#dataset-title')
const datasetDescriptionInput = document.querySelector<HTMLTextAreaElement>('#dataset-description')
const recordFormat = document.querySelector<HTMLSelectElement>('#record-format')
const recordUrl = document.querySelector<HTMLInputElement>('#record-url')
const recordFile = document.querySelector<HTMLInputElement>('#record-file')
const recordTolerance = document.querySelector<HTMLInputElement>('#record-tolerance')
const addRecordButton = document.querySelector<HTMLButtonElement>('#add-record')
const cancelEditButton = document.querySelector<HTMLButtonElement>('#cancel-edit')
const clearRecordsButton = document.querySelector<HTMLButtonElement>('#clear-records')
const recordList = document.querySelector<HTMLUListElement>('#record-list')
const recordCount = document.querySelector<HTMLSpanElement>('#record-count')
const saveJsonButton = document.querySelector<HTMLButtonElement>('#save-json')
const loadJsonInput = document.querySelector<HTMLInputElement>('#load-json')
const osmRelationIdInput = document.querySelector<HTMLInputElement>('#osm-relation-id')
const osmRelationImportButton = document.querySelector<HTMLButtonElement>('#osm-relation-import')
const splitter = document.querySelector<HTMLDivElement>('#splitter')
const panelShell = document.querySelector<HTMLElement>('#panel')

const hudPinsButton = document.querySelector<HTMLButtonElement>('#hud-pins')
const hudSelectButton = document.querySelector<HTMLButtonElement>('#hud-select')
const gameExitButton = document.querySelector<HTMLButtonElement>('#game-exit')
const taskLabel = document.querySelector<HTMLSpanElement>('#task-label')
const feedback = document.querySelector<HTMLDivElement>('#feedback')
const selectMode = document.querySelector<HTMLDivElement>('#select-mode')
const optionList = document.querySelector<HTMLDivElement>('#option-list')
const statusExtra = document.querySelector<HTMLDivElement>('#status-extra')

let db: AreaRecord[] = []
let datasetTitle = ''
let datasetDescription = ''
let datasetCamera: DatasetCamera | undefined
let editingId: string | null = null
const dataSources = new Map<string, DataSource>()
let borderDataSource: DataSource | null = null
const recordCenters = new Map<string, Cartographic>()
const recordRadii = new Map<string, number>()
let arrowEntity: Entity | null = null
const pinEntities = new Map<string, Entity>()
let guessPin: Entity | null = null
let interactionLocked = false

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

const postgameTitle = postgame.querySelector<HTMLHeadingElement>('#postgame-title')
const postgameResult = postgame.querySelector<HTMLParagraphElement>('#postgame-result')
const postgameRestart = postgame.querySelector<HTMLButtonElement>('#postgame-restart')
const postgameSwitch = postgame.querySelector<HTMLButtonElement>('#postgame-switch')

const setPostgameVisible = (visible: boolean) => {
  document.body.classList.toggle('postgame-visible', visible)
}

const hidePostgame = () => {
  postgame.classList.add('hidden')
  setPostgameVisible(false)
}

const showPostgame = (title: string, result: string) => {
  if (postgameTitle) postgameTitle.textContent = title
  if (postgameResult) postgameResult.textContent = result
  postgame.classList.remove('hidden')
  setPostgameVisible(true)
}

const setupSplitter = () => {
  if (!splitter || !panelShell) return
  const min = 300
  const max = 560
  let startX = 0
  let startWidth = 360
  let dragging = false

  const onMove = (event: MouseEvent) => {
    if (!dragging) return
    const delta = event.clientX - startX
    const next = Math.min(max, Math.max(min, startWidth + delta))
    document.documentElement.style.setProperty('--panel-width', `${next}px`)
  }

  const onUp = () => {
    dragging = false
    splitter.classList.remove('dragging')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  splitter.addEventListener('mousedown', (event) => {
    const rect = panelShell.getBoundingClientRect()
    startX = event.clientX
    startWidth = rect.width
    dragging = true
    splitter.classList.add('dragging')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    event.preventDefault()
  })
}

setupSplitter()
loadCountryBorders()


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
  if (!isEditor) {
    applyStyles()
  }
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
        <button data-action="edit" data-id="${record.id}">Szerkesztés</button>
        <button data-action="show" data-id="${record.id}">Megjelenítés</button>
        <button data-action="remove" data-id="${record.id}">Törlés</button>
      </div>
    `
    recordList.appendChild(item)
  })
}

const createId = () => crypto.randomUUID()

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
  }

  const cameraFromParsed = parsed && 'camera' in parsed && parsed.camera
  const camera =
    cameraFromParsed &&
    typeof cameraFromParsed.longitude === 'number' &&
    typeof cameraFromParsed.latitude === 'number' &&
    typeof cameraFromParsed.height === 'number'
      ? {
          longitude: cameraFromParsed.longitude,
          latitude: cameraFromParsed.latitude,
          height: cameraFromParsed.height
        }
      : undefined

  if (Array.isArray(parsed)) {
    const items = parsed.map(toRecord).filter((item) => item.name && item.data)
    return { items, camera }
  }

  if (parsed && Array.isArray(parsed.items)) {
    const items = parsed.items.map(toRecord).filter((item) => item.name && item.data)
    return { title: parsed.title, description: parsed.description, camera, items }
  }

  throw new Error('Invalid JSON')
}

const applyDataset = (dataset: Dataset) => {
  db = dataset.items
  datasetTitle = dataset.title ?? ''
  datasetDescription = dataset.description ?? ''
  datasetCamera = dataset.camera
  if (datasetTitleInput) datasetTitleInput.value = datasetTitle
  if (datasetDescriptionInput) datasetDescriptionInput.value = datasetDescription
  resetDataSources()
  dataSources.clear()
  recordCenters.clear()
  refreshList()

  if (datasetCamera) {
    viewer.camera.setView({
      destination: Cartesian3.fromRadians(
        datasetCamera.longitude,
        datasetCamera.latitude,
        datasetCamera.height
      )
    })
  }
}

const computeCenter = (dataSource: DataSource, recordId: string) => {
  const positions: Cartesian3[] = []
  dataSource.entities.values.forEach((entity: Entity) => {
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

const basePolygonColor = (isActive: boolean) =>
  isActive
    ? ACTIVE_FILL.withAlpha(ACTIVE_POLYGON_FILL_ALPHA)
    : INACTIVE_FILL.withAlpha(POLYGON_FILL_ALPHA)

const baseOutlineColor = (isActive: boolean) =>
  (isActive ? ACTIVE_OUTLINE : INACTIVE_OUTLINE).withAlpha(POLYGON_OUTLINE_ALPHA)

const basePolylineColor = (isActive: boolean) =>
  (isActive ? POLYLINE_ACTIVE : POLYLINE_INACTIVE).withAlpha(POLYLINE_ALPHA)

const styleRecordGeometry = (recordId: string, activeId?: string) => {
  const source = dataSources.get(recordId)
  if (!source) return
  const isActive = Boolean(activeId) && recordId === activeId

  source.entities.values.forEach((entity: Entity) => {
    if (entity.polygon) {
      const fillColor = basePolygonColor(isActive)
      entity.polygon.material = new ColorMaterialProperty(fillColor)
      entity.polygon.outline = new ConstantProperty(true)
      entity.polygon.outlineColor = new ConstantProperty(baseOutlineColor(isActive))
      entity.polygon.outlineWidth = new ConstantProperty(1.2)
      entity.polygon.height = new ConstantProperty(0)
      entity.polygon.heightReference = new ConstantProperty(HeightReference.NONE)
    }
    if (entity.polyline) {
      const existingPolylineColor =
        entity.polyline.material instanceof ColorMaterialProperty
          ? (entity.polyline.material.color?.getValue(JulianDate.now()) as Color | undefined)
          : undefined
      const polylineColor = (existingPolylineColor ?? basePolylineColor(isActive)).withAlpha(
        POLYLINE_ALPHA
      )
      entity.polyline.material = new ColorMaterialProperty(polylineColor)
      entity.polyline.width = new ConstantProperty(isActive ? 4 : 2.5)
      entity.polyline.clampToGround = new ConstantProperty(false)
    }
  })
}

const applyStyles = (activeId?: string) => {
  dataSources.forEach((_, id) => styleRecordGeometry(id, activeId))
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

  const payload = record.data
  const dataSource =
    record.format === 'geojson'
      ? await GeoJsonDataSource.load(
          record.dataType === 'text' ? JSON.parse(payload) : payload,
          { clampToGround: false }
        )
      : await KmlDataSource.load(
          record.dataType === 'text'
            ? new DOMParser().parseFromString(payload, 'application/xml')
            : payload,
          {
            camera: viewer.scene.camera,
            canvas: viewer.scene.canvas
          }
        )

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
  })

  viewer.dataSources.add(dataSource)
  dataSources.set(record.id, dataSource)
  styleRecordGeometry(record.id)
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

const buildQueue = (
  length: number,
  options?: { keepLastFailed?: boolean; prioritizeFailed?: boolean; allowRepeats?: boolean }
) => {
  const ids = db.map((record) => record.id)
  if (ids.length === 0) return []
  const keepLastFailed = options?.keepLastFailed ?? true
  const prioritizeFailed = options?.prioritizeFailed ?? true
  const allowRepeats = options?.allowRepeats ?? true
  const queue: string[] = []
  if (keepLastFailed && game.lastFailedId && ids.includes(game.lastFailedId) && prioritizeFailed) {
    queue.push(game.lastFailedId)
  }
  const pool = ids.filter((id) => !queue.includes(id))
  if (keepLastFailed && game.lastFailedId && ids.includes(game.lastFailedId) && !prioritizeFailed) {
    if (!pool.includes(game.lastFailedId)) {
      pool.push(game.lastFailedId)
    }
  }
  while (queue.length < length && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length)
    queue.push(pool.splice(index, 1)[0])
  }
  if (allowRepeats) {
    while (queue.length < length && ids.length > 0) {
      const index = Math.floor(Math.random() * ids.length)
      queue.push(ids[index])
    }
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

const setGameRunning = (running: boolean) => {
  document.body.classList.toggle('game-running', running)
}

updateHudButtons(game.mode)

const displayName = (record: AreaRecord) => record.customName?.trim() || record.name

const syncDatasetMeta = () => {
  datasetTitle = datasetTitleInput?.value.trim() ?? ''
  datasetDescription = datasetDescriptionInput?.value.trim() ?? ''
}

datasetTitleInput?.addEventListener('input', syncDatasetMeta)
datasetDescriptionInput?.addEventListener('input', syncDatasetMeta)

const soundFiles = {
  start: '/sounds/start.mp3',
  correct: '/sounds/correct.mp3',
  wrong: '/sounds/wrong.mp3',
  streak: '/sounds/streak.mp3',
  click: '/sounds/click.mp3',
  nextTask: '/sounds/nextTask.mp3',
  end: '/sounds/end.mp3'
} as const

type SoundName = keyof typeof soundFiles

const soundCache = new Map<SoundName, HTMLAudioElement>()

const playSound = (name: SoundName, volume = 1) => {
  const src = soundFiles[name]
  if (!src) return
  let audio = soundCache.get(name)
  if (!audio) {
    audio = new Audio(src)
    audio.preload = 'auto'
    soundCache.set(name, audio)
  }
  try {
    audio.currentTime = 0
    audio.volume = volume
    void audio.play()
  } catch {
    // ignore playback failures (e.g., no user gesture)
  }
}

const resetForm = () => {
  if (recordName) recordName.value = ''
  if (recordCustomName) recordCustomName.value = ''
  if (recordUrl) recordUrl.value = ''
  if (recordFile) recordFile.value = ''
  if (recordTolerance) recordTolerance.value = ''
  editingId = null
  if (addRecordButton) addRecordButton.textContent = 'Hozzáadás'
  cancelEditButton?.classList.add('hidden')
  if (recordFormat) recordFormat.value = 'kml'
}

const getToleranceKm = (record: AreaRecord) =>
  Number.isFinite(record.toleranceKm) ? (record.toleranceKm as number) : 50

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

const resetPinsStyles = () => {
  applyHighlight(undefined)
}

const startGame = async (mode: GameMode) => {
  if (db.length === 0) {
    setFeedback('Nincs betöltött adatbázis.', 'bad')
    return
  }
  interactionLocked = false
  game.mode = mode
  updateHudButtons(mode)
  const queueSize = mode === 'pins' ? Math.min(12, db.length) : 7
  const allowRepeatInPins = db.length < queueSize
  game.queue = buildQueue(queueSize, {
    keepLastFailed: mode === 'select',
    prioritizeFailed: mode === 'select',
    allowRepeats: allowRepeatInPins
  })
  game.index = 0
  game.running = true
  game.streak = 0
  game.lastFailedId = null
  game.attemptsLeft = 12
  game.found = 0
  setGameRunning(true)
  clearArrow()
  hidePins()
  clearGuessPin()
  resetPinsStyles()
  playSound('start', 0.9)
  setFeedback('Játék indítva.', 'neutral')
  hidePostgame()
  await zoomToAllRecords()
  await updateTaskUI()
}

const handleSelectCorrect = async () => {
  if (interactionLocked) return
  interactionLocked = true
  game.streak += 1
  const target = currentTarget()
  const flash = target ? flashRecord(target.id, Color.LIME, { duration: 1200 }) : Promise.resolve()
  playSound('correct')
  await flash
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
  if (game.index >= game.queue.length) {
    game.queue = buildQueue(7)
    game.index = 0
  }
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
  if (target) await flashRecord(target.id, Color.RED, { duration: 1200 })
  playSound('wrong')
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
    const queueSize = Math.min(12, db.length)
    const allowRepeatInPins = db.length < queueSize
    game.queue = buildQueue(queueSize, { allowRepeats: allowRepeatInPins })
    game.index = 0
  }
}

const handlePinsAttempt = async (
  success: boolean,
  distance?: number,
  clickPoint?: Cartographic,
  targetPoint?: Cartographic,
  clickedRecordId?: string
) => {
  if (!game.running || interactionLocked) return
  interactionLocked = true
  try {
    const targetId = currentTarget()?.id
    game.attemptsLeft -= 1
    if (clickPoint && targetPoint && typeof distance === 'number') {
      const brng = bearingDegrees(clickPoint, targetPoint)
      const dir = cardinal(brng)
      setGuessPin(clickPoint, `${dir} · ${distance.toFixed(1)} km`)
    }

    if (success) {
      clearArrow()
      game.found += 1
      playSound('correct')
      setFeedback('Talált!', 'good')
      if (targetId) {
        await flashRecord(targetId, Color.LIME, { duration: 1000, restoreHighlight: false })
      }
      advancePinsQueue()
      await updateTaskUI()
    } else {
      playSound('wrong')
      if (clickPoint && targetPoint && typeof distance === 'number') {
        showArrow(clickPoint, targetPoint, distance)
        const brng = bearingDegrees(clickPoint, targetPoint)
        const dir = cardinal(brng)
        setFeedback(`Mellé. ${distance.toFixed(1)} km · ${dir}`, 'bad')
      } else {
        setFeedback('Mellé. Próbáld újra.', 'bad')
      }
      const flashId = clickedRecordId ?? targetId
      if (flashId) {
        await flashRecord(flashId, Color.RED, { duration: 1000, restoreHighlight: false })
      }
    }

    if (game.attemptsLeft <= 0) {
      game.running = false
      setGameRunning(false)
      setFeedback(`Vége! Találatok: ${game.found} / 12`, game.found >= 6 ? 'good' : 'neutral')
      playSound('end')
      const successNow = game.found >= 9
      showPostgame(
        successNow ? 'Gratulálunk!' : 'Ne add fel! Próbáld újra!',
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

const applyHighlight = (activeId?: string) => {
  applyStyles(activeId)
  if (game.mode === 'select' && activeId) {
    showPin(activeId, true)
  }
}

const easeInOut = (t: number) => t * t * (3 - 2 * t)

const flashRecord = (
  recordId: string,
  color: Color,
  options?: { duration?: number; restoreHighlight?: boolean }
) => {
  const duration = options?.duration ?? 1200
  const restoreHighlight = options?.restoreHighlight ?? true
  const source = dataSources.get(recordId)
  if (!source) return Promise.resolve()

  const start = performance.now()
  const targetFill = color.withAlpha(POLYGON_FILL_ALPHA)
  const targetOutline = color.withAlpha(POLYGON_OUTLINE_ALPHA)

  source.entities.values.forEach((entity: Entity) => {
    if (entity.polygon) {
      const currentColor =
        entity.polygon.material instanceof ColorMaterialProperty
          ? (entity.polygon.material.color?.getValue(JulianDate.now()) as Color | undefined)
          : undefined
      const fromColor = (currentColor ?? targetFill).withAlpha(POLYGON_FILL_ALPHA)
      const animated = new CallbackProperty((_, result) => {
        const t = Math.min((performance.now() - start) / duration, 1)
        const eased = easeInOut(t)
        const safeResult = result ?? new Color()
        return Color.lerp(fromColor, targetFill, eased, safeResult)
      }, false)
      entity.polygon.material = new ColorMaterialProperty(animated)
      entity.polygon.outlineColor = new ConstantProperty(targetOutline)
    }
    if (entity.polyline) {
      entity.polyline.material = new ColorMaterialProperty(color.withAlpha(POLYLINE_ALPHA))
      entity.polyline.width = new ConstantProperty(4)
    }
  })

  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      if (restoreHighlight && game.mode === 'select' && currentTarget()) {
        applyHighlight(currentTarget()!.id)
      } else {
        applyHighlight(game.mode === 'select' ? currentTarget()?.id : undefined)
      }
      resolve()
    }, duration)
  })
}

const getCenter = (id: string) => {
  if (recordCenters.has(id)) return recordCenters.get(id)!
  const source = dataSources.get(id)
  if (!source) return null
  computeCenter(source, id)
  return recordCenters.get(id) ?? null
}

const distanceKm = (a: Cartographic, b: Cartographic) =>
  new EllipsoidGeodesic(a, b).surfaceDistance / 1000

const closestPolylineDistanceKm = (recordId: string, point: Cartographic) => {
  const source = dataSources.get(recordId)
  if (!source) return null
  let minDistance = Number.POSITIVE_INFINITY
  let hasPolyline = false

  source.entities.values.forEach((entity: Entity) => {
    if (!entity.polyline?.positions) return
    const positions = entity.polyline.positions.getValue(JulianDate.now()) as
      | Cartesian3[]
      | undefined
    if (!positions || positions.length === 0) return
    hasPolyline = true

    if (positions.length === 1) {
      const carto = Cartographic.fromCartesian(positions[0])
      minDistance = Math.min(minDistance, distanceKm(point, carto))
      return
    }

    for (let i = 0; i < positions.length - 1; i += 1) {
      const start = positions[i]
      const end = positions[i + 1]
      const startCarto = Cartographic.fromCartesian(start)
      const endCarto = Cartographic.fromCartesian(end)
      const segmentKm = distanceKm(startCarto, endCarto)
      const steps = Math.max(2, Math.ceil(segmentKm / 20))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const sample = new Cartesian3()
        Cartesian3.lerp(start, end, t, sample)
        const sampleCarto = Cartographic.fromCartesian(sample)
        minDistance = Math.min(minDistance, distanceKm(point, sampleCarto))
      }
    }
  })

  return hasPolyline ? minDistance : null
}

const getPolygonRings = (recordId: string) => {
  const source = dataSources.get(recordId)
  if (!source) return [] as Cartographic[][]
  const rings: Cartographic[][] = []
  source.entities.values.forEach((entity: Entity) => {
    const hierarchy = entity.polygon?.hierarchy?.getValue(JulianDate.now()) as
      | PolygonHierarchy
      | undefined
    if (!hierarchy) return
    const collect = (h: PolygonHierarchy) => {
      rings.push(h.positions.map((p: Cartesian3) => Cartographic.fromCartesian(p)))
      h.holes?.forEach(collect)
    }
    collect(hierarchy)
  })
  return rings
}

const pointInRing = (point: Cartographic, ring: Cartographic[]) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].longitude
    const yi = ring[i].latitude
    const xj = ring[j].longitude
    const yj = ring[j].latitude
    const intersect = yi > point.latitude !== yj > point.latitude &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const isPointInsideRecordPolygon = (recordId: string, point: Cartographic) => {
  const rings = getPolygonRings(recordId)
  if (rings.length === 0) return false
  // First ring is outer, subsequent rings (holes) invert the result
  const outer = rings[0]
  if (!pointInRing(point, outer)) return false
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false
  }
  return true
}

const closestPolygonBoundaryDistanceKm = (recordId: string, point: Cartographic) => {
  const rings = getPolygonRings(recordId)
  if (rings.length === 0) return null
  let minDistance = Number.POSITIVE_INFINITY
  rings.forEach((ring) => {
    if (ring.length === 1) {
      minDistance = Math.min(minDistance, distanceKm(point, ring[0]))
      return
    }
    for (let i = 0; i < ring.length; i += 1) {
      const start = ring[i]
      const end = ring[(i + 1) % ring.length]
      const segmentKm = distanceKm(start, end)
      const steps = Math.max(2, Math.ceil(segmentKm / 20))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const sample = new Cartographic(
          start.longitude + (end.longitude - start.longitude) * t,
          start.latitude + (end.latitude - start.latitude) * t,
          0
        )
        minDistance = Math.min(minDistance, distanceKm(point, sample))
      }
    }
  })
  return minDistance
}

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
  const scene = viewer.scene
  const startCartesian = Cartesian3.fromRadians(from.longitude, from.latitude, from.height ?? 0)
  const endCartesian = Cartesian3.fromRadians(to.longitude, to.latitude, to.height ?? 0)
  const startScreen = viewer.scene.cartesianToCanvasCoordinates(startCartesian, new Cartesian2())
  const endScreen = viewer.scene.cartesianToCanvasCoordinates(endCartesian, new Cartesian2())

  let arrowStart = startCartesian
  let arrowEnd: Cartesian3 | null = null

  if (startScreen && endScreen) {
    const dir = Cartesian2.subtract(endScreen, startScreen, new Cartesian2())
    const len = Math.hypot(dir.x, dir.y)
    if (len > 0) {
      const scaled = Cartesian2.multiplyByScalar(dir, 50 / len, new Cartesian2())
      const screenEnd = Cartesian2.add(startScreen, scaled, new Cartesian2())
      arrowEnd = viewer.camera.pickEllipsoid(screenEnd, scene.globe.ellipsoid) ?? null
    }
  }

  if (!arrowEnd) {
    // Fallback: short segment toward target in world space (2% of distance)
    const startCarto = from
    const toward = new Cartographic(
      startCarto.longitude + (to.longitude - startCarto.longitude) * 0.02,
      startCarto.latitude + (to.latitude - startCarto.latitude) * 0.02,
      0
    )
    arrowEnd = Cartesian3.fromRadians(toward.longitude, toward.latitude, 0)
  }

  const positions = [arrowStart, arrowEnd]
  const labelPosition = Cartesian3.lerp(arrowStart, arrowEnd, 0.5, new Cartesian3())

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

const zoomToAllRecords = async () => {
  await ensureAllLoaded()
  const points = Array.from(recordCenters.values()).map((c) =>
    Cartesian3.fromRadians(c.longitude, c.latitude, c.height ?? 0)
  )

  if (points.length === 0) {
    if (datasetCamera) {
      viewer.camera.setView({
        destination: Cartesian3.fromRadians(
          datasetCamera.longitude,
          datasetCamera.latitude,
          datasetCamera.height
        )
      })
    }
    return
  }

  const sphere = BoundingSphere.fromPoints(points)
  const range = Math.max(sphere.radius * 4.5, 250000)
  try {
    await viewer.camera.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(0, -Math.PI / 2, range),
      duration: 0.9
    })
  } catch {
    // ignore zoom errors
  }
}

const loadSetSources = async () => {
  await ensureAllLoaded()
  applyHighlight(currentTarget()?.id)
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
  const target = currentTarget()
  if (!target) return
  const distractors = db.filter((record) => record.id !== target.id)
  const extra = shuffle(distractors).slice(0, 3)
  const options = shuffle([target, ...extra])

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
  if (!game.running || interactionLocked) return
  const picked = viewer.scene.pick(movement.position)
  const clickedRecordId =
    picked && (picked as { id?: { recordId?: string } }).id?.recordId
      ? (picked as { id?: { recordId?: string } }).id?.recordId
      : undefined
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
    const polylineDist = closestPolylineDistanceKm(target.id, clickPoint)
    const polygonInside = isPointInsideRecordPolygon(target.id, clickPoint)
    const polygonBoundaryDist = closestPolygonBoundaryDistanceKm(target.id, clickPoint)

    if (!center && polylineDist === null && polygonBoundaryDist === null && !polygonInside) {
      setFeedback('Nincs alakzat ehhez a tételhez.', 'bad')
      return
    }

    const distCandidates = [
      polygonInside ? 0 : null,
      polygonBoundaryDist,
      polylineDist,
      center ? distanceKm(clickPoint, center) : null
    ].filter((v): v is number => typeof v === 'number')

    const dist = distCandidates.length > 0 ? Math.min(...distCandidates) : Number.POSITIVE_INFINITY
    const tolerance = getToleranceKm(target)
    const success = polygonInside || dist <= tolerance
    await handlePinsAttempt(success, dist, clickPoint, center ?? undefined, clickedRecordId)
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
    const dataset = parseRecords(text)
    applyDataset(dataset)
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
    const dataset = parseRecords(text)
    applyDataset(dataset)
    setFeedback('Feladatsor betöltve. Indul a Gombostűk mód!', 'good')
    updateNav('player')
    await startGame('pins')
  } catch {
    setFeedback('Nem sikerült betölteni a feladatsort.', 'bad')
  } finally {
    landingPlayInput.value = ''
  }
})

landingDemoButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const path = button.dataset.demo
    if (!path) return
    try {
      const response = await fetch(path)
      if (!response.ok) throw new Error('Failed to load demo')
      const text = await response.text()
      const dataset = parseRecords(text)
      applyDataset(dataset)
      game.running = false
      setGameRunning(false)
      selectMode?.classList.add('hidden')
      setFeedback('Demo betöltve. Válassz játékmódot!', 'neutral')
      updateNav('player')
    } catch {
      setFeedback('Nem sikerült betölteni a demót.', 'bad')
    }
  })
})

gameExitButton?.addEventListener('click', () => {
  game.running = false
  setGameRunning(false)
  hidePostgame()
  clearGuessPin()
  clearArrow()
  hidePins()
  if (feedback) feedback.textContent = ' '
  setLandingVisible(true)
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
  datasetTitle = datasetTitleInput?.value.trim() ?? ''
  datasetDescription = datasetDescriptionInput?.value.trim() ?? ''
  const toleranceRaw = recordTolerance?.value.trim() ?? ''
  const toleranceValue = toleranceRaw === '' ? undefined : Number(toleranceRaw)
  const toleranceKm = toleranceValue === undefined || !Number.isFinite(toleranceValue)
    ? undefined
    : toleranceValue

  const file = recordFile?.files?.[0]
  const url = recordUrl?.value.trim()
  const format = (recordFormat?.value as DataFormat) ?? 'kml'
  const isEditing = Boolean(editingId)

  if (!isEditing && !file && !url) {
    setFeedback('Adj meg URL-t vagy válassz fájlt.', 'bad')
    return
  }

  if (editingId) {
    const record = db.find((item) => item.id === editingId)
    if (!record) {
      setFeedback('Nem található a módosítandó tétel.', 'bad')
      resetForm()
      return
    }
    record.name = name
    record.customName = customName
    record.toleranceKm = toleranceKm
    let dataChanged = false

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
      record.data = text
      record.dataType = 'text'
      record.format = format
      dataChanged = true
    } else if (url) {
      record.data = url
      record.dataType = 'url'
      record.format = format
      dataChanged = true
    }

    if (dataChanged) {
      const source = dataSources.get(record.id)
      if (source) viewer.dataSources.remove(source)
      dataSources.delete(record.id)
      recordCenters.delete(record.id)
      recordRadii.delete(record.id)
      const pin = pinEntities.get(record.id)
      if (pin) viewer.entities.remove(pin)
      pinEntities.delete(record.id)
      await loadDataSource(record)
    } else {
      const source = dataSources.get(record.id)
      if (source) source.name = record.name
    }
    refreshList()
    setFeedback('Frissítve.', 'good')
    resetForm()
  } else {
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
    resetForm()
  }
})

cancelEditButton?.addEventListener('click', () => {
  resetForm()
  setFeedback('Szerkesztés megszakítva.', 'neutral')
})

clearRecordsButton?.addEventListener('click', () => {
  db = []
  datasetTitle = ''
  datasetDescription = ''
  resetDataSources()
  dataSources.clear()
  recordCenters.clear()
  recordRadii.clear()
  pinEntities.forEach((entity) => viewer.entities.remove(entity))
  pinEntities.clear()
  clearGuessPin()
  resetForm()
  if (datasetTitleInput) datasetTitleInput.value = ''
  if (datasetDescriptionInput) datasetDescriptionInput.value = ''
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
    if (editingId === id) resetForm()
    refreshList()
  }

  if (action === 'show') {
    await loadDataSource(record, { zoom: true })
  }

  if (action === 'edit') {
    editingId = id
    if (recordName) recordName.value = record.name
    if (recordCustomName) recordCustomName.value = record.customName ?? ''
    if (recordFormat) recordFormat.value = record.format
    if (recordUrl) recordUrl.value = record.dataType === 'url' ? record.data : ''
    if (recordFile) recordFile.value = ''
    if (recordTolerance) recordTolerance.value = record.toleranceKm?.toString() ?? ''
    if (addRecordButton) addRecordButton.textContent = 'Mentés'
    cancelEditButton?.classList.remove('hidden')
    setFeedback('Szerkesztés mód: módosítsd és ments.', 'neutral')
  }
})

saveJsonButton?.addEventListener('click', () => {
  syncDatasetMeta()
  const cam = viewer.camera.positionCartographic
  const payload: Dataset = {
    title: datasetTitle || undefined,
    description: datasetDescription || undefined,
    camera: cam
      ? {
          longitude: cam.longitude,
          latitude: cam.latitude,
          height: cam.height
        }
      : undefined,
    items: db
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
    const text = await file.text()
    const dataset = parseRecords(text)
    applyDataset(dataset)
    setFeedback('JSON betöltve.', 'good')
  } catch {
    setFeedback('Nem sikerült betölteni a JSON fájlt.', 'bad')
  } finally {
    loadJsonInput.value = ''
  }
})

optionList?.addEventListener('click', async (event) => {
  if (!game.running || game.mode !== 'select' || interactionLocked) return
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
