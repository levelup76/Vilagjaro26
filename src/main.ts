import 'cesium/Build/Cesium/Widgets/widgets.css'
import './style.css'
import {
  Ion,
  Viewer,
  KmlDataSource,
  GeoJsonDataSource,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Cartesian2,
  HeightReference,
  Color,
  ConstantProperty,
  ColorMaterialProperty,
  SceneMode,
  UrlTemplateImageryProvider
} from 'cesium'
import type { DataSource } from 'cesium'
import osmtogeojson from 'osmtogeojson'

type DataType = 'url' | 'text'
type DataFormat = 'kml' | 'geojson'

type AreaRecord = {
  id: string
  name: string
  data: string
  dataType: DataType
  format: DataFormat
  aliases: string[]
}

type GameMode = 'click' | 'select'

type GameState = {
  mode: GameMode
  queue: string[]
  index: number
  streak: number
  lastFailedId: string | null
  running: boolean
}

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN ?? ''

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root not found')

app.innerHTML = `
  <div class="app-shell">
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
          <h2>Szerkesztő</h2>
          <div class="form-grid">
            <label>
              Terület neve
              <input id="record-name" type="text" placeholder="Pl.: Balaton" />
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
          </div>
          <div class="button-row">
            <button id="add-record" class="primary">Hozzáadás</button>
            <button id="clear-records">Lista törlése</button>
          </div>
          <div class="osm-panel">
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
          <h3>Adatbázis</h3>
          <ul id="record-list" class="record-list"></ul>
          <div class="button-row">
            <button id="save-json">JSON mentés</button>
            <label class="file-button">
              JSON betöltés
              <input id="load-json" type="file" accept="application/json" />
            </label>
          </div>
        </section>

        <section id="player-view" class="view hidden">
          <h2>Lejátszó</h2>
          <div class="form-grid">
            <label>
              Játék mód
              <select id="game-mode">
                <option value="click">Kattintós</option>
                <option value="select">Nevezd meg!</option>
              </select>
            </label>
          </div>
          <div class="button-row">
            <button id="start-game" class="primary">Játék indítása</button>
            <button id="stop-game">Játék leállítása</button>
          </div>
          <div class="status">
            <div>Feladat: <span id="task-label">-</span></div>
            <div>Streak: <span id="streak-value">0</span> / 7</div>
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

const recordName = document.querySelector<HTMLInputElement>('#record-name')
const recordFormat = document.querySelector<HTMLSelectElement>('#record-format')
const recordUrl = document.querySelector<HTMLInputElement>('#record-url')
const recordFile = document.querySelector<HTMLInputElement>('#record-file')
const addRecordButton = document.querySelector<HTMLButtonElement>('#add-record')
const clearRecordsButton = document.querySelector<HTMLButtonElement>('#clear-records')
const recordList = document.querySelector<HTMLUListElement>('#record-list')
const saveJsonButton = document.querySelector<HTMLButtonElement>('#save-json')
const loadJsonInput = document.querySelector<HTMLInputElement>('#load-json')
const osmRelationIdInput = document.querySelector<HTMLInputElement>('#osm-relation-id')
const osmRelationImportButton = document.querySelector<HTMLButtonElement>('#osm-relation-import')

const gameModeSelect = document.querySelector<HTMLSelectElement>('#game-mode')
const startGameButton = document.querySelector<HTMLButtonElement>('#start-game')
const stopGameButton = document.querySelector<HTMLButtonElement>('#stop-game')
const taskLabel = document.querySelector<HTMLSpanElement>('#task-label')
const streakValue = document.querySelector<HTMLSpanElement>('#streak-value')
const feedback = document.querySelector<HTMLDivElement>('#feedback')
const selectMode = document.querySelector<HTMLDivElement>('#select-mode')
const optionList = document.querySelector<HTMLDivElement>('#option-list')

let db: AreaRecord[] = []
const dataSources = new Map<string, DataSource>()
let borderDataSource: DataSource | null = null

const game: GameState = {
  mode: 'click',
  queue: [],
  index: 0,
  streak: 0,
  lastFailedId: null,
  running: false
}

const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)


const updateNav = (mode: 'editor' | 'player') => {
  if (!navEditor || !navPlayer || !editorView || !playerView) return
  const isEditor = mode === 'editor'
  navEditor.classList.toggle('active', isEditor)
  navPlayer.classList.toggle('active', !isEditor)
  editorView.classList.toggle('hidden', !isEditor)
  playerView.classList.toggle('hidden', isEditor)
}

const refreshList = () => {
  if (!recordList) return
  recordList.innerHTML = ''
  db.forEach((record) => {
    const item = document.createElement('li')
    item.className = 'record-item'
    item.innerHTML = `
      <div>
        <strong>${record.name}</strong>
        <small>${record.format.toUpperCase()} · ${record.dataType === 'url' ? 'URL' : 'Fájl'}</small>
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

