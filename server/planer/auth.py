"""Anmeldung.

Oberfläche und REST-API: Traefik + Authelia setzen ``Remote-User``. Der Header wird nur akzeptiert, wenn die Anfrage
von einer vertrauenswürdigen Adresse kommt (PLANER_TRUSTED_PROXIES: IPs oder Hostnamen, z. B. „traefik“; leer = jeder,
nur für die Entwicklung) und – falls gesetzt – der Benutzer in PLANER_ALLOWED_USERS steht.

MCP: OAuth 2.1 mit Dynamic Client Registration und PKCE für claude.ai. ``/oauth/authorize`` liegt hinter Authelia;
der angemeldete Benutzer bestätigt den Zugriff. Gespeichert werden nur SHA-256-Hashes (SQLite unter PLANER_DATA).
Zusätzlich optional ein statisches Token (PLANER_MCP_TOKEN) für Skripte.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException, Request

from planer import speicher

ACCESS_SEK = 8 * 3600
REFRESH_SEK = 90 * 86400
_vertraut_cache: tuple[float, set[str]] = (0.0, set())


def basis_url() -> str:
    return os.environ.get("PLANER_PUBLIC_URL", "http://localhost:8000").rstrip("/")


def _vertraute_ips() -> set[str] | None:
    global _vertraut_cache
    roh = os.environ.get("PLANER_TRUSTED_PROXIES", "").strip()
    if not roh:
        return None
    if time.time() - _vertraut_cache[0] < 60:
        return _vertraut_cache[1]
    ips: set[str] = set()
    for teil in roh.replace(",", " ").split():
        try:
            for info in socket.getaddrinfo(teil, None):
                ips.add(str(info[4][0]))
        except OSError:
            ips.add(teil)
    _vertraut_cache = (time.time(), ips)
    return ips


def benutzer_aus_proxy(request: Request) -> str | None:
    dev = os.environ.get("PLANER_DEV_USER")
    if dev:
        return dev
    wer = request.headers.get("remote-user")
    if not wer:
        return None
    ips = _vertraute_ips()
    if ips is not None and (request.client is None or request.client.host not in ips):
        return None
    erlaubt = [u.strip() for u in os.environ.get("PLANER_ALLOWED_USERS", "").replace(",", " ").split() if u.strip()]
    if erlaubt and wer not in erlaubt:
        raise HTTPException(403, f"Benutzer {wer} ist für den Planer nicht freigeschaltet")
    return wer


def angemeldet(request: Request) -> str:
    wer = benutzer_aus_proxy(request)
    if wer:
        return wer
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        w = token_pruefen(auth[7:].strip())
        if w:
            return w
    raise HTTPException(401, "Nicht angemeldet")


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------
@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    con = sqlite3.connect(speicher.daten() / "auth.sqlite", timeout=10)
    con.row_factory = sqlite3.Row
    con.executescript("""
      create table if not exists client (client_id text primary key, name text, redirect_uris text, erstellt real);
      create table if not exists code (hash text primary key, client_id text, redirect_uri text, challenge text,
                                       benutzer text, gueltig_bis real, benutzt integer default 0);
      create table if not exists token (hash text primary key, art text, benutzer text, client_id text,
                                        gueltig_bis real, widerrufen integer default 0, erstellt real);
    """)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _geheimnis() -> bytes:
    p = speicher.daten() / "schluessel"
    if not p.exists():
        p.write_text(secrets.token_urlsafe(48))
        p.chmod(0o600)
    return p.read_text().strip().encode()


def token_pruefen(klartext: str) -> str | None:
    if not klartext:
        return None
    statisch = os.environ.get("PLANER_MCP_TOKEN", "")
    if statisch and hmac.compare_digest(klartext, statisch):
        return "mcp-token"
    with db() as con:
        r = con.execute("select * from token where hash=?", (_hash(klartext),)).fetchone()
    if not r or r["widerrufen"] or r["art"] != "access" or (r["gueltig_bis"] and r["gueltig_bis"] < time.time()):
        return None
    return str(r["benutzer"])


def metadaten() -> dict[str, Any]:
    b = basis_url()
    return {"issuer": b, "authorization_endpoint": f"{b}/oauth/authorize", "token_endpoint": f"{b}/oauth/token",
            "registration_endpoint": f"{b}/oauth/register", "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["planer"]}


def ressource_metadaten() -> dict[str, Any]:
    b = basis_url()
    return {"resource": f"{b}/mcp", "authorization_servers": [b], "bearer_methods_supported": ["header"],
            "scopes_supported": ["planer"], "resource_name": "Fernblick-Planer"}


def _uri_ok(u: str) -> bool:
    return u.startswith("https://") or u.startswith("http://localhost") or u.startswith("http://127.0.0.1")


def client_registrieren(daten: dict[str, Any]) -> dict[str, Any]:
    uris = daten.get("redirect_uris") or []
    if not uris or not all(isinstance(u, str) and _uri_ok(u) for u in uris):
        raise ValueError("redirect_uris fehlen oder sind nicht https")
    cid = "planer-" + secrets.token_urlsafe(16)
    name = str(daten.get("client_name") or "MCP-Client")[:200]
    with db() as con:
        con.execute("insert into client values (?,?,?,?)", (cid, name, json.dumps(uris), time.time()))
    return {"client_id": cid, "client_name": name, "redirect_uris": uris, "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            "client_id_issued_at": int(time.time())}


def client_pruefen(client_id: str, redirect_uri: str) -> str:
    with db() as con:
        r = con.execute("select * from client where client_id=?", (client_id,)).fetchone()
    if not r:
        raise ValueError("Unbekannter Client")
    if redirect_uri not in json.loads(r["redirect_uris"]):
        raise ValueError("redirect_uri ist für diesen Client nicht registriert")
    return str(r["name"])


def _sig(*teile: str) -> str:
    return hmac.new(_geheimnis(), "|".join(teile).encode(), hashlib.sha256).hexdigest()


def formular_signatur(*teile: str) -> str:
    st = str(int(time.time()))
    return f"{st}.{_sig(*teile, st)}"


def formular_pruefen(sig: str, *teile: str) -> bool:
    try:
        st, wert = sig.split(".", 1)
        if time.time() - int(st) > 900:
            return False
    except ValueError:
        return False
    return hmac.compare_digest(wert, _sig(*teile, st))


def code_ausstellen(client_id: str, redirect_uri: str, challenge: str, benutzer: str) -> str:
    code = secrets.token_urlsafe(32)
    with db() as con:
        con.execute("insert into code values (?,?,?,?,?,?,0)",
                    (_hash(code), client_id, redirect_uri, challenge, benutzer, time.time() + 300))
    return code


def _paar(con: sqlite3.Connection, client_id: str, benutzer: str) -> dict[str, Any]:
    access, refresh = "pl_" + secrets.token_urlsafe(32), "plr_" + secrets.token_urlsafe(32)
    jetzt = time.time()
    con.execute("insert into token values (?,?,?,?,?,0,?)", (_hash(access), "access", benutzer, client_id,
                                                             jetzt + ACCESS_SEK, jetzt))
    con.execute("insert into token values (?,?,?,?,?,0,?)", (_hash(refresh), "refresh", benutzer, client_id,
                                                             jetzt + REFRESH_SEK, jetzt))
    con.execute("delete from token where gueltig_bis < ?", (jetzt - 7 * 86400,))
    return {"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_SEK, "refresh_token": refresh,
            "scope": "planer"}


def token_tausch(form: dict[str, str]) -> dict[str, Any]:
    gt = form.get("grant_type")
    with db() as con:
        if gt == "authorization_code":
            c = con.execute("select * from code where hash=?", (_hash(form.get("code", "")),)).fetchone()
            if not c or c["benutzt"] or c["gueltig_bis"] < time.time():
                raise ValueError("invalid_grant")
            if c["client_id"] != form.get("client_id") or c["redirect_uri"] != form.get("redirect_uri"):
                raise ValueError("invalid_grant")
            v = form.get("code_verifier", "")
            erwartet = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
            if not v or not hmac.compare_digest(erwartet, c["challenge"]):
                raise ValueError("invalid_grant")
            con.execute("update code set benutzt=1 where hash=?", (c["hash"],))
            return _paar(con, c["client_id"], c["benutzer"])
        if gt == "refresh_token":
            t = con.execute("select * from token where hash=?", (_hash(form.get("refresh_token", "")),)).fetchone()
            if not t or t["art"] != "refresh" or t["widerrufen"] or t["gueltig_bis"] < time.time():
                raise ValueError("invalid_grant")
            if form.get("client_id") and form["client_id"] != t["client_id"]:
                raise ValueError("invalid_grant")
            con.execute("update token set widerrufen=1 where hash=?", (t["hash"],))
            return _paar(con, t["client_id"], t["benutzer"])
    raise ValueError("unsupported_grant_type")
