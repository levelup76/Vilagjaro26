# Világjáró – Cesium földrajzi kvíz-alkalmazás

Interaktív, böngészőben futó földrajzi kvíz CesiumJS-alapú 2D-s térképpel. A felhasználó saját feladatsorokat készíthet (KML/GeoJSON területek) és kétféle játékmódban játszhat velük.

---

## Tartalomjegyzék

1. [Technológiai stack](#1-technológiai-stack)
2. [Projekt struktúra](#2-projekt-struktúra)
3. [Környezeti változók](#3-környezeti-változók)
4. [Fejlesztés és build](#4-fejlesztés-és-build)
5. [Architektúra áttekintés](#5-architektúra-áttekintés)
6. [TypeScript típusok](#6-typescript-típusok)
7. [Dataset JSON séma](#7-dataset-json-séma)
8. [Játékmódok és mechanikák](#8-játékmódok-és-mechanikák)
9. [Kulcsfüggvények referenciája](#9-kulcsfüggvények-referenciája)
10. [UI struktúra és CSS osztályok](#10-ui-struktúra-és-css-osztályok)
11. [Hangok](#11-hangok)
12. [Demo feladatsorok](#12-demo-feladatsorok)
13. [Ismert korlátok](#13-ismert-korlátok)
14. [Bővítési pontok](#14-bővítési-pontok)

---

## 1. Technológiai stack

| Réteg | Technológia | Megjegyzés |
|---|---|---|
| Nyelv | TypeScript 5.9 | strict + noUnusedLocals |
| Bundler | Vite 7 | `vite-plugin-cesium` a Cesium asset kezeléshez |
| Térkép | CesiumJS 1.137 | 2D SceneMode, UrlTemplateImageryProvider (ArcGIS World Imagery) |
| Adat | KML / GeoJSON | KmlDataSource, GeoJsonDataSource |
| OSM import | osmtogeojson | Overpass API proxyn keresztül |
| Stílus | Vanilla CSS (`src/style.css`) | CSS custom properties, nincs framework |

---

## 2. Projekt struktúra

```
Vilagjaro/
├── index.html                  # Belépési pont (egyetlen <div id="app">)
├── vite.config.ts              # Vite konfig + Overpass proxy
├── tsconfig.json               # TS konfig (strict, noUnusedLocals stb.)
├── .env                        # VITE_CESIUM_TOKEN (nem kerül git-be)
├── .env.example                # Token sablon
├── src/
│   ├── main.ts                 # Teljes alkalmazáslogika (~1850 sor)
│   ├── style.css               # Globális stílusok
│   ├── counter.ts              # Nem használt scaffold maradvány
│   └── types/
│       └── cesium-extend.d.ts  # ScreenSpaceCameraController kiterjesztés
├── public/
│   ├── hero.jpg                # Landing illusztráció
│   ├── opening.png             # (tartalék kép)
│   ├── sounds/                 # MP3 hangfájlok (start, correct, wrong, stb.)
│   └── games/                  # Beépített demo JSON feladatsorok
│       ├── kozepeuropafolyoivizei.json
│       ├── kozepeuropavarosai.json
│       └── magyarorszagkozeptajai.json
└── dist/                       # Build output (gitignore-ban)
```

> **Fontos:** Minden logika egyetlen `src/main.ts` fájlban van, nincs modularizáció. Az összes változó és függvény modul scope-ban él.

---

## 3. Környezeti változók

| Változó | Kötelező | Leírás |
|---|---|---|
| `VITE_CESIUM_TOKEN` | Igen | CesiumJS Ion hozzáférési token. Ingyenes fiók: [cesium.com/ion](https://cesium.com/ion/). Token nélkül a térkép nem tölt be, de az alkalmazás elindul (warning banner jelenik meg). |

Beállítás:
```bash
cp .env.example .env
# majd szerkeszd a .env fájlt
```

---

## 4. Fejlesztés és build

```bash
npm install          # függőségek telepítése
npm run dev          # fejlesztői szerver (localhost:5173, Overpass proxy aktív)
npm run build        # tsc + vite build → dist/
npm run preview      # dist/ előnézete (localhost:4173)
```

**Overpass proxy:** `vite.config.ts` `/overpass/*` → `https://overpass-api.de/api/*` – csak dev módban aktív. Productionban a `/overpass/interpreter` endpoint nem elérhető (OSM import nem fog működni), hacsak a hosting platform nem biztosít proxy-t.

---

## 5. Architektúra áttekintés

Az alkalmazás egyoldalas, SPA-szerű felépítésű, de keretrendszer nélkül. A DOM-ot `app.innerHTML` segítségével egyszer rendereli, majd eseménykezelőkkel frissíti.

### Főbb állapotok

```
landing (főoldal látható)
  ↓ demo / fájl betöltés
editor nézet (Szerkesztő tab)
  ↓ nav-player klikk
player nézet (Lejátszó tab)
  ↓ startGame('pins' | 'select')
játék fut
  ↓ győzelem / vereség
postgame panel
  ↓ újra / másik mód / kilépés
landing
```

### Nézetek

- **landing**: Fullscreen overlay, demo gombok és fájl feltöltő. `setLandingVisible()` vezérli.
- **editor-view**: Szerkesztő panel (bal), Cesium térkép (jobb). Drag-és-ejtéssel átméretezhető splitter.
- **player-view**: Csak a térkép látható + felső HUD sáv. Játék nem indul automatikusan.

### Cesium setup

- `SceneMode.SCENE2D`, tilt letiltva, pitch rögzítve `-90°`
- Imagery: ArcGIS World Imagery (nincs Cesium ion terrain)
- Országhatárok: Natural Earth 50m GeoJSON, `stroke: WHITE 60%`, `fill: TRANSPARENT`
- Minden AreaRecord adatforrása egy külön `KmlDataSource` vagy `GeoJsonDataSource`, UUID kulcsú `Map<string, DataSource>`-ban tárolva

---

## 6. TypeScript típusok

Az összes típus `src/main.ts` elején van definiálva.

### `AreaRecord`
Egyetlen megnevezendő földrajzi terület adata.

```typescript
type AreaRecord = {
  id: string           // UUID, automatikusan generált
  name: string         // Canonical (beírandó) név
  customName?: string  // Megjelenítési név (ha különbözik)
  aliases: string[]    // Alternatív elfogadott nevek (jövőbeli bővítés)
  toleranceKm?: number // Tűrési kör gombostűk módhoz (alapért.: 50 km)
  data: string         // KML/GeoJSON szöveg VAGY URL
  dataType: DataType   // 'text' | 'url'
  format: DataFormat   // 'kml' | 'geojson'
}
```

### `Dataset`
Exportált/importált JSON fájl struktúrája.

```typescript
type Dataset = {
  title?: string           // Feladatsor neve
  description?: string     // Rövid leírás
  camera?: DatasetCamera   // Alapértelmezett kameranézet (radián!)
  items: AreaRecord[]
}

type DatasetCamera = {
  longitude: number  // Radián (nem fok!)
  latitude: number   // Radián
  height: number     // Méter
}
```

### `GameState`
Runtime játékállapot – nem perzisztált.

```typescript
type GameState = {
  mode: GameMode           // 'pins' | 'select'
  queue: string[]          // AreaRecord ID-k sorrendben
  index: number            // Aktuális pozíció a queue-ban
  streak: number           // Egymás utáni helyes select válaszok
  lastFailedId: string | null
  running: boolean
  attemptsLeft: number     // Csak pins módban (max 12)
  found: number            // Pins módban eltalált elemek száma
}
```

### `GameMode`
```typescript
type GameMode = 'pins' | 'select'
```

### Vizuális konstansok

```typescript
const POLYGON_FILL_ALPHA = 0.3          // Inaktív poligon átlátszóság
const ACTIVE_POLYGON_FILL_ALPHA = 0.7   // Aktív (célpont) poligon
const POLYGON_OUTLINE_ALPHA = 0.7
const POLYLINE_ALPHA = 0.7
const ACTIVE_FILL = Color.ORANGE        // Célpont kitöltés (select módban)
const INACTIVE_FILL = Color.CYAN        // Többi terület kitöltés
const ACTIVE_OUTLINE = Color.YELLOW
const INACTIVE_OUTLINE = Color.WHITE
const POLYLINE_ACTIVE = Color.YELLOW
const POLYLINE_INACTIVE = Color.CYAN
```

---

## 7. Dataset JSON séma

### Minimális példa (legacy tömb formátum – visszafelé kompatibilis)
```json
[
  {
    "name": "Balaton",
    "data": "<kml>...</kml>",
    "dataType": "text",
    "format": "kml"
  }
]
```

### Teljes formátum
```json
{
  "title": "Magyarország középtájai",
  "description": "A 35 középtáj körvonala KML alapján.",
  "camera": {
    "longitude": 0.33,
    "latitude": 0.82,
    "height": 800000
  },
  "items": [
    {
      "id": "uuid-v4",
      "name": "Kisalföld",
      "customName": "Kisalföld (Ny-Dunántúl)",
      "aliases": [],
      "toleranceKm": 30,
      "data": "https://example.com/kisalfold.kml",
      "dataType": "url",
      "format": "kml"
    }
  ]
}
```

**Fontos:** A `camera.longitude/latitude` radiánban van tárolva (Cesium natív egység), nem fokokban. Exportkor a `viewer.camera.positionCartographic` kerül mentésre.

---

## 8. Játékmódok és mechanikák

### Gombostűk mód (`pins`)

- **Cél:** Kattintással jelöld meg a megnevezett terület helyét a térképen.
- **Feladatok:** Max. 12 db, véletlenszerűen a teljes DB-ből (ismétlés nélkül, ha a DB ≥ 12 elem).
- **Siker:** A kattintott pont a célterület poligonjában van VAGY a távolság ≤ `toleranceKm` (pont→határvonal / pont→útvonal / pont→középpont legkisebbike).
- **Kör vége:** 12 kísérlet elfogyásával. 9+/12 találat: „Gratulálunk!", 6–8: semleges, <6: bátorítás.
- **HUD:** `Lépések: X / 12 · Találat: Y`
- **Visszajelzés hibánál:** Nyíl (50 px képernyőn) + `X.X km · Égtáj` felirat; piros villanás az érintett területen.
- **Visszajelzés sikerül:** Zöld villanás, a terület „megtalálva" jelölést kap (szín megmarad), következő feladat.

### Nevezd meg! mód (`select`)

- **Cél:** A narancsszínnel kiemelve látható területet azonosítsd a 4 válaszgomb egyikével.
- **Feladatok:** Végtelen, 7 napos streak az összefoglaló feltétele.
- **Siker (streak):** 7 egymás utáni helyes válasz → játék vége, „Gratulálunk!".
- **Hiba:** Streak nullázódik, az előző sikertelen elem a következő queue elejére kerül (priorityFirst logika); a helyes válasz kiírásra kerül.
- **HUD:** `Streak: X / 7`
- **Visszajelzés:** Zöld villanás helyesnél, piros hibánál; 1200 ms animáció.

### Közös mechanikák

- **Interaction lock:** `interactionLocked` flag megakadályozza a dupla kattintást animáció közben.
- **Flash animáció:** `flashRecord()` – `CallbackProperty`-alapú szín-lerp (easeInOut, `Color.lerp` saját result objektummal a DeveloperError elkerüléséhez).
- **Queue építés:** `buildQueue(length, options)` – pool-alapú véletlenszerű sorrend, opcionálisan ismétlés engedélyezve ha a pool kisebb a queue méretnél.
- **Zoom start:** `zoomToAllRecords()` minden játékindításkor – BoundingSphere az összes center pontból, min. 250 km range, 4.5× sugár.

---

## 9. Kulcsfüggvények referenciája

### Adatkezelés

| Függvény | Leírás |
|---|---|
| `parseRecords(text)` | JSON string → `Dataset`. Kompatibilis a régi tömb formátummal is. |
| `applyDataset(dataset)` | Betölti a Dataset-et: `db` feltöltése, camera alkalmazása, reset. |
| `loadDataSource(record, options?)` | KML/GeoJSON betöltése Cesiumba; idempotens (már betöltöttet nem tölti újra). |
| `ensureAllLoaded()` | Minden `db` rekord betöltése sorban. |
| `resetDataSources()` | Összes DataSource, pin, nyíl eltávolítása. |
| `computeCenter(dataSource, id)` | Polygon/polyline/pont pozíciókból súlyközép számítás; `recordCenters` + `recordRadii` feltöltése. |

### Játéklogika

| Függvény | Leírás |
|---|---|
| `startGame(mode)` | Játék inicializálás: queue, reset, zoom, updateTaskUI. |
| `buildQueue(length, options?)` | Véletlenszerű ID tömb. Options: `keepLastFailed`, `prioritizeFailed`, `allowRepeats`. |
| `currentTarget()` | A `game.queue[game.index]` rekordja. |
| `updateTaskUI()` | HUD frissítés: label, streak/lépés, highlight, opciók render. |
| `handleSelectCorrect()` | Helyes select válasz kezelése: streak++, flash, queue advance. |
| `handleSelectIncorrect()` | Hibás select: streak=0, queue rebuild, flash, lastFailedId set. |
| `advancePinsQueue()` | Queue előrelépés pins módban; queue újraépítés a végén. |
| `handlePinsAttempt(success, dist?, click?, target?, clickedId?)` | Pins kattintás eredmény feldolgozása. |

### Vizuális helpers

| Függvény | Leírás |
|---|---|
| `applyStyles(activeId?)` | Összes DataSource stílusának alkalmazása (aktív/inaktív). |
| `styleRecordGeometry(recordId, activeId?)` | Egyetlen rekord stílusozása. |
| `applyHighlight(activeId?)` | `applyStyles` + select módban pin megjelenítés. |
| `flashRecord(id, color, options?)` | Animált szín villanás CallbackProperty-val. |
| `showArrow(from, to, distKm)` | 50px képernyő-irányú nyíl + távolság felirat. |
| `showPin(recordId, visible)` | Pin entitás megjelenítése/elrejtése. |
| `setGuessPin(position, text)` | Felhasználói tipp pin elhelyezése felirattal. |
| `zoomToAllRecords()` | Összes terület látható legyen; BoundingSphere alapú flyTo. |
| `resetPinsStyles()` | Highlight törlése (aktív ID nélküli applyHighlight). |

### Geometria számítások

| Függvény | Leírás |
|---|---|
| `distanceKm(a, b)` | `EllipsoidGeodesic` alapú felszíni távolság. |
| `isPointInsideRecordPolygon(id, point)` | Ray casting pont-a-poligonban tesztelés (lyukakkal). |
| `closestPolygonBoundaryDistanceKm(id, point)` | Legközelebbi határvonal pont távolsága (20 km-es szegmensenként mintavétel). |
| `closestPolylineDistanceKm(id, point)` | Legközelebbi polyline pont távolsága. |
| `getPolygonRings(id)` | PolygonHierarchy → `Cartographic[][]` (külső + lyukak). |
| `bearingDegrees(from, to)` | Irányszög fokban (0=É, 90=K). |
| `cardinal(deg)` | Irányszög → magyar égtáj rövidítés (É, ÉK, K, DK, D, DNy, Ny, ÉNy). |

---

## 10. UI struktúra és CSS osztályok

```
body.landing-open         – landing overlay látható
body.game-running         – játék fut (player-bar megjelenik)
body.postgame-visible     – győzelmi panel látható
body.mode-editor          – editor nézet aktív
body.mode-player          – player nézet aktív
```

### Fő layout elemek

```
.app-shell
  #landing                – fullscreen landing overlay
  .top-bar                – fejléc (brand + nav + player-bar)
    #player-bar           – HUD (csak játék közben)
      #task-label         – aktuális feladat neve / utasítás
      #status-extra       – streak vagy lépésszámláló
      #feedback           – visszajelzés szöveg (.good / .bad / .neutral)
      #hud-pins           – Gombostűk gomb
      #hud-select         – Nevezd meg! gomb
  .main
    #panel                – bal oldali panel (szerkesztő)
      #editor-view        – szerkesztő form
      #player-view        – player nézet panel (csak select módban aktív)
        #select-mode      – válaszgombok konténer
          #option-list    – 4 db .option-button
    .splitter             – húzható elválasztó
    .map
      #cesiumContainer    – Cesium iframe
.postgame                 – overlay gratuláció panel
```

---

## 11. Hangok

`public/sounds/` könyvtárban MP3 fájlok; `playSound(name)` tölti és játssza le (cache-el).

| Fájl | Mikor szól |
|---|---|
| `start.mp3` | Játék indításakor |
| `correct.mp3` | Helyes válasz (mindkét mód) |
| `wrong.mp3` | Hibás válasz (mindkét mód) |
| `end.mp3` | Játék végén (győzelem / vereség) |
| `nextTask.mp3` | Következő feladatnál (jelenleg nem hívódik automatikusan) |
| `click.mp3` | (jelenleg nem hívódik) |
| `streak.mp3` | (jelenleg nem hívódik – korábban streak>=3 esetén volt) |

---

## 12. Demo feladatsorok

| Fájl | Tartalom |
|---|---|
| `kozepeuropafolyoivizei.json` | Közép-Európa főbb folyóinak vízgyűjtő területei |
| `kozepeuropavarosai.json` | Közép-Európa főbb városai (OSM alapú GeoJSON területek) |
| `magyarorszagkozeptajai.json` | Magyarország 35 középtája KML határokkal |

Demo gombok a landing képernyőn: `<button class="landing-demo" data-demo="/games/<fájlnév>.json">`.

---

## 13. Ismert korlátok

- **CORS:** KML/GeoJSON URL-ről való betöltés sikertelen, ha a forrás szerver nem engedélyezi a cross-origin kérést. Megoldás: fájlként töltsd fel.
- **Overpass proxy csak devben:** Production deployban az OSM Relation import nem működik, hacsak a hosting (pl. Vercel) rewrite szabályt nem tartalmaz.
- **Nincs perzisztencia:** A DB csak memóriában él – oldalfrissítésre elveszik. JSON exporttal menthető.
- **Egyfájlos architektúra:** `src/main.ts` ~1850 sor – bővítés előtt érdemes modularizálni.
- **Nincs tesztkörnyezet:** Nincsenek unit/e2e tesztek.
- **Mobil:** Az UI desktopra optimalizált, mobilon a splitter és az opciógombok korlátosan használhatók.

---

## 14. Bővítési pontok

- **Modulok:** `src/game/`, `src/editor/`, `src/cesium/` könyvtárstruktúra kialakítása
- **Beírós mód:** A `select` módot ki lehetne egészíteni szabad szöveges bevitellel (`aliases` mező már előkészítve)
- **Pontszám/statisztika:** A `GameState`-ben könnyen bővíthető, perzisztencia localStorage-ban
- **Multilang:** A UI string-ek jelenleg hardkódolva magyarok
- **Overpass production proxy:** Vercel `vercel.json` rewrites blokk hozzáadásával megoldható
- **Több egyidejű megjelenített réteg:** A splitter és rétegváltó logika már adott

---

## Gyors fejlesztési referencia

```bash
# Token beállítás
echo "VITE_CESIUM_TOKEN=your_token_here" > .env

# Dev indítás
npm install && npm run dev

# Build ellenőrzés
npm run build

# Új demo JSON hozzáadása
# 1. Helyezd el: public/games/<nev>.json
# 2. Adj hozzá gombot src/main.ts-ben a landing-demo-buttons szekcióhoz:
#    <button class="landing-demo" data-demo="/games/<nev>.json">Felirat</button>
```
