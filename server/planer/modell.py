"""Hausmodell: Normalisierung, Standardwerte, Möbelbibliothek und Prüfungen.

Koordinaten wie in haus_fernblick.json: Meter, Ursprung Innenecke Nordwest EG, x nach Osten, y nach Süden,
z nach oben ab Fertigfußboden EG. Möbel: ``pos`` = Mittelpunkt, ``masse_bth`` = [Breite, Tiefe, Höhe],
``rot_grad`` dreht um die Hochachse (x' = x·cos − y·sin, y' = x·sin + y·cos).

Ausrichtung (nach der Normalisierung): Bei rot 0 zeigt die Rückseite nach Norden und die Front nach Süden,
bei 90 die Rückseite nach Osten, bei 180 nach Süden, bei 270 nach Westen.
"""

from __future__ import annotations

import copy
import math
import re
import uuid
from typing import Any

# Farbnamen aus dem Modell → Hex (Darstellung). Unbekannte Namen fallen auf Grau zurück.
FARBEN: dict[str, str] = {
    "olivgrün": "#5f6b3c", "oliv": "#5f6b3c", "eiche": "#c39a62", "eiche geölt": "#b98c55", "greige/sand": "#cdbfa8",
    "greige": "#cdbfa8", "beige": "#d6c8b0", "natur/sand": "#ddd0b8", "natur": "#d9ccb4", "schwarz/eiche": "#3a332d",
    "schwarz": "#202020", "grün": "#5f7f45", "grau/schwarz": "#7c7c7c", "weiß": "#f1efea", "weiß/eiche": "#e9e2d4",
    "graugrün": "#8e9a80", "sand": "#d9c9a8", "eiche/schwarz": "#6d5038", "anthrazit": "#3e4043", "grau": "#9a9a9a",
    "cremegrau": "#cfc8bb", "salbei": "#9eae86", "terrakotta": "#b8694a", "blau": "#4a6a8a", "rost": "#9c5a34",
}

ORIENTIERT_WAND = {"sofa", "ecksofa", "ecksofa_kissen", "bett", "bett_einzel", "tagesbett",
                   "kleiderschrank", "schrank", "regal", "regal_niedrig",
                   "tv_board_haengend", "tv_board", "nachttisch", "nachttisch_haengend", "sessel", "schuhbank",
                   "garderobe_lamellen", "wandregal", "spiegel", "spiegel_rund", "sideboard", "kommode",
                   "schreibtisch"}
ORIENTIERT_TISCH = {"stuhl", "esssofa", "bank"}
TISCHE = {"esstisch", "schreibtisch"}

KATEGORIEN = ["Sitzen", "Liegen", "Tische", "Stauraum", "Deko & Textil", "Pflanzen", "Leuchten", "Sonstiges"]


def _v(id_: str, typ: str, name: str, b: float, t: float, h: float, farbe: str, kat: str, material: str = "",
       **extra: Any) -> dict[str, Any]:
    d = {"vorlage_id": id_, "typ": typ, "name": name, "masse_bth": [b, t, h], "farbe": farbe,
         "farbe_hex": farbe_hex(farbe), "material": material, "kategorie": kat}
    d.update(extra)
    return d


