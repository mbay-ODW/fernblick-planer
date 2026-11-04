"""MCP-Server des Fernblick-Planers (Streamable HTTP unter ``/mcp``, zustandslos, Bearer-Token/OAuth).

Jede Änderung speichert eine neue Modellversion (mit „wer“ und Notiz); die offene Planer-Oberfläche lädt sie
automatisch nach.
"""

from __future__ import annotations

import contextvars
import copy
import json
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.types import Receive, Scope, Send

from planer import auth, speicher
from planer import modell as mod

_wer: contextvars.ContextVar[str] = contextvars.ContextVar("planer_wer", default="mcp")

ANLEITUNG = """Fernblick-Planer: internes 3D-Einrichtungsmodell des Ferienhauses Fernblick (Würzberg) für Murat und
Nadja. Im Browser begehbar in 2D/3D, mit Tageszeit, Lichtszenarien und Cycles-Renderings.
Über diesen MCP pflegst du Möbel, Möbelbibliothek, Oberflächen (Wandfarben/-materialien), Leuchten,
Lichtszenarien, Ansichten und Varianten – z. B. aus Fotos, Konzepten oder Renderings, die der Benutzer zeigt.

Koordinaten: Meter; Ursprung Innenecke Nordwest EG; x nach Osten, y nach Süden (Glasfront/Terrasse im Süden),
z nach oben ab Fertigfußboden EG. OG-Fußboden z = 2,81. Haus innen ca. 7,78 × 11,105 m.
Möbel: pos = [x, y] Mittelpunkt im Grundriss, masse_bth = [Breite, Tiefe, Höhe], rot_grad um die Hochachse:
0 = Rückseite nach Norden/Front nach Süden, 90 = Rückseite Osten (Front Westen), 180 = Rückseite Süden,
270 = Rückseite Westen. Breite liegt bei rot 0 entlang x. z (optional) = Unterkante über Geschossboden für
Wandmontiertes (Regale, Spiegel, hängende Nachttische). raum = Raum-ID (schlafen, hwr, bad, diele, wohnen,
kinder, galerie), geschoss = EG/OG. farbe = Name (z. B. „olivgrün“, „Eiche“) oder #rrggbb.
Felder quelle/sicher kennzeichnen, ob etwas gemessen, aus dem Plan abgegriffen oder Konzept ist.

Arbeitsweise: Erst planer_ueberblick oder moebel_liste lesen. Bei Bildern/Renderings: erkannte Möbel mit
plausiblen Maßen (Standardmaße, Herstellerangaben) anlegen, quelle angeben, Kollisionen mit Wänden, Treppe,
Küche und Türen vermeiden. Vor größeren Umbauten variante_speichern, damit der alte Stand erhalten bleibt.
Feste Elemente (Treppe, Küche, Bad-Objekte, Lamellenwand) nur ändern, wenn der Benutzer es ausdrücklich will."""

mcp = FastMCP("fernblick-planer", instructions=ANLEITUNG, stateless_http=True, json_response=True,
              streamable_http_path="/mcp",
              transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))

LESEN = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
SCHREIBEN = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
LOESCHEN = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)

SAMMLUNGEN = ("raeume", "waende", "oeffnungen", "feste_elemente", "moebel", "leuchten", "ansichten", "szenarien",
              "bibliothek")


def _json(x: Any) -> Any:
    return json.loads(json.dumps(x, default=str))


def _aendern(fn: Any, notiz: str) -> dict[str, Any]:
    try:
        m = speicher.aendern(fn, f"mcp:{_wer.get()}", notiz)
    except speicher.Konflikt as e:
        raise ValueError(str(e)) from e
    return {"version": m["meta"]["version"], "notiz": notiz}


def _schluessel(sammlung: str) -> str:
    return "vorlage_id" if sammlung == "bibliothek" else "id"


