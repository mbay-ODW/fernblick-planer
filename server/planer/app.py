"""FastAPI-App: Oberfläche (statisch), REST-API, OAuth und MCP in einem Prozess."""

from __future__ import annotations

import hmac
import html
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.routing import Route

from planer import auth, freigabe, speicher
from planer.mcp_server import McpEndpunkt, session_manager_starten, werkzeuge

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
WEB = Path(os.environ.get("PLANER_WEB", Path(__file__).resolve().parents[2] / "web" / "dist"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    speicher.modell_lesen()
    async with session_manager_starten():
        yield


app = FastAPI(title="Fernblick-Planer", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(speicher.NichtGefunden)
async def _nf(request: Request, e: speicher.NichtGefunden) -> JSONResponse:
    return JSONResponse({"detail": str(e)}, status_code=404)


@app.exception_handler(speicher.Konflikt)
async def _konflikt(request: Request, e: speicher.Konflikt) -> JSONResponse:
    return JSONResponse({"detail": str(e), "aktuell": e.aktuell}, status_code=409)


@app.exception_handler(ValueError)
async def _wert(request: Request, e: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "version": speicher.version_aktuell(), "werkzeuge": len(werkzeuge()),
            "build": os.environ.get("PLANER_BUILD", "dev")}


@app.get("/api/ich")
def ich(wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return {"benutzer": wer, "mcp_url": f"{auth.basis_url()}/mcp", "build": os.environ.get("PLANER_BUILD", "dev")}


# --- Modell -------------------------------------------------------------------
@app.get("/api/modell")
def modell(wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.modell_lesen()


@app.get("/api/modell/version")
def modell_version(wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    m = speicher.modell_lesen()["meta"]
    return {"version": m.get("version"), "geaendert_von": m.get("geaendert_von"), "notiz": m.get("notiz", "")}


@app.put("/api/modell")
def modell_speichern(daten: dict[str, Any] = Body(...), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    m = speicher.modell_speichern(daten["modell"], daten.get("basis_version"), wer, str(daten.get("notiz", ""))[:200])
    return {"version": m["meta"]["version"]}


@app.get("/api/versionen")
def versionen(wer: str = Depends(auth.angemeldet)) -> list[dict[str, Any]]:
    return speicher.versionen_liste(100)


@app.get("/api/versionen/{n}")
def version(n: int, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.version_lesen(n)


@app.get("/api/varianten")
def varianten(wer: str = Depends(auth.angemeldet)) -> list[dict[str, Any]]:
    return speicher.varianten_liste()


@app.post("/api/varianten")
def variante_neu(daten: dict[str, Any] = Body(...), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    name = str(daten.get("name", "")).strip()
    if not name:
        raise HTTPException(400, "Name fehlt")
    return speicher.variante_speichern(name, wer, str(daten.get("notiz", "")), daten.get("modell"))


@app.get("/api/varianten/{slug}")
def variante(slug: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.variante_lesen(slug)


@app.delete("/api/varianten/{slug}")
def variante_loeschen(slug: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    speicher.variante_loeschen(slug)
    return {"ok": True}


# --- Bilder -------------------------------------------------------------------
@app.get("/api/bilder")
def bilder(art: str | None = None, wer: str = Depends(auth.angemeldet)) -> list[dict[str, Any]]:
    return speicher.bilder_liste(art)


@app.post("/api/bilder")
async def bild_hochladen(datei: UploadFile = File(...), titel: str = Form(""), art: str = Form("screenshot"),
                         modus: str = Form(""), kamera: str = Form(""), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    inhalt = await datei.read()
    if len(inhalt) > 25_000_000:
        raise HTTPException(413, "Bild zu groß")
    endung = "jpg" if (datei.content_type or "").endswith("jpeg") else "png"
    return speicher.bild_ablegen(inhalt, endung, {"titel": titel[:200], "art": art, "modus": modus, "kamera": kamera,
                                                  "wer": wer, "modell_version": speicher.version_aktuell()})


@app.get("/api/bilder/{bid}")
def bild(bid: str, download: bool = False, wer: str = Depends(auth.angemeldet)) -> FileResponse:
    p = speicher.bild_pfad(bid)
    return FileResponse(p, filename=p.name if download else None,
                        headers={"Cache-Control": "private, max-age=86400"})


@app.patch("/api/bilder/{bid}")
def bild_aendern(bid: str, daten: dict[str, Any] = Body(...), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.bild_meta_aendern(bid, daten)


@app.delete("/api/bilder/{bid}")
def bild_loeschen(bid: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    speicher.bild_loeschen(bid)
    return {"ok": True}


# --- Renderings ---------------------------------------------------------------
@app.post("/api/render")
async def render_neu(szene: UploadFile = File(...), params: str = Form(...),
                     wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    import json

    glb = await szene.read()
    if len(glb) > 200_000_000:
        raise HTTPException(413, "Szene zu groß")
    p = json.loads(params)
    return speicher.auftrag_anlegen(glb, p, wer)


@app.get("/api/render")
def render_liste(wer: str = Depends(auth.angemeldet)) -> list[dict[str, Any]]:
    return speicher.auftraege_liste()


@app.get("/api/render/{aid}")
def render_status(aid: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.auftrag_lesen(aid)


@app.delete("/api/render/{aid}")
def render_abbrechen(aid: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    speicher.auftrag_abbrechen(aid)
    return {"ok": True}


# --- OAuth für MCP ---------------------------------------------------------------
@app.get("/.well-known/oauth-authorization-server")
def oauth_meta() -> dict[str, Any]:
    return auth.metadaten()


@app.get("/.well-known/oauth-protected-resource")
@app.get("/.well-known/oauth-protected-resource/mcp")
def oauth_ressource() -> dict[str, Any]:
    return auth.ressource_metadaten()


@app.post("/oauth/register")
def oauth_register(daten: dict[str, Any] = Body(...)) -> JSONResponse:
    try:
        return JSONResponse(auth.client_registrieren(daten), status_code=201)
    except ValueError as e:
        return JSONResponse({"error": "invalid_client_metadata", "error_description": str(e)}, status_code=400)


@app.post("/oauth/token")
async def oauth_token(request: Request) -> JSONResponse:
    form = {k: str(v) for k, v in (await request.form()).items()}
    try:
        return JSONResponse(auth.token_tausch(form), headers={"Cache-Control": "no-store"})
    except ValueError as e:
        fehler = str(e) if str(e) in ("invalid_grant", "unsupported_grant_type") else "invalid_request"
        return JSONResponse({"error": fehler, "error_description": str(e)}, status_code=400)


_SEITE = """<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zugriff erlauben – Fernblick-Planer</title><style>
body{{font-family:system-ui,sans-serif;background:#E8E9E1;color:#1F1F1F;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}}
.k{{background:#fff;padding:28px;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,.08)}}
h1{{color:#24383A;font-size:1.3rem;margin-top:0}}button{{font:inherit;padding:10px 18px;border:0;cursor:pointer;margin-right:8px}}
.ja{{background:#24383A;color:#fff}}.nein{{background:#D9DCD3}}small{{color:#666}}</style></head><body><div class="k">
<h1>Zugriff auf den Fernblick-Planer</h1>
<p><b>{client}</b> möchte im Namen von <b>{benutzer}</b> Möbel, Oberflächen, Leuchten und Varianten im Einrichtungsmodell lesen und ändern.</p>
<p><small>Weiterleitung an {host}.</small></p>
<form method="post" action="/oauth/authorize">{felder}
<button class="ja" name="entscheidung" value="ja">Erlauben</button><button class="nein" name="entscheidung" value="nein">Ablehnen</button>
</form></div></body></html>"""


@app.get("/oauth/authorize", response_class=HTMLResponse)
def oauth_authorize(request: Request, response_type: str = "", client_id: str = "", redirect_uri: str = "",
                    code_challenge: str = "", code_challenge_method: str = "", state: str = "") -> Response:
    benutzer = auth.benutzer_aus_proxy(request)
    if not benutzer:
        raise HTTPException(401, "Bitte über Authelia anmelden")
    try:
        name = auth.client_pruefen(client_id, redirect_uri)
    except ValueError as e:
        return HTMLResponse(f"<p>Fehler: {html.escape(str(e))}</p>", status_code=400)
    if response_type != "code" or code_challenge_method != "S256" or not code_challenge:
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': 'invalid_request', 'state': state})}", 302)
    sig = auth.formular_signatur(benutzer, client_id, redirect_uri, code_challenge)
    felder = "".join(f'<input type="hidden" name="{k}" value="{html.escape(v)}">' for k, v in {
        "client_id": client_id, "redirect_uri": redirect_uri, "code_challenge": code_challenge, "state": state,
        "sig": sig}.items())
    from urllib.parse import urlparse

    return HTMLResponse(_SEITE.format(client=html.escape(name), benutzer=html.escape(benutzer),
                                      host=html.escape(urlparse(redirect_uri).netloc), felder=felder))


@app.post("/oauth/authorize")
def oauth_authorize_post(request: Request, client_id: str = Form(...), redirect_uri: str = Form(...),
                         code_challenge: str = Form(...), state: str = Form(""), sig: str = Form(...),
                         entscheidung: str = Form("nein")) -> Response:
    benutzer = auth.benutzer_aus_proxy(request)
    if not benutzer:
        raise HTTPException(401, "Bitte über Authelia anmelden")
    try:
        auth.client_pruefen(client_id, redirect_uri)
    except ValueError as e:
        return HTMLResponse(f"<p>Fehler: {html.escape(str(e))}</p>", status_code=400)
    if not auth.formular_pruefen(sig, benutzer, client_id, redirect_uri, code_challenge):
        return HTMLResponse("<p>Formular abgelaufen, bitte erneut verbinden.</p>", status_code=400)
    if entscheidung != "ja":
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': 'access_denied', 'state': state})}", 302)
    code = auth.code_ausstellen(client_id, redirect_uri, code_challenge, benutzer)
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}", 302)


app.router.routes.append(Route("/mcp", endpoint=McpEndpunkt(), methods=["GET", "POST", "DELETE"]))

# --- Spielwelt für fernblick-spiele ------------------------------------------------
@app.get("/api/spielwelt")
def spielwelt_stand(wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return speicher.spielwelt_meta()


@app.post("/api/spielwelt")
async def spielwelt_uebergeben(haus: UploadFile = File(...), welt: str = Form(...),
                               wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    glb = await haus.read()
    if glb[:4] != b"glTF":
        raise ValueError("keine GLB-Datei")
    return speicher.spielwelt_ablegen(glb, json.loads(welt), wer)


def _spielwelt_token(request: Request) -> None:
    soll = os.environ.get("PLANER_SPIELWELT_TOKEN", "")
    ist = request.headers.get("authorization", "")
    if not soll or not hmac.compare_digest(ist.encode(), f"Bearer {soll}".encode()):
        raise HTTPException(401, "Token fehlt oder ist falsch")


@app.get("/spielwelt/{datei}", include_in_schema=False)
def spielwelt_datei(datei: str, request: Request) -> Response:
    _spielwelt_token(request)
    if datei not in ("meta.json", "haus.glb", "welt.json"):
        raise HTTPException(404)
    if datei == "meta.json":
        return JSONResponse(speicher.spielwelt_meta())
    p = speicher.daten() / "spielwelt" / datei
    if not p.exists():
        raise HTTPException(404, "Noch keine Spielwelt übergeben")
    return FileResponse(p, media_type="model/gltf-binary" if datei.endswith(".glb") else "application/json")


# --- Freigabe-Links (Nur-Lese-Ansicht für Externe) ---------------------------------
@app.get("/api/freigaben")
def freigaben(wer: str = Depends(auth.angemeldet)) -> list[dict[str, Any]]:
    return freigabe.liste()


@app.post("/api/freigaben")
def freigabe_neu(daten: dict[str, Any] = Body(...), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return freigabe.anlegen(str(daten.get("name", "")), str(daten.get("kennwort", "")), wer, daten.get("ablauf"),
                            daten.get("variante"), bool(daten.get("preise")))


@app.patch("/api/freigaben/{fid}")
def freigabe_aendern(fid: str, daten: dict[str, Any] = Body(...), wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    return freigabe.aendern(fid, daten)


@app.delete("/api/freigaben/{fid}")
def freigabe_loeschen(fid: str, wer: str = Depends(auth.angemeldet)) -> dict[str, Any]:
    freigabe.loeschen(fid)
    return {"ok": True}


def _client_ip(request: Request) -> str:
    ip = request.client.host if request.client else "?"
    vertraut = auth._vertraute_ips()
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd and (vertraut is None or ip in vertraut):
        return fwd.split(",")[0].strip()
    return ip


def _teilen_cookie(fid: str) -> str:
    return f"fb_teilen_{fid}"


def _anmeldeseite(fid: str, fehler: str = "", status: int = 200) -> HTMLResponse:
    f = freigabe.gueltig(fid)
    if not f:
        return HTMLResponse("<!doctype html><meta charset=utf-8><title>Fernblick</title><p style='font-family:sans-serif'>"
                            "Dieser Link ist nicht (mehr) gültig.</p>", status_code=404)
    hinweis = f"<p class=f>{html.escape(fehler)}</p>" if fehler else ""
    return HTMLResponse(f"""<!doctype html><html lang=de><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex>
<title>Ferienhaus Fernblick</title><style>
body{{font-family:system-ui,sans-serif;background:#f4f1ea;color:#2f3a2c;display:grid;place-items:center;min-height:100vh;margin:0}}
form{{background:#fff;padding:28px 26px;border-radius:14px;box-shadow:0 6px 30px #0001;width:min(340px,90vw)}}
h1{{font-size:20px;margin:0 0 4px}}p{{margin:0 0 18px;color:#6b6a60;font-size:14px}}
input{{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cfcabd;border-radius:8px;font-size:16px}}
button{{margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#3f5a36;color:#fff;font-size:16px}}
.f{{color:#b03a2e;margin:10px 0 0}}</style></head><body>
<form method=post action="/teilen/{fid}/anmelden"><h1>Ferienhaus Fernblick</h1>
<p>3D-Ansicht für {html.escape(f["name"])} – bitte Kennwort eingeben.</p>
<input type=password name=kennwort autocomplete=current-password autofocus required>{hinweis}
<button>Ansehen</button></form></body></html>""", status_code=status, headers={"Cache-Control": "no-store"})


def _teilen_sitzung(fid: str, request: Request) -> dict[str, Any]:
    f = freigabe.sitzung_ok(fid, request.cookies.get(_teilen_cookie(fid)))
    if not f:
        raise HTTPException(401, "Bitte Kennwort eingeben")
    return f


@app.post("/teilen/{fid}/anmelden", include_in_schema=False)
def teilen_anmelden(fid: str, request: Request, kennwort: str = Form("")) -> Response:
    ip = _client_ip(request)
    if freigabe.gesperrt(fid, ip):
        return _anmeldeseite(fid, "Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.", 429)
    wert = freigabe.anmelden(fid, kennwort, ip)
    if not wert:
        return _anmeldeseite(fid, "Kennwort falsch.", 401)
    r = RedirectResponse(f"/teilen/{fid}/", 303)
    r.set_cookie(_teilen_cookie(fid), wert, max_age=freigabe.SITZUNG_SEK, path=f"/teilen/{fid}", httponly=True,
                 secure=auth.basis_url().startswith("https"), samesite="lax")
    return r


@app.get("/teilen/{fid}/api/modell", include_in_schema=False)
def teilen_modell(fid: str, request: Request) -> dict[str, Any]:
    return freigabe.modell_fuer(_teilen_sitzung(fid, request))


@app.get("/teilen/{fid}/api/modell/version", include_in_schema=False)
def teilen_version(fid: str, request: Request) -> dict[str, Any]:
    f = _teilen_sitzung(fid, request)
    return {"version": freigabe.modell_fuer(f)["meta"]["version"]}


@app.get("/teilen/{fid}", include_in_schema=False)
@app.get("/teilen/{fid}/", include_in_schema=False)
def teilen_seite(fid: str, request: Request) -> Response:
    if not freigabe.sitzung_ok(fid, request.cookies.get(_teilen_cookie(fid))):
        return _anmeldeseite(fid)
    if not request.url.path.endswith("/"):
        return RedirectResponse(f"/teilen/{fid}/", 307)
    if not (WEB / "index.html").exists():
        return HTMLResponse("<p>Oberfläche nicht gebaut.</p>", status_code=503)
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})



# --- Oberfläche -------------------------------------------------------------------
if (WEB / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{pfad:path}", include_in_schema=False)
    def oberflaeche(pfad: str, request: Request) -> Response:
        if pfad.startswith(("api/", "mcp", "oauth/", "teilen/", "spielwelt/")):
            raise HTTPException(404)
        if not auth.benutzer_aus_proxy(request):
            return HTMLResponse(f"<p>Bitte über {auth.basis_url()} anmelden.</p>", status_code=401)
        datei = WEB / pfad
        if pfad and datei.is_file() and WEB in datei.resolve().parents:
            return FileResponse(datei)
        return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})