def standard_bibliothek() -> list[dict[str, Any]]:
    """Grundbestand an Vorlagen; Claude und die Oberfläche können weitere hinzufügen."""
    return [
        _v("sofa-3er", "sofa", "3er-Sofa", 2.20, 0.95, 0.80, "greige", "Sitzen", "Stoff"),
        _v("sofa-2er", "sofa", "2er-Sofa", 1.70, 0.95, 0.80, "greige", "Sitzen", "Stoff"),
        _v("gullvalla-3er", "sofa", "3er-Sofa GULLVALLA", 1.82, 0.83, 0.78, "greige", "Sitzen", "Stoff"),
        _v("gullvalla-2er", "sofa", "2er-Sofa GULLVALLA", 1.42, 0.83, 0.78, "graugrün", "Sitzen", "Stoff"),
        _v("ecksofa-carryhome", "ecksofa", "Ecksofa mit Recamiere (CARRYHOME)", 2.84, 1.62, 0.85, "greige/sand",
           "Sitzen", "Cord", preis_eur=899),
    ] + ecksofas() + haushalt() + [
        _v("sessel", "sessel", "Sessel", 0.80, 0.80, 0.85, "olivgrün", "Sitzen", "Stoff"),
        _v("sitzsack", "sitzsack", "Sitzsack/Bodenkissen", 0.70, 0.70, 0.45, "sand", "Sitzen", "Cord"),
        _v("stuhl", "stuhl", "Esszimmerstuhl", 0.50, 0.55, 0.85, "olivgrün", "Sitzen", "Stoff abwischbar"),
        _v("esssofa-180", "esssofa", "Esssofa/Polsterbank 180", 1.80, 0.65, 0.80, "olivgrün", "Sitzen"),
        _v("bank-180", "bank", "Sitzbank Eiche 180", 1.80, 0.38, 0.46, "eiche", "Sitzen", "Holz"),
        _v("esstisch-180", "esstisch", "Esstisch 180×90", 0.90, 1.80, 0.75, "eiche geölt", "Tische", "Holz, Kufen schwarz"),
        _v("esstisch-200", "esstisch", "Esstisch 200×100", 1.00, 2.00, 0.75, "eiche geölt", "Tische", "Holz"),
        _v("esstisch-rund", "esstisch_rund", "Esstisch rund Ø 120", 1.20, 1.20, 0.75, "eiche", "Tische", "Holz"),
        _v("couchtisch-rund", "couchtisch_rund", "Couchtisch Ø 70", 0.70, 0.70, 0.40, "eiche", "Tische"),
        _v("couchtisch", "couchtisch", "Couchtisch 100×55", 1.00, 0.55, 0.40, "eiche", "Tische"),
        _v("schreibtisch", "schreibtisch", "Schreibtisch 140×60", 1.40, 0.60, 0.73, "grau/schwarz", "Tische"),
        _v("bett-180", "bett", "Doppelbett 180×200", 1.90, 2.10, 1.10, "beige", "Liegen", "Polster"),
        _v("bett-160", "bett", "Doppelbett 160×200", 1.70, 2.10, 1.05, "beige", "Liegen", "Polster"),
        _v("bett-90", "bett_einzel", "Einzelbett 90×200", 0.97, 2.06, 0.45, "beige", "Liegen"),
        _v("brimnes", "bett_einzel", "Tagesbett BRIMNES 80×200", 0.87, 2.06, 0.45, "beige", "Liegen"),
        _v("kallax-2x2", "faecherregal", "IKEA KALLAX Regal 2×2 weiß (wandmontiert)", 0.77, 0.39, 0.77, "weiß", "Stauraum",
           "Spanplatte weiß", faecher_x=2, faecher_y=2, z=0.9),
        _v("kallax-1x4", "faecherregal", "IKEA KALLAX Regal 1×4 weiß", 0.42, 0.39, 1.47, "weiß", "Stauraum", "Spanplatte weiß",
           faecher_x=1, faecher_y=4),
        _v("kallax-2x4", "faecherregal", "IKEA KALLAX Regal 2×4 weiß", 0.77, 0.39, 1.47, "weiß", "Stauraum", "Spanplatte weiß",
           faecher_x=2, faecher_y=4),
        _v("kallax-4x4", "faecherregal", "IKEA KALLAX Regal 4×4 weiß", 1.47, 0.39, 1.47, "weiß", "Stauraum", "Spanplatte weiß",
           faecher_x=4, faecher_y=4),
        _v("lagkapten-alex-140", "schreibtisch_container", "IKEA LAGKAPTEN/ALEX Schreibtisch 140×60 grau/Holzeffekt schwarz",
           1.40, 0.60, 0.73, "#6f7072", "Tische", "Platte grau, Kante Holz, ALEX grau, Beine schwarz", container="links",
           container_breite=0.36, schubladen=5, kante_farbe="#c9a875", preis_eur=114.98,
           quelle="IKEA 095.853.80 (Murat 06.11.2026)"),
        _v("brimnes-tagesbett", "tagesbett", "IKEA BRIMNES Tagesbett mit 2 Schubladen, weiß", 2.06, 0.87, 0.6, "weiß", "Liegen",
           "Spanplatte weiß", schubladen=2),
        _v("idanaes-180", "bett", "IKEA IDANÄS Polsterbett 180×200 mit Schubladen", 1.90, 2.23, 1.21, "#cfc3a8", "Liegen",
           "Polster beige", beine=0.13, rahmen_hoehe=0.49, schubladen=2, knoepfe=True),
        _v("schlafsofa", "sofa", "Schlafsofa 200", 2.00, 0.95, 0.85, "anthrazit", "Liegen", "Stoff"),
        _v("kleiderschrank-150", "kleiderschrank", "Kleiderschrank 150", 1.50, 0.60, 2.00, "weiß/eiche", "Stauraum"),
        _v("kleiderschrank-100", "kleiderschrank", "Kleiderschrank 100", 1.00, 0.60, 2.00, "weiß", "Stauraum"),
        _v("kleiderstange", "kleiderstange", "Kleiderstange mit Kofferbank", 1.00, 0.45, 1.60, "schwarz", "Stauraum"),
        _v("sideboard", "sideboard", "Sideboard / TV-Lowboard 180", 1.80, 0.40, 0.55, "eiche", "Stauraum"),
        _v("tv-board-haengend", "tv_board_haengend", "TV-Board hängend 180 + TV", 1.80, 0.40, 0.35, "eiche/schwarz",
           "Stauraum", z=0.25),
        _v("regal-niedrig", "regal_niedrig", "Niedriges Regal 200", 2.00, 0.40, 0.60, "eiche", "Stauraum"),
        _v("wandregal-60", "wandregal", "Wandregal 60", 0.60, 0.22, 0.04, "eiche", "Stauraum", z=1.50),
        _v("nachttisch-haengend", "nachttisch_haengend", "Nachttisch hängend", 0.40, 0.30, 0.18, "eiche", "Stauraum",
           z=0.45),
        _v("nachttisch", "nachttisch", "Nachttisch", 0.40, 0.35, 0.50, "eiche", "Stauraum"),
        _v("schuhbank", "schuhbank", "Schuhbank", 1.00, 0.38, 0.50, "schwarz/eiche", "Stauraum"),
        _v("garderobe", "garderobe_lamellen", "Lamellen-Garderobe", 0.90, 0.10, 1.30, "eiche", "Stauraum", z=0.95),
        _v("teppich-200x300", "teppich", "Teppich 200×300", 2.00, 3.00, 0.01, "natur", "Deko & Textil", "Wolle/Jute"),
        _v("teppich-160x230", "teppich", "Teppich 160×230", 1.60, 2.30, 0.01, "natur", "Deko & Textil"),
        _v("laeufer", "teppich", "Läufer 80×200", 0.80, 2.00, 0.01, "natur", "Deko & Textil"),
        _v("spiegel", "spiegel", "Wandspiegel 50×170", 0.50, 0.03, 1.70, "schwarz", "Deko & Textil", z=0.25),
        _v("spiegel-rund", "spiegel_rund", "Runder Spiegel Ø 70", 0.70, 0.03, 0.70, "schwarz", "Deko & Textil", z=1.20),
        _v("bild", "bild", "Bild 70×100", 0.70, 0.03, 1.00, "natur", "Deko & Textil", z=1.20),
        _v("olivenbaum", "pflanze", "Olivenbaum", 0.50, 0.50, 1.60, "grün", "Pflanzen", "Topf Beton"),
        _v("pflanze-gross", "pflanze", "Großpflanze", 0.60, 0.60, 1.80, "grün", "Pflanzen"),
        _v("pflanze-klein", "pflanze", "Kleine Pflanze", 0.35, 0.35, 0.60, "grün", "Pflanzen"),
        _v("stehleuchte", "stehleuchte", "Stehleuchte", 0.35, 0.35, 1.60, "schwarz", "Leuchten", "Metall",
           licht={"lumen": 800, "kelvin": 2700}),
        _v("tischleuchte", "tischleuchte", "Tischleuchte", 0.25, 0.25, 0.45, "schwarz", "Leuchten",
           licht={"lumen": 400, "kelvin": 2700}),
    ] + wandleuchten() + medien()


