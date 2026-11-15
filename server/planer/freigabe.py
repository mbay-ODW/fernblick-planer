"""Freigabe-Links: passwortgeschützte Nur-Lese-Ansicht des Hauses für Externe (z. B. Zimmerer, Familie).

Jeder Link hat ein eigenes Kennwort (PBKDF2-Hash) und optional ein Ablaufdatum und eine feste Variante.
Nach der Anmeldung setzt der Server ein signiertes Cookie, das nur für den Pfad dieses Links gilt.
Über den Link ist ausschließlich das Lesen des (gefilterten) Modells möglich, nie ein Schreibzugriff.
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import secrets
import time
from datetime import date
from typing import Any

from planer import auth, speicher

SITZUNG_SEK = 12 * 3600
_fehlversuche: dict[str, list[float]] = {}


def _datei() -> Any:
    return speicher.daten() / "freigaben.json"


def _lesen() -> list[dict[str, Any]]:
    p = _datei()
    return json.loads(p.read_text()) if p.exists() else []


def _schreiben(liste: list[dict[str, Any]]) -> None:
    p = _datei()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(liste, ensure_ascii=False, indent=1))
    tmp.replace(p)
    p.chmod(0o600)


def _hash(kennwort: str, salz: bytes | None = None) -> str:
    salz = salz or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", kennwort.encode(), salz, 300_000)
    return f"pbkdf2${salz.hex()}${h.hex()}"


def _kennwort_ok(kennwort: str, gespeichert: str) -> bool:
    try:
        _, salz, _h = gespeichert.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash(kennwort, bytes.fromhex(salz)), gespeichert)


def _oeffentlich(f: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in f.items() if k != "kennwort_hash"}


def liste() -> list[dict[str, Any]]:
    return [_oeffentlich(f) for f in _lesen()]


def anlegen(name: str, kennwort: str, wer: str, ablauf: str | None = None, variante: str | None = None,
            preise: bool = False) -> dict[str, Any]:
    name = name.strip()
    if not name:
        raise ValueError("Name fehlt")
    if len(kennwort) < 8:
        raise ValueError("Kennwort zu kurz (mindestens 8 Zeichen)")
    if ablauf:
        date.fromisoformat(ablauf)
    if variante:
        speicher.variante_lesen(variante)
    f = {"id": secrets.token_urlsafe(16), "name": name, "kennwort_hash": _hash(kennwort), "ablauf": ablauf or None,
         "variante": variante or None, "preise": bool(preise), "aktiv": True, "erstellt": speicher.jetzt(),
         "erstellt_von": wer, "zuletzt": None, "aufrufe": 0}
    alle = _lesen()
    alle.append(f)
    _schreiben(alle)
    return _oeffentlich(f)


def aendern(fid: str, felder: dict[str, Any]) -> dict[str, Any]:
    alle = _lesen()
    f = next((x for x in alle if x["id"] == fid), None)
    if not f:
        raise speicher.NichtGefunden(f"Freigabe {fid} nicht gefunden")
    for k in ("name", "ablauf", "variante", "preise", "aktiv"):
        if k in felder:
            f[k] = felder[k] or (False if k in ("preise", "aktiv") else None)
    if f.get("ablauf"):
        date.fromisoformat(f["ablauf"])
    if f.get("variante"):
        speicher.variante_lesen(f["variante"])
    if felder.get("kennwort"):
        if len(felder["kennwort"]) < 8:
            raise ValueError("Kennwort zu kurz (mindestens 8 Zeichen)")
        f["kennwort_hash"] = _hash(felder["kennwort"])
    _schreiben(alle)
    return _oeffentlich(f)


def loeschen(fid: str) -> None:
    alle = _lesen()
    neu = [x for x in alle if x["id"] != fid]
    if len(neu) == len(alle):
        raise speicher.NichtGefunden(f"Freigabe {fid} nicht gefunden")
    _schreiben(neu)


def gueltig(fid: str) -> dict[str, Any] | None:
    """Freigabe, wenn vorhanden, aktiv und nicht abgelaufen."""
    f = next((x for x in _lesen() if x["id"] == fid), None)
    if not f or not f.get("aktiv"):
        return None
    if f.get("ablauf") and date.fromisoformat(f["ablauf"]) < date.today():
        return None
    return f


def gesperrt(fid: str, ip: str) -> bool:
    k = f"{fid}|{ip}"
    jetzt = time.time()
    _fehlversuche[k] = [t for t in _fehlversuche.get(k, []) if jetzt - t < 900]
    return len(_fehlversuche[k]) >= 5


def anmelden(fid: str, kennwort: str, ip: str) -> str | None:
    """Prüft das Kennwort; liefert den Cookie-Wert oder None. Nach 5 Fehlversuchen 15 min Sperre je IP."""
    f = gueltig(fid)
    if not f or gesperrt(fid, ip):
        return None
    if not _kennwort_ok(kennwort, f["kennwort_hash"]):
        _fehlversuche.setdefault(f"{fid}|{ip}", []).append(time.time())
        return None
    _fehlversuche.pop(f"{fid}|{ip}", None)
    alle = _lesen()
    for x in alle:
        if x["id"] == fid:
            x["zuletzt"] = speicher.jetzt()
            x["aufrufe"] = int(x.get("aufrufe", 0)) + 1
    _schreiben(alle)
    bis = str(int(time.time()) + SITZUNG_SEK)
    # Kennwort-Hash fließt ein: neues Kennwort beendet alle offenen Sitzungen
    return f"{bis}.{auth._sig('teilen', fid, bis, f['kennwort_hash'])}"


def sitzung_ok(fid: str, wert: str | None) -> dict[str, Any] | None:
    f = gueltig(fid)
    if not f or not wert:
        return None
    try:
        bis, sig = wert.split(".", 1)
        if int(bis) < time.time():
            return None
    except ValueError:
        return None
    return f if hmac.compare_digest(sig, auth._sig("teilen", fid, bis, f["kennwort_hash"])) else None


def modell_fuer(f: dict[str, Any]) -> dict[str, Any]:
    """Modell für die Ansicht: feste Variante oder aktueller Stand, ohne interne Planungsdaten."""
    m = copy.deepcopy(speicher.variante_lesen(f["variante"])["modell"] if f.get("variante") else speicher.modell_lesen())
    for x in m.get("moebel", []):
        for k in ("quelle", "hinweis", "sicher", "vorlage_id"):
            x.pop(k, None)
        if not f.get("preise"):
            x.pop("preis_eur", None)
            x.pop("link", None)
    m["bibliothek"] = []
    m["offene_fragen"] = []
    meta = m.get("meta", {})
    m["meta"] = {"version": meta.get("version", 0), "titel": meta.get("titel", "Ferienhaus Fernblick")}
    m["freigabe"] = {"name": f["name"], "variante": f.get("variante")}
    return m