const loadDataSource = async (record: AreaRecord, options?: { replace?: boolean; zoom?: boolean }) => {
  if (options?.replace) {
    resetDataSources()
    dataSources.clear()
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
}

const buildQueue = () => {
  const ids = db.map((record) => record.id)
  if (ids.length === 0) return []
  const queue: string[] = []
  if (game.lastFailedId && ids.includes(game.lastFailedId)) {
    queue.push(game.lastFailedId)
  }
  const pool = ids.filter((id) => id !== game.lastFailedId)
  while (queue.length < 7 && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length)
    queue.push(pool.splice(index, 1)[0])
  }
  while (queue.length < 7 && ids.length > 0) {
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

const updateTaskUI = async () => {
  const target = currentTarget()
  if (!taskLabel || !streakValue) return
  if (!target) {
    taskLabel.textContent = '-'
    return
  }
  taskLabel.textContent = game.mode === 'click' ? target.name : 'Nevezd meg a kijelölt területet'
  streakValue.textContent = String(game.streak)

  if (game.mode === 'select') {
    selectMode?.classList.remove('hidden')
    await loadSetSources()
    applyHighlight(target.id)
    renderOptions()
  } else {
    selectMode?.classList.add('hidden')
    await ensureAllLoaded()
    applyHighlight(target.id)
    await zoomToActiveTarget()
  }
}

const startGame = async () => {
  if (db.length === 0) {
    setFeedback('Nincs betöltött adatbázis.', 'bad')
    return
  }
  game.mode = (gameModeSelect?.value as GameMode) ?? 'click'
  game.queue = buildQueue()
  game.index = 0
  game.running = true
  setFeedback('Játék indítva.', 'neutral')
  await updateTaskUI()
}

const stopGame = () => {
  game.running = false
  taskLabel && (taskLabel.textContent = '-')
  setFeedback('Játék leállítva.', 'neutral')
}

const handleCorrect = async () => {
  game.streak += 1
  flashActive(Color.LIME)
  playTone(880)
  if (game.streak >= 7) {
    setFeedback('Szuper! 7 egymás utáni helyes válasz. Játék vége.', 'good')
    game.running = false
    return
  }
  game.index += 1
  if (game.index >= game.queue.length) {
    game.queue = buildQueue()
    game.index = 0
  }
  setFeedback('Helyes!', 'good')
  await updateTaskUI()
}

const handleIncorrect = async () => {
  const target = currentTarget()
  game.streak = 0
  game.lastFailedId = target?.id ?? null
  game.queue = buildQueue()
  game.index = 0
  flashActive(Color.RED)
  playTone(220)
  if (game.mode === 'select' && target) {
    setFeedback(`Nem jó. Helyes: ${target.name}. Új feladatsor indul.`, 'bad')
  } else {
    setFeedback('Nem jó. Új feladatsor indul.', 'bad')
  }
  await updateTaskUI()
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

const zoomToActiveTarget = async () => {
  const target = currentTarget()
  if (!target) return
  const source = dataSources.get(target.id)
  if (!source) return
  try {
    await viewer.flyTo(source)
    if (viewer.camera.positionCartographic) {
      viewer.camera.zoomOut(350000)
    }
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
    button.textContent = record.name
    button.dataset.id = record.id
    optionList.appendChild(button)
  })
}

handler.setInputAction(async (movement: { position: Cartesian2 }) => {
  if (!game.running || game.mode !== 'click') return
  const picked = viewer.scene.pick(movement.position)
  if (!defined(picked) || !(picked.id as { recordId?: string }).recordId) {
    setFeedback('Nem talált területet. Próbáld újra.', 'bad')
    return
  }
  const clickedId = (picked.id as { recordId?: string }).recordId
  const target = currentTarget()
  if (target && clickedId === target.id) {
    await handleCorrect()
  } else {
    await handleIncorrect()
  }
}, ScreenSpaceEventType.LEFT_CLICK)

navEditor?.addEventListener('click', () => updateNav('editor'))
navPlayer?.addEventListener('click', () => updateNav('player'))

addRecordButton?.addEventListener('click', async () => {
  const name = recordName?.value.trim() ?? ''
  if (!name) {
    setFeedback('Adj meg nevet a területhez.', 'bad')
    return
  }

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
      data: text,
      dataType: 'text',
      format,
      aliases: []
    }
  } else {
    record = {
      id: createId(),
      name,
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
  if (recordUrl) recordUrl.value = ''
  if (recordFile) recordFile.value = ''
})

clearRecordsButton?.addEventListener('click', () => {
  db = []
  resetDataSources()
  dataSources.clear()
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
    const parsed = JSON.parse(text) as Array<Partial<AreaRecord> & { kml?: string; kmlType?: DataType }>
    if (!Array.isArray(parsed)) throw new Error('Invalid JSON')
    db = parsed
      .map((item) => {
        const data = item.data ?? item.kml ?? ''
        const dataType =
          item.dataType ??
          item.kmlType ??
          (/^https?:\/\//.test(data) ? 'url' : 'text')
        const format = item.format ?? 'kml'
        return {
          id: item.id ?? createId(),
          name: item.name ?? 'Ismeretlen',
          data,
          dataType,
          format,
          aliases: Array.isArray(item.aliases) ? item.aliases : []
        }
      })
      .filter((item) => item.name && item.data)
    resetDataSources()
    dataSources.clear()
    refreshList()
    setFeedback('JSON betöltve.', 'good')
  } catch {
    setFeedback('Nem sikerült betölteni a JSON fájlt.', 'bad')
  }
})

startGameButton?.addEventListener('click', startGame)
stopGameButton?.addEventListener('click', stopGame)

gameModeSelect?.addEventListener('change', () => {
  if (game.running) {
    startGame()
  }
})

optionList?.addEventListener('click', async (event) => {
  if (!game.running || game.mode !== 'select') return
  const target = event.target as HTMLElement
  if (!target?.dataset?.id) return
  const selectedId = target.dataset.id
  const active = currentTarget()
  if (active && selectedId === active.id) {
    await handleCorrect()
  } else {
    await handleIncorrect()
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