BIBLIOTHEK_STAND = 14


def ecksofas() -> list[dict[str, Any]]:
    """Ecksofa mit Recamiere rechts bzw. links (von vorn gesehen)."""
    return [
        _v("carryhome-ecksofa-gruen", "ecksofa_kissen", "CARRYHOME Ecksofa Cord Dunkelgrün (Bettkasten)", 2.84, 1.62, 0.95,
           "#1f453b", "Sitzen", "Cord", recamiere="rechts", beine=0.12, rueckenkissen=5, zierkissen=2, preis_eur=899,
           quelle="XXXLutz Art. 0812010305"),
        _v("carryhome-ecksofa-taupe", "ecksofa_kissen", "CARRYHOME Ecksofa Cord Taupe (Bettkasten)", 2.84, 1.62, 0.95,
           "#8a7c6c", "Sitzen", "Cord", recamiere="rechts", beine=0.12, rueckenkissen=5, zierkissen=2, preis_eur=899,
           quelle="XXXLutz Art. 0812010304"),
        _v("ikea-saltsjoebaden-recamiere", "ecksofa", "IKEA SALTSJÖBADEN 3er-Sofa mit Récamiere, Fridtuna hellbeige", 2.33,
           1.32, 0.89, "#d9d1c0", "Sitzen", "Stoff Fridtuna hellbeige", preis_eur=649, recamiere="rechts",
           beine=0.16, arm_breite=0.13, sitztiefe=0.88, arme="beide", beine_farbe="#1a1a1a",
           quelle="IKEA-Maßbild Murat 06.11.2026: 233×88, Récamiere 132, H 89, Sitz 45, Füße 16"),
        _v("ecksofa-recamiere-rechts", "ecksofa", "Ecksofa Recamiere rechts", 2.84, 1.62, 0.85, "greige", "Sitzen", "Stoff",
           recamiere="rechts"),
        _v("ecksofa-recamiere-links", "ecksofa", "Ecksofa Recamiere links", 2.84, 1.62, 0.85, "greige", "Sitzen", "Stoff",
           recamiere="links"),
    ]