def _upsert(liste: list[dict[str, Any]], eintraege: list[dict[str, Any]], key: str, prefix: str,
            ersetzen: bool) -> list[str]:
    ids = []
    index = {str(x.get(key)): x for x in liste}
    for e in eintraege:
        e = copy.deepcopy(e)
        if not e.get(key):
            e[key] = mod.neue_id(prefix)
        alt = index.get(str(e[key]))
        if alt is not None and not ersetzen:
            alt.update(e)
            if "farbe" in e and "farbe_hex" not in e:
                alt["farbe_hex"] = mod.farbe_hex(e["farbe"])
        else:
            if alt is not None:
                liste.remove(alt)
            if "farbe" in e and "farbe_hex" not in e:
                e["farbe_hex"] = mod.farbe_hex(e["farbe"])
            liste.append(e)
            index[str(e[key])] = e
        ids.append(str(e[key]))
    return ids


# ---------------------------------------------------------------------------
# Lesen
# ---------------------------------------------------------------------------
@mcp.tool(annotations=LESEN)
def planer_ueberblick() -> dict[str, Any]:
    """Überblick: Version, Räume mit Möbeln, Leuchten, Lichtszenarien, Ansichten, Varianten, offene Fragen und
    die letzten Renderings/Screenshots."""
    m = speicher.modell_lesen()
    return _json({"version": m["meta"].get("version"), "geaendert_am": m["meta"].get("geaendert_am"),
                  "geaendert_von": m["meta"].get("geaendert_von"), **mod.zusammenfassung(m),
                  "varianten": speicher.varianten_liste(),
                  "bilder": [{k: b.get(k) for k in ("id", "art", "titel", "zeit")} for b in speicher.bilder_liste(anzahl=10)],
                  "adresse": auth.basis_url()})


@mcp.tool(annotations=LESEN)
def modell_lesen(teil: str = "") -> Any:
    """Liest das Modell. teil: leer = alles, sonst einer von meta, geschosse, raeume, waende, oeffnungen,
    feste_elemente, moebel, leuchten, szenarien, ansichten, oberflaechen, bibliothek, offene_fragen,
    einstellungen."""
    m = speicher.modell_lesen()
    if not teil:
        return _json(m)
    if teil not in m:
        raise ValueError(f"Unbekannter Teil „{teil}“")
    return _json({teil: m[teil], "version": m["meta"].get("version")})


@mcp.tool(annotations=LESEN)
def moebel_liste(raum: str = "", geschoss: str = "") -> dict[str, Any]:
    """Möbel mit id, Typ, Name, Maßen, Position, Rotation, Farbe, Material, Quelle; optional gefiltert nach raum
    (z. B. wohnen) oder geschoss (EG/OG)."""
    m = speicher.modell_lesen()
    xs = [x for x in m["moebel"] if (not raum or x.get("raum") == raum) and (not geschoss or x.get("geschoss") == geschoss)]
    return _json({"version": m["meta"].get("version"), "moebel": xs})


@mcp.tool(annotations=LESEN)
def bibliothek_liste(kategorie: str = "", suche: str = "") -> dict[str, Any]:
    """Möbelbibliothek (Vorlagen zum Hinzufügen/Austauschen) mit vorlage_id, typ, name, masse_bth, farbe,
    kategorie. Kategorien: Sitzen, Liegen, Tische, Stauraum, Deko & Textil, Pflanzen, Leuchten, Sonstiges."""
    m = speicher.modell_lesen()
    s = suche.lower()
    xs = [v for v in m["bibliothek"] if (not kategorie or v.get("kategorie") == kategorie)
          and (not s or s in json.dumps(v, ensure_ascii=False).lower())]
    return _json({"vorlagen": xs, "typen_mit_eigener_form": sorted({v["typ"] for v in mod.standard_bibliothek()})})


