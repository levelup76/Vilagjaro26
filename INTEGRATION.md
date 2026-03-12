# Világjáró — 7streak integrációs útmutató

> **Röviden:** a `VilagjároGameMode` class egyetlen container elementet kap, betölti a térképet, kezeli a teljes játéklogikát, és eseményeken keresztül kommunikál a 7streak gazdaalkalmzással. A gazda **semmi mást nem csinál**, csak figyeli az eseményeket és frissíti a saját HUD-ját.

---

## 1. Könyvtárstruktúra (amit a 7streakbe kell másolni)

```
vilagjaro/                  ← bemásold a 7streak repo-ba, pl. src/games/vilagjaro/
├── src/
│   ├── vilagjaro-adapter.ts   ← EZ a belépési pont — ezt importáld
│   ├── ol-map-engine.ts       ← OpenLayers implementáció (belső)
│   ├── map-engine.ts          ← engine-agnosztikus típusok (belső)
│   └── style.css              ← alapstílusok (OL reset + UI komponensek)
└── public/
    ├── games/                 ← beépített demó adatkészletek
    │   ├── kozepeuropafolyoivizei.json
    │   ├── kozepeuropavarosai.json
    │   └── magyarorszagkozeptajai.json
    └── sounds/                ← hangfájlok (mp3) — opcionálisan használja a gazda
```

---

## 2. Függőségek

A 7streak `package.json`-ba add hozzá:

```json
{
  "dependencies": {
    "ol": "^10.8.0",
    "osmtogeojson": "^3.0.0-beta.5"
  }
}
```

> A `vilagjaro-adapter.ts` ezeken kívül semmit nem igényel — nincs React/Vue/Svelte függőség.

---

## 3. Gyors start (minimális integráció)

```typescript
import { VilagjároGameMode } from '@/games/vilagjaro/src/vilagjaro-adapter'

// 1. Példányosítás
const vjr = new VilagjároGameMode()

// 2. Betöltés egy DOM-elembe (a class kezeli az összes belső HTML-t)
vjr.mount(document.getElementById('game-host')!)

// 3. Dataset betöltése (JSON string VAGY fetch-elt szöveg)
await vjr.loadDataset('/games/magyarorszagkozeptajai.json')
// VAGY: await vjr.loadDataset(await fetch('/games/...').then(r => r.text()))
// VAGY: await vjr.loadDataset(parsedDatasetObject)

// 4. 7streak eseménykezelők regisztrálása
vjr.on('answer:correct',  ({ streak })         => hud.showStreak(streak))
vjr.on('answer:wrong',    ({ correctName })     => hud.showHint(correctName))
vjr.on('round:end',       ({ won, score })      => hud.showResult(won, score))
vjr.on('question:change', ({ targetName })      => hud.setQuestion(targetName))

// 5. Kör indítása
await vjr.startRound('select')   // 7-streak mód
// await vjr.startRound('pins')  // 12 kattintásos elhelyezős mód

// 6. Tear-down (amikor a 7streak kiszedi a játékot)
vjr.destroy()
```

---

## 4. API referencia

### `VilagjároGameMode`

| Metódus | Leírás |
|---------|--------|
| `mount(container: HTMLElement)` | Betölti a térképet a megadott elembe. **Mindenképpen első lépés.** |
| `destroy()` | Teljes tear-down: megszünteti a térképet, törli a DOM-ot, törli az event listenereket. |
| `loadDataset(input: Dataset \| string)` | Dataset betöltése. Hívható `mount()` előtt és után is. |
| `startRound(mode?: 'select' \| 'pins')` | Új kör indítása. Visszaállítja a teljes állapotot. |
| `submitAnswer(recordId: string)` | Válasz beküldése **select módban**. (Pins módban a térkép-kattintás automatikus.) |
| `on(event, handler)` | Esemény-feliratkozás. |
| `off(event, handler)` | Esemény-leiratkozás. |

---

## 5. Esemény-referencia

### `answer:correct` → `AnswerCorrectPayload`