def haushalt() -> list[dict[str, Any]]:
    """Haushaltsgeräte und Badmöbel (Standardmaße)."""
    return [
        _v("waschmaschine", "waschmaschine", "Waschmaschine (Frontlader)", 0.60, 0.60, 0.85, "weiß", "Sonstiges", "Lack"),
        _v("trockner", "trockner", "Wäschetrockner", 0.60, 0.65, 0.85, "weiß", "Sonstiges", "Lack"),
        _v("apothekerschrank-bad", "apothekerschrank", "Bad-Apothekerschrank (Vollauszug)", 0.30, 0.45, 1.80, "weiß",
           "Stauraum", "Holz lackiert"),
        _v("haengeschrank-bad-riffel", "haengeschrank", "Bad-Hängeschrank geriffelt 35×27×68", 0.35, 0.272, 0.68,
           "#c8bcae", "Stauraum", "MDF matt, Knauf Messing", z=1.2, front="riffel", griff="links"),
        _v("xora-mehrzweckschrank", "mehrzweckschrank", "Xora Mehrzweckschrank 50/210/67,5 Kaschmir", 0.50, 0.675, 2.10,
           "#d8cdc5", "Stauraum", "Holzwerkstoff, grifflos (Griffmulde)", teilung=1.30, preis_eur=229,
           quelle="XXXLutz Art. 0003011421 (Aktion 229 €, sonst 551 €)"),
        _v("waschmaschinenschrank", "waschmaschinenschrank", "Waschmaschinenschrank Überbau Kaschmir (Maße prüfen)", 0.70,
           0.675, 1.00, "#d8cdc5", "Stauraum", "Holzwerkstoff, grifflos", tueren=2,
           quelle="XXXLutz (Maße geschätzt, Tiefe wie Xora 67,5 cm)"),
        _v("waschmaschinen-unterbau", "waschmaschinen_unterbau", "Waschmaschinen-Unterbau 93,5 Eichenplatte + Seitenschrank",
           0.935, 0.60, 0.885, "weiß", "Stauraum", "Holzwerkstoff weiß, Platte Eiche-Dekor", nische_breite=0.65,
           nische="links", platte_farbe="#c49a64", quelle="Produktbild Murat 06.11.2026: 93,5×60×88,5, Nische 65, Fach 24"),
        _v("haengeschrank-glatt", "haengeschrank", "Hängeschrank glatt 40×30×70", 0.40, 0.30, 0.70, "weiß",
           "Stauraum", "MDF matt", z=1.2),
        _v("haengeschrank-bad-2t-offen", "haengeschrank", "Bad-Hängeschrank 2 Türen + offene Fächer 56×25×75", 0.56, 0.25,
           0.75, "#d9d1c6", "Stauraum", "MDF matt, grifflos", z=1.2, tueren=2, offen_unten=0.21, griff="ohne"),
    ]


