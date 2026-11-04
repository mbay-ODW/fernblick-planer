"""Dateiablage unter PLANER_DATA (Standard /data).

    modell.json                 aktueller Stand (mit meta.version)
    versionen/00042.json        jede Speicherung {version, zeit, wer, notiz, modell}
    varianten/<slug>.json       benannte Varianten {name, zeit, wer, notiz, modell}
    bilder/<id>.<png|jpg>       Screenshots und Renderings, dazu <id>.json mit Metadaten
    auftraege/<id>/             Render-Aufträge: auftrag.json, szene.glb, status.json
    auth.sqlite                 OAuth-Clients und Tokens für den MCP
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from planer import modell as mod

_LOCK = threading.RLock()
MAX_VERSIONEN = 1000


class Konflikt(Exception):
    def __init__(self, aktuell: int):
        super().__init__(f"Das Modell wurde inzwischen geändert (aktuelle Version {aktuell}).")
        self.aktuell = aktuell


class NichtGefunden(Exception):
    pass


def daten() -> Path:
    p = Path(os.environ.get("PLANER_DATA", "/data"))
    for sub in ("versionen", "varianten", "bilder", "auftraege"):
        (p / sub).mkdir(parents=True, exist_ok=True)
    return p


def jetzt() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _schreiben(pfad: Path, inhalt: Any) -> None:
    tmp = pfad.with_suffix(pfad.suffix + ".tmp")
    tmp.write_text(json.dumps(inhalt, ensure_ascii=False, indent=1))
    os.replace(tmp, pfad)


def _seed() -> dict[str, Any]:
    return json.loads((Path(__file__).parent / "seed" / "haus_fernblick.json").read_text())


# ---------------------------------------------------------------------------
# Modell und Versionen
# ---------------------------------------------------------------------------
def modell_lesen(migrieren: bool = True) -> dict[str, Any]:
    with _LOCK:
        p = daten() / "modell.json"
        if not p.exists():
            m = mod.normalisieren(_seed())
            m["meta"]["version"] = 1
            m["meta"]["geaendert_am"] = jetzt()
            m["meta"]["geaendert_von"] = "import"
            _schreiben(p, m)
            _schreiben(daten() / "versionen" / "00001.json",
                       {"version": 1, "zeit": jetzt(), "wer": "import", "notiz": "Import haus_fernblick.json v0.2",
                        "modell": m})
            return m
        m = json.loads(p.read_text())
        if migrieren and int(m.get("meta", {}).get("bibliothek_stand", 1)) < mod.BIBLIOTHEK_STAND:
            # einmalig: neue Katalogvorlagen (z. B. Wandleuchten) ergänzen, als eigene Version
            m = modell_speichern(m, int(m["meta"].get("version", 1)), "migration", "Katalog: Wandleuchten ergänzt")
        return m


def version_aktuell() -> int:
    return int(modell_lesen()["meta"].get("version", 1))


def modell_speichern(neu: dict[str, Any], basis_version: int | None, wer: str, notiz: str = "") -> dict[str, Any]:
    with _LOCK:
        alt = modell_lesen(migrieren=False)
        v = int(alt["meta"].get("version", 1))
        if basis_version is not None and int(basis_version) != v:
            raise Konflikt(v)
        neu = mod.normalisieren(neu)
        fehler = mod.pruefen(neu)
        if fehler:
            raise ValueError("; ".join(fehler[:5]))
        neu["meta"]["version"] = v + 1
        neu["meta"]["geaendert_am"] = jetzt()
        neu["meta"]["geaendert_von"] = wer
        neu["meta"]["notiz"] = notiz
        _schreiben(daten() / "modell.json", neu)
        _schreiben(daten() / "versionen" / f"{v + 1:05d}.json",
                   {"version": v + 1, "zeit": jetzt(), "wer": wer, "notiz": notiz, "modell": neu})
        _aufraeumen_versionen()
        return neu


def aendern(fn: Any, wer: str, notiz: str) -> dict[str, Any]:
    """Liest, ändert (fn bekommt eine Kopie) und speichert atomar – für MCP-Werkzeuge."""
    with _LOCK:
        m = modell_lesen()
        v = int(m["meta"].get("version", 1))
        fn(m)
        return modell_speichern(m, v, wer, notiz)


def _aufraeumen_versionen() -> None:
    dateien = sorted((daten() / "versionen").glob("*.json"))
    for f in dateien[:-MAX_VERSIONEN]:
        f.unlink(missing_ok=True)


def versionen_liste(anzahl: int = 50) -> list[dict[str, Any]]:
    out = []
    for f in sorted((daten() / "versionen").glob("*.json"), reverse=True)[:anzahl]:
        try:
            d = json.loads(f.read_text())
            out.append({"version": d["version"], "zeit": d["zeit"], "wer": d["wer"], "notiz": d.get("notiz", "")})
        except (ValueError, KeyError):
            continue
    return out


def version_lesen(n: int) -> dict[str, Any]:
    f = daten() / "versionen" / f"{int(n):05d}.json"
    if not f.exists():
        raise NichtGefunden(f"Version {n} gibt es nicht (mehr)")
    return json.loads(f.read_text())["modell"]


# ---------------------------------------------------------------------------
# Varianten
# ---------------------------------------------------------------------------
def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9äöüß]+", "-", name.lower()).strip("-")
    return s[:60] or "variante"


def varianten_liste() -> list[dict[str, Any]]:
    out = []
    for f in sorted((daten() / "varianten").glob("*.json")):
        d = json.loads(f.read_text())
        out.append({"slug": f.stem, "name": d["name"], "zeit": d["zeit"], "wer": d["wer"], "notiz": d.get("notiz", ""),
                    "version": d["modell"]["meta"].get("version"), "moebel": len(d["modell"].get("moebel", []))})
    return out


def variante_speichern(name: str, wer: str, notiz: str = "", modell: dict[str, Any] | None = None) -> dict[str, Any]:
    m = modell or modell_lesen()
    d = {"name": name, "zeit": jetzt(), "wer": wer, "notiz": notiz, "modell": m}
    _schreiben(daten() / "varianten" / f"{_slug(name)}.json", d)
    return {"slug": _slug(name), "name": name}


def variante_lesen(slug_oder_name: str) -> dict[str, Any]:
    f = daten() / "varianten" / f"{_slug(slug_oder_name)}.json"
    if not f.exists():
        raise NichtGefunden(f"Variante „{slug_oder_name}“ gibt es nicht")
    return json.loads(f.read_text())


def variante_loeschen(slug_oder_name: str) -> None:
    (daten() / "varianten" / f"{_slug(slug_oder_name)}.json").unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Bilder (Screenshots, Renderings)
# ---------------------------------------------------------------------------
def bild_ablegen(inhalt: bytes, endung: str, meta: dict[str, Any]) -> dict[str, Any]:
    bid = datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)
    endung = "jpg" if endung in ("jpg", "jpeg") else "png"
    (daten() / "bilder" / f"{bid}.{endung}").write_bytes(inhalt)
    meta = {**meta, "id": bid, "datei": f"{bid}.{endung}", "zeit": jetzt()}
    _schreiben(daten() / "bilder" / f"{bid}.json", meta)
    return meta


def bilder_liste(art: str | None = None, anzahl: int = 200) -> list[dict[str, Any]]:
    out = []
    for f in sorted((daten() / "bilder").glob("*.json"), reverse=True):
        try:
            d = json.loads(f.read_text())
        except ValueError:
            continue
        if art and d.get("art") != art:
            continue
        out.append(d)
        if len(out) >= anzahl:
            break
    return out


def bild_pfad(bid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f-]+", bid):
        raise NichtGefunden("Ungültige Bild-ID")
    for e in ("png", "jpg"):
        p = daten() / "bilder" / f"{bid}.{e}"
        if p.exists():
            return p
    raise NichtGefunden("Bild nicht gefunden")


def bild_loeschen(bid: str) -> None:
    p = bild_pfad(bid)
    p.unlink(missing_ok=True)
    p.with_suffix(".json").unlink(missing_ok=True)


def bild_meta_aendern(bid: str, felder: dict[str, Any]) -> dict[str, Any]:
    p = bild_pfad(bid).with_suffix(".json")
    d = json.loads(p.read_text())
    for k in ("titel", "notiz"):
        if k in felder:
            d[k] = str(felder[k])[:300]
    _schreiben(p, d)
    return d


# ---------------------------------------------------------------------------
# Render-Aufträge (bearbeitet vom Worker-Container)
# ---------------------------------------------------------------------------
def auftrag_anlegen(glb: bytes, params: dict[str, Any], wer: str) -> dict[str, Any]:
    aid = datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)
    d = daten() / "auftraege" / aid
    d.mkdir(parents=True)
    (d / "szene.glb").write_bytes(glb)
    _schreiben(d / "auftrag.json", {"id": aid, "wer": wer, "zeit": jetzt(), "params": params})
    _schreiben(d / "status.json", {"status": "wartet", "fortschritt": 0, "zeit": jetzt()})
    return auftrag_lesen(aid)


def auftrag_lesen(aid: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f-]+", aid):
        raise NichtGefunden("Ungültige Auftrags-ID")
    d = daten() / "auftraege" / aid
    if not d.exists():
        raise NichtGefunden("Auftrag nicht gefunden")
    a = json.loads((d / "auftrag.json").read_text())
    try:
        st = json.loads((d / "status.json").read_text())
    except (ValueError, FileNotFoundError):
        st = {"status": "unbekannt"}
    return {"id": aid, "zeit": a["zeit"], "wer": a["wer"], "titel": a["params"].get("titel", ""),
            "aufloesung": a["params"].get("aufloesung"), "samples": a["params"].get("samples"), **st}


def auftraege_liste(anzahl: int = 30) -> list[dict[str, Any]]:
    out = []
    for d in sorted((daten() / "auftraege").iterdir(), reverse=True)[:anzahl]:
        try:
            out.append(auftrag_lesen(d.name))
        except (NichtGefunden, FileNotFoundError, ValueError):
            continue
    return out


def auftrag_abbrechen(aid: str) -> None:
    d = daten() / "auftraege" / aid
    if (d / "status.json").exists():
        st = json.loads((d / "status.json").read_text())
        if st.get("status") in ("wartet", "laeuft"):
            (d / "abbrechen").touch()
            if st["status"] == "wartet":
                _schreiben(d / "status.json", {**st, "status": "abgebrochen", "zeit": jetzt()})


def auftraege_aufraeumen(tage: int = 14) -> None:
    grenze = time.time() - tage * 86400
    for d in (daten() / "auftraege").iterdir():
        if d.stat().st_mtime < grenze:
            for f in d.iterdir():
                f.unlink(missing_ok=True)
            d.rmdir()