# ---------------------------------------------------------------------------
# Möbel
# ---------------------------------------------------------------------------
@mcp.tool(annotations=SCHREIBEN)
def moebel_setzen(moebel: list[dict[str, Any]], notiz: str = "") -> dict[str, Any]:
    """Legt Möbel an oder ändert sie (nach id; ohne id = neu). Bei Änderungen werden nur die genannten Felder
    überschrieben. Felder: id, raum, geschoss, typ, name, masse_bth [B, T, H], pos [x, y], rot_grad, z, farbe,
    material, quelle, hinweis, preis_eur, link, verschiebbar; ecksofa: recamiere = links/rechts (von vorn gesehen).
    Ein neues Möbel kann mit vorlage_id aus der
    Bibliothek angelegt werden (Maße/Farbe/Typ werden übernommen, eigene Felder gehen vor).
    Gültige Typen mit eigener 3D-Form: sofa, ecksofa, sessel, sitzsack, stuhl, esssofa, bank, esstisch,
    esstisch_rund, couchtisch, couchtisch_rund, schreibtisch, bett, bett_einzel, kleiderschrank, kleiderstange,
    sideboard, tv_board_haengend, regal_niedrig, wandregal, nachttisch, nachttisch_haengend, schuhbank,
    garderobe_lamellen, teppich, spiegel, spiegel_rund, bild, pflanze, stehleuchte, tischleuchte, waschmaschine, trockner,
    apothekerschrank; andere Typen
    werden als Quader gezeigt."""
    def f(m: dict[str, Any]) -> None:
        bib = {v["vorlage_id"]: v for v in m["bibliothek"]}
        fertig = []
        for e in moebel:
            e = dict(e)
            v = bib.get(str(e.pop("vorlage_id", "") or ""))
            if v and not any(x.get("id") == e.get("id") for x in m["moebel"]):
                basis = {k: copy.deepcopy(v[k]) for k in ("typ", "name", "masse_bth", "farbe", "farbe_hex", "material",
                                                           "z", "licht", "preis_eur", "recamiere") if k in v}
                basis["vorlage_id"] = v["vorlage_id"]
                e = {**basis, **e}
            if not e.get("id") and ("pos" not in e or "masse_bth" not in e):
                raise ValueError("Neue Möbel brauchen pos und masse_bth (oder eine vorlage_id)")
            fertig.append(e)
        _upsert(m["moebel"], fertig, "id", "m", ersetzen=False)
    return _aendern(f, notiz or f"MCP: {len(moebel)} Möbel gesetzt")


@mcp.tool(annotations=LOESCHEN)
def moebel_entfernen(ids: list[str], notiz: str = "") -> dict[str, Any]:
    """Entfernt Möbel nach id (frühere Stände bleiben als Version erhalten)."""
    def f(m: dict[str, Any]) -> None:
        vorher = len(m["moebel"])
        m["moebel"] = [x for x in m["moebel"] if x["id"] not in ids]
        if len(m["moebel"]) == vorher:
            raise ValueError("Keine der IDs gefunden")
    return _aendern(f, notiz or f"MCP: {len(ids)} Möbel entfernt")


@mcp.tool(annotations=SCHREIBEN)
def moebel_tauschen(id: str, vorlage_id: str = "", daten: dict[str, Any] | None = None, notiz: str = "") -> dict[str, Any]:
    """Tauscht ein Möbel gegen eine Bibliotheksvorlage oder eigene Daten (typ, name, masse_bth, farbe, material …).
    Position, Rotation, Raum und Geschoss bleiben erhalten."""
    def f(m: dict[str, Any]) -> None:
        x = next((x for x in m["moebel"] if x["id"] == id), None)
        if not x:
            raise ValueError(f"Möbel {id} nicht gefunden")
        neu: dict[str, Any] = {}
        if vorlage_id:
            v = next((v for v in m["bibliothek"] if v["vorlage_id"] == vorlage_id), None)
            if not v:
                raise ValueError(f"Vorlage {vorlage_id} nicht gefunden")
            neu = {k: copy.deepcopy(v[k]) for k in ("typ", "name", "masse_bth", "farbe", "farbe_hex", "material", "z",
                                                     "licht", "preis_eur", "recamiere") if k in v}
            neu["vorlage_id"] = vorlage_id
        neu.update(daten or {})
        for k in ("id", "pos", "rot_grad", "raum", "geschoss"):
            neu.pop(k, None)
        for k in ("z", "licht", "preis_eur", "link"):
            if k not in neu:
                x.pop(k, None)
        x.update(neu)
        if "farbe" in neu and "farbe_hex" not in neu:
            x["farbe_hex"] = mod.farbe_hex(neu["farbe"])
    return _aendern(f, notiz or f"MCP: {id} getauscht")