def medien() -> list[dict[str, Any]]:
    """Wandfernseher (Breite × Tiefe × Höhe, z = Unterkante)."""
    return [
        _v("tv-55", "tv", "Fernseher 55\" (Wand)", 1.23, 0.04, 0.71, "schwarz", "Sonstiges", "Kunststoff", z=1.0),
        _v("tv-65", "tv", "Fernseher 65\" (Wand)", 1.45, 0.04, 0.83, "schwarz", "Sonstiges", "Kunststoff", z=0.95),
    ]


def wandleuchten() -> list[dict[str, Any]]:
    """Wandleuchten (z = Montagehöhe Unterkante); werden beim Einfügen an die nächste Wand gesetzt."""
    return [
        _v("wandleuchte-updown", "wandleuchte_updown", "Wandleuchte Up/Down", 0.08, 0.10, 0.20, "schwarz", "Leuchten",
           "Metall", z=1.8, licht={"lumen": 600, "kelvin": 2700, "abstrahlwinkel": 30}),
        _v("wandleuchte-schirm", "wandleuchte", "Wandleuchte mit Stoffschirm", 0.25, 0.25, 0.25, "natur", "Leuchten",
           "Stoff/Metall", z=1.6, licht={"lumen": 450, "kelvin": 2700}),
        _v("leseleuchte-wand", "wandleuchte_schwenkarm", "Leseleuchte Wand (Schwenkarm)", 0.15, 0.50, 0.35, "schwarz",
           "Leuchten", "Metall", z=0.9, licht={"lumen": 350, "kelvin": 2700, "abstrahlwinkel": 60}),
        _v("wandspot", "wandspot", "Wandspot (schwenkbar)", 0.10, 0.15, 0.12, "schwarz", "Leuchten", "Metall", z=2.1,
           licht={"lumen": 400, "kelvin": 2700, "winkel_grad": 45, "abstrahlwinkel": 36}),
        _v("bilderleuchte", "bilderleuchte", "Bilderleuchte", 0.60, 0.20, 0.08, "schwarz", "Leuchten", "Metall", z=1.9,
           licht={"lumen": 300, "kelvin": 3000, "abstrahlwinkel": 60}),
    ]