```typescript
interface AnswerCorrectPayload {
  correctId:   string   // a helyes rekord UUID-je
  correctName: string   // megjelenítendő neve
  streak:      number   // jelenlegi sorozat hossza (select módban)
  distanceKm?: number   // kattintástól való távolság km-ben (csak pins módban)
}
```

### `answer:wrong` → `AnswerWrongPayload`

```typescript
interface AnswerWrongPayload {
  correctId:   string          // a helyes rekord UUID-je
  correctName: string          // megjelenítendő neve
  streak:      0               // mindig 0 — sorozat megszakadt
  distanceKm?: number          // kattintástól való távolság km-ben (pins)
  direction?:  string          // égtáj a helyes irányba, pl. 'ÉK' (pins)
}
```

### `round:end` → `RoundEndPayload`

```typescript
interface RoundEndPayload {
  mode:     'select' | 'pins'
  score:    number   // select: elért streak (max 7) | pins: találatok (max 12)
  maxScore: number   // 7 (select) | 12 (pins)
  won:      boolean  // true = nyert (select: streak===7 | pins: found>=6)
}
```

### `question:change` → `QuestionPayload`

```typescript
interface QuestionPayload {
  targetId:     string                         // aktív rekord ID
  targetName:   string                         // megjelenítendő neve
  options?:     Array<{ id: string; name: string }>  // 4 lehetőség (csak select módban)
  streak:       number                         // jelenlegi sorozat
  attemptsLeft: number                         // remaining attempts (pins)
  found:        number                         // helyes találatok eddig (pins)
}
```

> **Megjegyzés:** a `question:change` esemény **saját opció-gombokat** is tartalmaz (`options`), de a Világjáró **belső UI-ja is renderel gombokat** alapból. Ha a 7streak saját gombokat akar renderelni, akkor a beépített gombokat CSS-sel elrejtheti (`.vjr-options { display: none !important }`), és maga kezeli a `submitAnswer()` hívásokat.

---

## 6. Játékmódok

### `'select'` — Nevezd meg! (7-streak)

- A térkép egy véletlenszerű területet **kiemel** (narancssárga kitöltés + gombostű).
- 4 gomb jelenik meg alatta — a játékos rákattint az egyikre.
- **Helyes:** `streak++`, flash zöld, következő kérdés.
- **Rossz:** `streak = 0`, flash piros, újraindított sorrend (az elhibázott elsőként jön).
- **Kör vége:** `streak === 7` → `round:end` `{ won: true }`.

### `'pins'` — Gombostű mód

- A HUD megmutatja a keresett terület **nevét**, a játékos rákattint a térképen.
- **Helyes:** a terület zölden villan, következő kérdés.
- **Mellé:** piros villantás + **navigációs nyíl** a helyes irányba, az állapot megmarad.
- **Kör vége:** 12 kísérlet elfogyása → `round:end` `{ won: found >= 6 }`.

---

## 7. Dataset formátum (`.json`)

```jsonc
{
  "title": "Magyarország középtájai",
  "description": "Opcionális leírás",
  "camera": {
    "longitude": 19.5,   // decimal degrees
    "latitude":  47.1,
    "height":    900000  // méteres magasság (zoom szinthez konvertálva)
  },
  "items": [
    {
      "id":           "uuid-v4-vagy-elhagyható",
      "name":         "Dunántúli-középhegység",
      "customName":   "Opcionális megjelenítési név",
      "aliases":      ["dunantuli kozephegyseg"],
      "toleranceKm":  30,
      "format":       "kml",       // "kml" | "geojson"
      "dataType":     "url",       // "url" | "text"
      "data":         "https://..."
    }
  ]
}
```

**Egyszerűsített (text/KML):**
```jsonc
{
  "items": [
    {
      "name":     "Alföld",
      "format":   "geojson",
      "dataType": "text",
      "data":     "{ \"type\": \"FeatureCollection\", ... }"
    }
  ]
}
```

> Az adapter visszafelé kompatibilis a régi Cesium-korszak `kml`/`kmlType` mezőivel és a radiánban tárolt kamera-értékekkel.

---

## 8. CSS hook-ok

A beépített belső elemek a következő osztályokat kapják — a 7streak ezekre stílusokat írhat felül:

