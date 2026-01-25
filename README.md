# Világjáró – Cesium KML játék (MVP)

## Indítás

1. Telepítsd a függőségeket:
   - `npm install`
2. Hozd létre a környezeti változót:
   - Másold a `.env.example` fájlt `.env` néven
   - Írd be a saját Cesium ion tokenedet a `VITE_CESIUM_TOKEN` értékéhez
3. Indítás fejlesztői módban:
   - `npm run dev`

## Használat (röviden)

- **Szerkesztő**: adj meg nevet + KML vagy GeoJSON URL‑t / fájlt, majd `Hozzáadás`.
- **OSM Relation ID**: Overpass alapú import (GeoJSON).
- **JSON mentés/betöltés**: a lista exportálható és importálható.
- **Lejátszó**: válassz játékmódot (kattintós / beírós) és indítsd a játékot.

## Megjegyzés

A KML‑ek betöltése URL‑ről CORS‑tól függhet. Ha URL‑ről nem tölt be, használd a KML fájl feltöltést.