def farbe_hex(farbe: str | None, material: str | None = None) -> str:
    if not farbe:
        return "#a0a0a0"
    f = farbe.strip().lower()
    mat = (material or "").lower()
    if "sichtholz" in mat or "fichte" in f:
        return "#d9b98a"
    if "alu" in mat:
        return "#bdb7ad"
    if re.fullmatch(r"#[0-9a-f]{6}", f):
        return f
    if f in FARBEN:
        return FARBEN[f]
    for k, v in FARBEN.items():
        if f.startswith(k):
            return v
    return "#a0a0a0"


def neue_id(prefix: str = "m") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def geschoss_von(m: dict[str, Any], raeume: dict[str, dict[str, Any]]) -> str:
    if m.get("geschoss"):
        return str(m["geschoss"])
    r = raeume.get(str(m.get("raum", "")))
    return str(r.get("geschoss", "EG")) if r else "EG"


def _abstand_punkt_strecke(px: float, py: float, a: list[float], b: list[float]) -> tuple[float, float, float]:
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    ll = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy), qx, qy


def _fussabdruck(m: dict[str, Any]) -> tuple[float, float]:
    w, d = float(m["masse_bth"][0]), float(m["masse_bth"][1])
    r = int(round(float(m.get("rot_grad", 0)))) % 180
    return (d, w) if r == 90 else (w, d)


def _rot_aus_richtung(dx: float, dy: float) -> int:
    """Rotation, bei der die lokale Rückseite (−y) in Richtung (dx, dy) zeigt."""
    if abs(dx) > abs(dy):
        return 90 if dx > 0 else 270
    return 180 if dy > 0 else 0


def ausrichten(modell: dict[str, Any]) -> None:
    """Einmalig beim Import: Möbel so drehen, dass die Rückseite zur nächsten Wand bzw. die Front zum nächsten
    Tisch zeigt (die Ausgangsdaten haben keine einheitliche Konvention)."""
    raeume = {r["id"]: r for r in modell.get("raeume", [])}
    tische = [m for m in modell.get("moebel", []) if m.get("typ") in TISCHE]
    for m in modell.get("moebel", []):
        typ = m.get("typ", "")
        if typ not in ORIENTIERT_WAND and typ not in ORIENTIERT_TISCH:
            continue
        if typ in ORIENTIERT_WAND and typ == "schreibtisch":
            pass
        fx, fy = _fussabdruck(m)
        px, py = float(m["pos"][0]), float(m["pos"][1])
        if typ in ORIENTIERT_TISCH:
            kand = [t for t in tische if t is not m and geschoss_von(t, raeume) == geschoss_von(m, raeume)]
            if not kand:
                continue
            t = min(kand, key=lambda t: math.hypot(t["pos"][0] - px, t["pos"][1] - py))
            rot = _rot_aus_richtung(px - t["pos"][0], py - t["pos"][1])  # Rückseite weg vom Tisch
        else:
            r = raeume.get(str(m.get("raum", "")))
            if not r:
                continue
            poly = r["polygon"]
            best = None
            for i in range(len(poly)):
                a, b = poly[i], poly[(i + 1) % len(poly)]
                d, qx, qy = _abstand_punkt_strecke(px, py, a, b)
                if best is None or d < best[0]:
                    best = (d, qx - px, qy - py)
            assert best is not None
            rot = _rot_aus_richtung(best[1], best[2])
        # Breite = Ausdehnung entlang der Wand
        if rot in (0, 180):
            w, d = fx, fy
        else:
            w, d = fy, fx
        if typ in ("ecksofa", "ecksofa_kissen"):
            w, d = max(fx, fy), min(fx, fy)
        m["masse_bth"] = [round(w, 3), round(d, 3), m["masse_bth"][2]]
        m["rot_grad"] = rot