| Osztály | Elem |
|---------|------|
| `.vjr-question-bar` | Feladatsor fejléc (pl. „Mutasd meg: Alföld") |
| `.vjr-map` | A térkép wrapper div-je |
| `.vjr-options` | Opció-gombok konténere (select mód) |
| `.vjr-option-btn` | Egy-egy opció-gomb |

**Minimális override példa (Tailwind / plain CSS):**
```css
.vjr-question-bar {
  font-family: var(--font-game);
  background: var(--color-surface);
}
.vjr-option-btn {
  border-color: var(--color-accent);
}
```

---

## 9. Hang-integráció

A Világjáró adapter **nem játszik hangot** — ez a 7streak feladata. Az alábbi eseményekre érdemes hangot indítani:

| Esemény | Ajánlott hang |
|---------|---------------|
| `startRound()` hívás előtt | `start.mp3` |
| `answer:correct` | `correct.mp3` |
| `answer:wrong` | `wrong.mp3` |
| `answer:correct` és `payload.streak >= 3` | `streak.mp3` |
| `round:end` és `won === true` | `streak.mp3` |
| `round:end` és `won === false` | `end.mp3` |

A hangfájlok elérhetők a `public/sounds/` könyvtárban.

---

## 10. Teljes integrációs példa (7streak plugin registry)

```typescript
// src/games/registry.ts
import type { SevenStreakPlugin } from './vilagjaro/src/vilagjaro-adapter'
import { VilagjároGameMode }       from './vilagjaro/src/vilagjaro-adapter'

export const GAME_PLUGINS: Record<string, () => SevenStreakPlugin> = {
  vilagjaro: () => new VilagjároGameMode(),
  // további játékmódok...
}
```

```typescript
// src/GameHost.ts — leegyszerűsített 7streak host
import { GAME_PLUGINS }  from './games/registry'
import type { SevenStreakPlugin, RoundEndPayload } from './games/vilagjaro/src/vilagjaro-adapter'

export class GameHost {
  private plugin: SevenStreakPlugin | null = null

  async launch(pluginId: string, datasetUrl: string, container: HTMLElement) {
    // Előző játék tear-down
    this.plugin?.destroy()

    const plugin = GAME_PLUGINS[pluginId]?.()
    if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`)

    plugin.mount(container)
    await plugin.loadDataset(await fetch(datasetUrl).then(r => r.text()))

    // 7streak saját HUD-ja
    plugin.on('answer:correct',  ({ streak }) => this.hud.setStreak(streak))
    plugin.on('answer:wrong',    (e)          => this.hud.hint(e.direction, e.distanceKm))
    plugin.on('round:end',       (e)          => this.onRoundEnd(e))
    plugin.on('question:change', (e)          => this.hud.setQuestion(e.targetName, e.streak))

    await plugin.startRound('select')
    this.plugin = plugin
  }

  private onRoundEnd(e: RoundEndPayload) {
    if (e.won) {
      this.hud.showVictory(e.score, e.maxScore)
      this.streakSystem.recordWin('vilagjaro')
    } else {
      this.hud.showDefeat(e.score, e.maxScore)
    }
  }

  // Select mód — a 7streak saját opció-gombok esetén
  submitAnswer(recordId: string) {
    this.plugin?.submitAnswer(recordId)
  }

  destroy() {
    this.plugin?.destroy()
    this.plugin = null
  }
}
```

---

## 11. Ismert korlátok / fejlesztési lehetőségek

| Téma | Megjegyzés |
|------|-----------|
| **Hang** | Az adapter nem kezeli — a 7streak feladata (ld. 9. fejezet). |
| **Térkép tile-szerver** | Alapból OpenStreetMap tiles-t használ. Cserélhető az `OLMapEngine` konstruktorban. |
| **OSM import** | A szerkesztő UI Overpass proxy-t igényel (`/overpass/...`). A játék módhoz ez nem szükséges. |
| **Mobilos pinch-zoom** | OpenLayers alapból támogatja, nem igényel külön konfigurációt. |
| **SSR / Next.js** | Az OL map csak böngészőben működik. Dinamikusan importáld: `const { VilagjároGameMode } = await import(...)` |