@mcp.tool(annotations=SCHREIBEN)
def bibliothek_setzen(vorlagen: list[dict[str, Any]], notiz: str = "") -> dict[str, Any]:
    """Legt Bibliotheksvorlagen an oder ändert sie (nach vorlage_id). Felder: vorlage_id, typ, name, masse_bth,
    farbe, material, kategorie, z, preis_eur, link (Produktseite), quelle, licht {lumen, kelvin} für Leuchten."""
    def f(m: dict[str, Any]) -> None:
        for v in vorlagen:
            v.setdefault("kategorie", "Sonstiges")
        _upsert(m["bibliothek"], vorlagen, "vorlage_id", "v", ersetzen=False)
    return _aendern(f, notiz or f"MCP: {len(vorlagen)} Vorlagen gesetzt")


@mcp.tool(annotations=LOESCHEN)
def bibliothek_entfernen(vorlage_ids: list[str]) -> dict[str, Any]:
    """Entfernt Vorlagen aus der Möbelbibliothek (platzierte Möbel bleiben)."""
    def f(m: dict[str, Any]) -> None:
        m["bibliothek"] = [v for v in m["bibliothek"] if v["vorlage_id"] not in vorlage_ids]
    return _aendern(f, f"MCP: {len(vorlage_ids)} Vorlagen entfernt")


# ---------------------------------------------------------------------------
# Oberflächen, Licht, Ansichten
# ---------------------------------------------------------------------------
@mcp.tool(annotations=SCHREIBEN)
def oberflaeche_setzen(flaechen: list[dict[str, Any]], standard: dict[str, Any] | None = None,
                       notiz: str = "") -> dict[str, Any]:
    """Wandoberflächen setzen/ändern (nach id). Eintrag: id, geschoss, wand (Wand-ID aus waende), seite
    (Nord/Süd/Ost/West = Seite der Wand, auf der die Fläche liegt), optional x [von, bis] oder y [von, bis] und
    z [von, bis] als Ausschnitt, material (Rollputz, Sichtholz, Aluverbundplatte, Fliese, Farbe, Tapete),
    farbe (Name oder #rrggbb), quelle. standard = {material, farbe} für alle übrigen Wände."""
    def f(m: dict[str, Any]) -> None:
        o = m["oberflaechen"]
        if standard:
            o["standard"] = {**o.get("standard", {}), **standard}
        wand_ids = {w["id"] for w in m["waende"]}
        for fl in flaechen:
            if fl.get("wand") and fl["wand"] not in wand_ids:
                raise ValueError(f"Wand {fl['wand']} gibt es nicht")
            if fl.get("farbe"):
                fl.setdefault("farbe_hex", mod.farbe_hex(fl["farbe"]) if mod.farbe_hex(fl["farbe"]) != "#a0a0a0" else "")
        _upsert(o["flaechen"], flaechen, "id", "fl", ersetzen=False)
    return _aendern(f, notiz or "MCP: Oberflächen")


@mcp.tool(annotations=SCHREIBEN)
def leuchten_setzen(leuchten: list[dict[str, Any]], notiz: str = "") -> dict[str, Any]:
    """Leuchten anlegen/ändern (nach id). Felder: id, name, typ (deckenspot, pendel, pendel_cluster, wandleuchte,
    stehleuchte, tischleuchte, led_streifen, strahler, stromschiene), raum, geschoss, pos [x, y], z (Höhe der Lichtquelle
    über Geschossboden), lumen (gesamt), kelvin (2200–4000), laenge (nur led_streifen, m), richtung (wandleuchte: N/O/S/W =
    Wand, an der sie hängt), quelle (z. B. „Lichtplanung 25.05.2026“).
    Linienleuchten (stromschiene, led_streifen) statt pos über einen Verlauf: an="pfette" mit bereich [y von, y bis];
    oder wand=<Wand-ID> + seite (Nord/Ost/Süd/West) entlang der Wandoberkante (folgt der Dachschräge), abstand_oben,
    abstand_wand, bereich [u von, u bis]; oder pfad [[x, y, z], …]. stromschiene: anzahl Spots, abstrahlwinkel (Grad),
    neigung (0 = senkrecht, ~0,7 = schräg), ausrichtung ("unten" Standard, "oben" = indirekt ins Gebälk)."""
    def f(m: dict[str, Any]) -> None:
        _upsert(m["leuchten"], leuchten, "id", "l", ersetzen=False)
    return _aendern(f, notiz or f"MCP: {len(leuchten)} Leuchten")