def standard_leuchten(modell: dict[str, Any]) -> list[dict[str, Any]]:
    """Platzhalter-Leuchten je Raum (Annahme), damit Abend- und Nachtszenen nicht schwarz sind."""
    out: list[dict[str, Any]] = []
    for r in modell.get("raeume", []):
        xs = [p[0] for p in r["polygon"]]
        ys = [p[1] for p in r["polygon"]]
        g = r.get("geschoss", "EG")
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        if r["id"] == "wohnen":
            cy = (6.525 + max(ys)) / 2
        z = 2.62 if g == "EG" else 2.1  # über Geschossboden
        out.append({"id": f"decke-{r['id']}", "typ": "deckenspot", "name": f"Deckenlicht {r['name']}", "raum": r["id"],
                    "geschoss": g, "pos": [round(cx, 2), round(cy, 2)], "z": z, "lumen": 1200 if r["id"] != "wohnen" else 2000,
                    "kelvin": 2700, "quelle": "Annahme Claude (Platzhalter, Lichtplanung einpflegen)"})
    return out


def normalisieren(modell: dict[str, Any]) -> dict[str, Any]:
    m = copy.deepcopy(modell)
    meta = m.setdefault("meta", {})
    for k in ("raeume", "waende", "oeffnungen", "feste_elemente", "moebel", "leuchten", "offene_fragen"):
        m.setdefault(k, [])
    m.setdefault("oberflaechen", {"standard": {"material": "Rollputz", "farbe": "weiß"}, "flaechen": []})
    m["oberflaechen"].setdefault("flaechen", [])
    std = m["oberflaechen"].setdefault("standard", {"material": "Rollputz", "farbe": "weiß"})
    if not std.get("farbe_hex"):
        std["farbe_hex"] = farbe_hex(std.get("farbe"))
    for i, f in enumerate(m["oberflaechen"]["flaechen"]):
        f.setdefault("id", f"flaeche-{i + 1}")
        if not f.get("farbe_hex"):
            f["farbe_hex"] = farbe_hex(f.get("farbe"), f.get("material"))
    if not meta.get("ausgerichtet"):
        ausrichten(m)
        meta["ausgerichtet"] = True
        meta["ausrichtung"] = ("rot_grad 0 = Rückseite Norden/Front Süden, 90 = Rückseite Osten, 180 = Süden, "
                               "270 = Westen")
    raeume = {r["id"]: r for r in m["raeume"]}
    ids: set[str] = set()
    for x in m["moebel"]:
        if not x.get("id") or x["id"] in ids:
            x["id"] = neue_id()
        ids.add(x["id"])
        x.setdefault("rot_grad", 0)
        x.setdefault("farbe", "")
        x["geschoss"] = geschoss_von(x, raeume)
        if not x.get("farbe_hex"):
            x["farbe_hex"] = farbe_hex(x.get("farbe"))
        x.setdefault("verschiebbar", True)
    # Leuchten: vorhandene behalten (Pendel als 3 Leuchten), Platzhalter ergänzen
    if not meta.get("leuchten_ergaenzt"):
        for le in m["leuchten"]:
            if le.get("typ") == "pendel_cluster":
                le.setdefault("geschoss", "EG")
                le.setdefault("lumen", 3 * 400)
                le.setdefault("kelvin", 2200)
                le.setdefault("name", "Pendel Esstisch (3 Leuchten)")
        vorhandene = {le.get("raum") for le in m["leuchten"] if le.get("typ") != "pendel_cluster"}
        m["leuchten"] += [le for le in standard_leuchten(m) if le["raum"] not in vorhandene]
        meta["leuchten_ergaenzt"] = True
    for le in m["leuchten"]:
        if not le.get("id"):
            le["id"] = neue_id("l")
        le.setdefault("lumen", 800)
        le.setdefault("kelvin", 2700)
        le.setdefault("geschoss", raeume.get(str(le.get("raum")), {}).get("geschoss", "EG"))
    if "szenarien" not in m:
        alle = [le["id"] for le in m["leuchten"]]
        abend = {le["id"]: (1.0 if le.get("typ") == "pendel_cluster" else 0.5) for le in m["leuchten"]
                 if le.get("raum") in ("wohnen", "diele") or le.get("typ") == "pendel_cluster"}
        m["szenarien"] = [
            {"id": "aus", "name": "Licht aus", "leuchten": {}},
            {"id": "abend", "name": "Abend gemütlich", "leuchten": abend},
            {"id": "alles", "name": "Alles an", "leuchten": {i: 1.0 for i in alle}},
        ]
    m.setdefault("ansichten", [
        {"id": "ankommen", "name": "Ankommen (Diele → Wohnraum)", "modus": "3d", "begehen": True,
         "kamera": {"pos": [6.6, 1.65, 4.6], "ziel": [3.0, 1.4, 9.0], "fov": 60}},
        {"id": "esstisch", "name": "Vom Esstisch zur Glasfront", "modus": "3d", "begehen": True,
         "kamera": {"pos": [3.9, 1.5, 7.3], "ziel": [3.6, 1.6, 11.0], "fov": 60}},
        {"id": "galerie", "name": "Von der Galerie in den Luftraum", "modus": "3d", "begehen": True,
         "kamera": {"pos": [6.2, 4.46, 3.0], "ziel": [3.0, 2.0, 9.5], "fov": 60}},
    ])
    m.setdefault("bibliothek", standard_bibliothek())
    if int(meta.get("bibliothek_stand", 1)) < BIBLIOTHEK_STAND:
        vorhanden = {v.get("vorlage_id") for v in m["bibliothek"]}
        m["bibliothek"] += [v for v in wandleuchten() + medien() + ecksofas() + haushalt()
                              if v["vorlage_id"] not in vorhanden]
        meta["bibliothek_stand"] = BIBLIOTHEK_STAND
    m.setdefault("einstellungen", {"breitengrad": 49.654, "laengengrad": 9.077, "datum": "2026-06-21",
                                   "uhrzeit": "17:00", "szenario": "aus", "belichtung": 1.0})
    return m


