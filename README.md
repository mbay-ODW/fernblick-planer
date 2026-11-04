# Fernblick-Planer

Interne Planungsansicht für das Ferienhaus Fernblick (Murat und Nadja): begehbares 3D-Modell mit Möbeln,
Farben, Licht und Tageszeit, 2D-Grundriss, echte Renderings mit Blender Cycles und ein MCP für Claude.

**Adresse:** `https://<PLANER_HOST>` (hinter Forward-Auth, z. B. Authelia) · **MCP:** `https://<PLANER_HOST>/mcp` (OAuth)

## Oberfläche

Umschalter oben: **Plan 2D · 3D · Rendering**

- **Plan 2D** – Grundriss EG/OG (Norden oben) mit Wänden, Öffnungen, Küche/Bad, Treppe, Luftraum und Kopfhöhe 2,00 m
  unter der Schräge. Möbel ziehen (5-cm-Raster, Alt = 1 cm), am Griff drehen (15°, Umschalt = frei), Maßketten zur
  nächsten Wand.
- **3D** – *Umschauen* (Dollhouse; EG/OG/Alles, Dach ein/aus) oder *Begehen* (W A S D, ziehen = umsehen, Doppelklick =
  Maus fangen, Klick auf Boden = hingehen, Treppe begehbar). Möbel anklicken und ziehen.
- **Rendering** – links die Live-Ansicht mit Formatrahmen, rechts Cycles-Renderings mit Vergleichsregler
  (Live ↔ Cycles), Aufträge mit Fortschritt, Galerie für Renderings und Screenshots.

Seitenleiste: Möbel (mit Kollisionshinweisen), Katalog (hinzufügen/tauschen), Farben (Pinsel für Wandseiten und
Böden), Licht (Datum, Uhrzeit, Szenarien, Dimmer, Belichtung), Ansichten (speichern, alle fotografieren/rendern),
Stände (Varianten, Versionen, offene Fragen). Tasten: R/Q/E drehen, Entf löschen, Strg+D duplizieren, Strg+Z/Y.

Jede Änderung wird automatisch als neue Version gespeichert. Änderungen über den MCP erscheinen nach wenigen Sekunden;
bei gleichzeitigen Änderungen fragt die Oberfläche nach.

## Aufbau

```
server/planer/   FastAPI (REST, OAuth 2.1 + DCR/PKCE, MCP unter /mcp), Dateiablage, Render-Worker (bpy)
server/planer/seed/haus_fernblick.json   Ausgangsmodell v0.2 (wird beim ersten Start importiert)
web/             Vite + TypeScript + three.js 0.169
deploy/          Compose-Stack (Portainer) und .env.example
```

Koordinaten: Meter, Ursprung Innenecke Nordwest EG, x nach Osten, y nach Süden, z nach oben; OG-Fußboden 2,81.
Möbel: `pos` Mitte, `masse_bth` Breite/Tiefe/Höhe, `rot_grad` 0 = Rückseite Nord, 90 = Ost, 180 = Süd, 270 = West,
`z` = Unterkante über Geschossboden.

Renderings: Der Browser exportiert die sichtbare Szene als GLB samt Kamera, Sonnenstand und aktiven Leuchten;
der Worker-Container rendert mit Cycles (CPU, OpenImageDenoise). Himmel physikalisch (Multiple Scattering) plus
Sonnenlampe aus einer kalibrierten Tabelle, Leuchten mit lm/683 W, Belichtung per Vorab-Durchgang.

## Entwicklung

```bash
cd server && pip install -e ".[dev]" bpy==5.2.3 numpy && pytest
PLANER_DATA=./daten PLANER_DEV_USER=murat uvicorn planer.app:app --reload
cd web && npm ci && npm run dev        # Proxy auf :8000
python -m planer.render_worker         # Worker (gleiches PLANER_DATA)
```

## Betrieb

Image `ghcr.io/<owner>/fernblick-planer:sha-<commit>` aus GitHub Actions. Stack `deploy/docker-compose.yml`:
`app` (uvicorn hinter Traefik) und `worker` (Cycles, ohne Netz, CPU-Limit). Alle umgebungsspezifischen Werte
(Domain, Datenpfad, Traefik-Netz, Zertifikats-Resolver, Middlewares, Benutzer) kommen aus Variablen –
Vorlage: `deploy/.env.example`. Im Repo stehen keine Werte einer konkreten Installation.