@mcp.tool(annotations=LOESCHEN)
def leuchten_entfernen(ids: list[str]) -> dict[str, Any]:
    """Entfernt Leuchten (auch aus allen Szenarien)."""
    def f(m: dict[str, Any]) -> None:
        m["leuchten"] = [le for le in m["leuchten"] if le["id"] not in ids]
        for s in m["szenarien"]:
            for i in ids:
                s["leuchten"].pop(i, None)
    return _aendern(f, f"MCP: {len(ids)} Leuchten entfernt")


@mcp.tool(annotations=SCHREIBEN)
def szenario_setzen(id: str, name: str = "", leuchten: dict[str, float] | None = None, notiz: str = "") -> dict[str, Any]:
    """Lichtszenario anlegen/ändern: leuchten = {leuchten_id: Helligkeit 0..1}; nicht genannte sind aus."""
    def f(m: dict[str, Any]) -> None:
        s = next((s for s in m["szenarien"] if s["id"] == id), None)
        if not s:
            s = {"id": id, "name": name or id, "leuchten": {}}
            m["szenarien"].append(s)
        if name:
            s["name"] = name
        if leuchten is not None:
            s["leuchten"] = {k: max(0.0, min(1.0, float(v))) for k, v in leuchten.items()}
    return _aendern(f, notiz or f"MCP: Szenario {id}")


@mcp.tool(annotations=SCHREIBEN)
def ansicht_setzen(id: str, name: str, pos: list[float], ziel: list[float], fov: float = 60,
                   begehen: bool = True) -> dict[str, Any]:
    """Gespeicherte Kameraansicht (für Screenshots/Renderings). pos/ziel in Modellkoordinaten [x, y, z]
    (Augenhöhe EG 1,65; OG 2,81 + 1,65)."""
    def f(m: dict[str, Any]) -> None:
        a = {"id": id, "name": name, "modus": "3d", "begehen": begehen,
             "kamera": {"pos": [pos[0], pos[2], pos[1]], "ziel": [ziel[0], ziel[2], ziel[1]], "fov": fov}}
        _upsert(m["ansichten"], [a], "id", "a", ersetzen=True)
    return _aendern(f, f"MCP: Ansicht {name}")


# ---------------------------------------------------------------------------
# Bauteile, offene Fragen, Varianten, Versionen
# ---------------------------------------------------------------------------
@mcp.tool(annotations=SCHREIBEN)
def bauteil_setzen(sammlung: str, eintraege: list[dict[str, Any]], notiz: str = "") -> dict[str, Any]:
    """Korrigiert Bauteile nach id: sammlung = raeume, waende, oeffnungen oder feste_elemente. Nur auf
    ausdrücklichen Wunsch (z. B. neue Maße aus einem Plan). Felder wie im Modell (modell_lesen).
    Lamellenwand (waende, typ lamellen): lamellen = {anzahl, breite, tiefe, abstand} in m (breite entlang der Wand,
    abstand = lichte Weite); mit anzahl ist die Länge anzahl·breite + (anzahl−1)·abstand ab „von“ – „bis“ passend setzen.
    Öffnungen (typ tuer): aufschlag = Raum-ID, in den die Tür aufschlägt."""
    if sammlung not in ("raeume", "waende", "oeffnungen", "feste_elemente"):
        raise ValueError("sammlung muss raeume, waende, oeffnungen oder feste_elemente sein")

    def f(m: dict[str, Any]) -> None:
        _upsert(m[sammlung], eintraege, "id", sammlung[:2], ersetzen=False)
    return _aendern(f, notiz or f"MCP: {sammlung} geändert")