def pruefen(modell: dict[str, Any]) -> list[str]:
    """Kurze Plausibilitätsprüfung für Schreibzugriffe (kein vollständiges Schema)."""
    fehler: list[str] = []
    for x in modell.get("moebel", []):
        if not isinstance(x.get("pos"), list) or len(x["pos"]) != 2:
            fehler.append(f"Möbel {x.get('id')}: pos fehlt oder ist nicht [x, y]")
        mb = x.get("masse_bth")
        if not isinstance(mb, list) or len(mb) != 3 or any(not isinstance(v, (int, float)) or v < 0 for v in mb):
            fehler.append(f"Möbel {x.get('id')}: masse_bth muss [Breite, Tiefe, Höhe] in Metern sein")
    return fehler


def zusammenfassung(modell: dict[str, Any]) -> dict[str, Any]:
    raeume = modell.get("raeume", [])
    je_raum: dict[str, list[str]] = {}
    for x in modell.get("moebel", []):
        je_raum.setdefault(str(x.get("raum", "?")), []).append(f"{x['id']}: {x.get('name', x.get('typ'))}")
    return {
        "raeume": [{"id": r["id"], "name": r["name"], "geschoss": r.get("geschoss"), "flaeche": r.get("flaeche_plan"),
                    "moebel": je_raum.get(r["id"], [])} for r in raeume],
        "anzahl_moebel": len(modell.get("moebel", [])),
        "leuchten": [f"{le['id']}: {le.get('name', le.get('typ'))}" for le in modell.get("leuchten", [])],
        "szenarien": [s["name"] for s in modell.get("szenarien", [])],
        "ansichten": [f"{a['id']}: {a['name']}" for a in modell.get("ansichten", [])],
        "offene_fragen": modell.get("offene_fragen", []),
    }