@mcp.tool(annotations=LOESCHEN)
def bauteil_entfernen(sammlung: str, ids: list[str]) -> dict[str, Any]:
    """Entfernt Bauteile (raeume, waende, oeffnungen, feste_elemente) nach id."""
    if sammlung not in ("raeume", "waende", "oeffnungen", "feste_elemente"):
        raise ValueError("Ungültige Sammlung")

    def f(m: dict[str, Any]) -> None:
        m[sammlung] = [x for x in m[sammlung] if x.get("id") not in ids]
    return _aendern(f, f"MCP: {len(ids)} {sammlung} entfernt")


@mcp.tool(annotations=SCHREIBEN)
def offene_fragen_setzen(fragen: list[str]) -> dict[str, Any]:
    """Ersetzt die Liste offener Fragen/Klärungen."""
    def f(m: dict[str, Any]) -> None:
        m["offene_fragen"] = [str(q) for q in fragen]
    return _aendern(f, "MCP: offene Fragen")


@mcp.tool(annotations=LESEN)
def varianten_liste() -> list[dict[str, Any]]:
    """Gespeicherte Varianten (z. B. „Wohnen Variante D“)."""
    return _json(speicher.varianten_liste())


@mcp.tool(annotations=SCHREIBEN)
def variante_speichern(name: str, notiz: str = "") -> dict[str, Any]:
    """Speichert den aktuellen Stand als benannte Variante (überschreibt eine gleichnamige)."""
    return _json(speicher.variante_speichern(name, f"mcp:{_wer.get()}", notiz))


@mcp.tool(annotations=SCHREIBEN)
def variante_laden(name: str) -> dict[str, Any]:
    """Macht eine Variante zum aktuellen Stand (der bisherige Stand bleibt als Version erhalten)."""
    v = speicher.variante_lesen(name)

    def f(m: dict[str, Any]) -> None:
        m.clear()
        m.update(copy.deepcopy(v["modell"]))
    return _aendern(f, f"MCP: Variante „{v['name']}“ geladen")


@mcp.tool(annotations=LESEN)
def versionen_liste(anzahl: int = 30) -> list[dict[str, Any]]:
    """Letzte gespeicherte Versionen mit Zeit, wer und Notiz."""
    return speicher.versionen_liste(anzahl)


@mcp.tool(annotations=SCHREIBEN)
def version_wiederherstellen(version: int) -> dict[str, Any]:
    """Stellt eine frühere Version als neuen aktuellen Stand wieder her."""
    alt = speicher.version_lesen(version)

    def f(m: dict[str, Any]) -> None:
        m.clear()
        m.update(copy.deepcopy(alt))
    return _aendern(f, f"MCP: Version {version} wiederhergestellt")


@mcp.tool(annotations=LESEN)
def bilder_liste(art: str = "", anzahl: int = 20) -> list[dict[str, Any]]:
    """Screenshots und Renderings (art: screenshot | render) mit Titel, Zeit, Ansicht und Link (nur im Browser
    nach Anmeldung abrufbar)."""
    b = auth.basis_url()
    return _json([{**x, "url": f"{b}/api/bilder/{x['id']}"} for x in speicher.bilder_liste(art or None, anzahl)])


# ---------------------------------------------------------------------------
# Endpunkt
# ---------------------------------------------------------------------------
class McpEndpunkt:
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        a = headers.get("authorization", "")
        wer = auth.token_pruefen(a[7:].strip()) if a.lower().startswith("bearer ") else None
        if not wer:
            meta = f"{auth.basis_url()}/.well-known/oauth-protected-resource"
            await send({"type": "http.response.start", "status": 401, "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", f'Bearer resource_metadata="{meta}"'.encode())]})
            await send({"type": "http.response.body",
                        "body": b'{"error":"invalid_token","error_description":"Anmeldung erforderlich"}'})
            return
        t = _wer.set(wer)
        try:
            await mcp.session_manager.handle_request(scope, receive, send)
        finally:
            _wer.reset(t)


def session_manager_starten():  # type: ignore[no-untyped-def]
    mcp._session_manager = None
    mcp.streamable_http_app()
    return mcp.session_manager.run()


def werkzeuge() -> list[str]:
    return sorted(t.name for t in mcp._tool_manager.list_tools())
