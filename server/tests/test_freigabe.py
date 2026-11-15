import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PLANER_DATA", str(tmp_path))
    monkeypatch.setenv("PLANER_DEV_USER", "murat")
    from planer import freigabe
    freigabe._fehlversuche.clear()
    from planer.app import app
    with TestClient(app) as c:
        yield c


def _extern(monkeypatch):
    """Ab jetzt wie ein Gast von außen: kein Proxy-Benutzer, Remote-User-Header wird nicht vertraut."""
    monkeypatch.delenv("PLANER_DEV_USER")
    monkeypatch.setenv("PLANER_TRUSTED_PROXIES", "10.255.255.254")


def test_freigabe_nur_lesen(client, monkeypatch):
    r = client.post("/api/freigaben", json={"name": "Waldemar", "kennwort": "Eiche-Linde-1234"})
    assert r.status_code == 200 and "kennwort_hash" not in r.json()
    fid = r.json()["id"]
    assert client.post("/api/freigaben", json={"name": "x", "kennwort": "kurz"}).status_code == 400
    _extern(monkeypatch)
    # ohne Kennwort: Anmeldeseite, keine Daten
    s = client.get(f"/teilen/{fid}/")
    assert s.status_code == 200 and "Kennwort" in s.text and "Waldemar" in s.text
    assert client.get(f"/teilen/{fid}/api/modell").status_code == 401
    assert client.get("/teilen/gibtsnicht/").status_code == 404
    # falsches Kennwort
    assert client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "falsch"}).status_code == 401
    # richtiges Kennwort: Cookie, gefiltertes Modell
    r = client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "Eiche-Linde-1234"}, follow_redirects=False)
    assert r.status_code == 303 and "httponly" in r.headers["set-cookie"].lower()
    m = client.get(f"/teilen/{fid}/api/modell").json()
    assert m["freigabe"]["name"] == "Waldemar" and m["bibliothek"] == [] and m["offene_fragen"] == []
    assert all("preis_eur" not in x and "quelle" not in x for x in m["moebel"])
    assert client.get(f"/teilen/{fid}/api/modell/version").json()["version"] == m["meta"]["version"]
    seite = client.get(f"/teilen/{fid}/")
    assert seite.status_code in (200, 503) and "Kennwort eingeben" not in seite.text
    # mit Gast-Cookie kein Zugriff auf die eigentliche API, kein Schreiben, keine Verwaltung
    assert client.get("/api/modell").status_code == 401
    assert client.put("/api/modell", json={"modell": m, "basis_version": None}).status_code == 401
    assert client.get("/api/freigaben").status_code == 401
    assert client.post("/api/freigaben", json={"name": "y", "kennwort": "12345678"}).status_code == 401


def test_freigabe_sperren_und_fehlversuche(client, monkeypatch):
    fid = client.post("/api/freigaben", json={"name": "Kinder", "kennwort": "Birke-Ulme-4242"}).json()["id"]
    fid2 = client.post("/api/freigaben", json={"name": "Test", "kennwort": "Birke-Ulme-4242"}).json()["id"]
    client.patch(f"/api/freigaben/{fid2}", json={"aktiv": False})
    monkeypatch.setenv("PLANER_DEV_USER", "murat")
    _extern(monkeypatch)
    # gesperrter Link: weder Seite noch Anmeldung
    assert client.get(f"/teilen/{fid2}/").status_code == 404
    r = client.post(f"/teilen/{fid2}/anmelden", data={"kennwort": "Birke-Ulme-4242"}, follow_redirects=False)
    assert r.status_code == 404 and "set-cookie" not in r.headers
    # nach 5 Fehlversuchen 15 min Sperre, auch mit richtigem Kennwort
    for _ in range(5):
        assert client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "nein"}).status_code == 401
    assert client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "Birke-Ulme-4242"}).status_code == 429


def test_freigabe_kennwort_wechsel_beendet_sitzung(client, monkeypatch):
    fid = client.post("/api/freigaben", json={"name": "Nadja", "kennwort": "Kiefer-Buche-777"}).json()["id"]
    _extern(monkeypatch)
    client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "Kiefer-Buche-777"})
    assert client.get(f"/teilen/{fid}/api/modell").status_code == 200
    monkeypatch.setenv("PLANER_DEV_USER", "murat")
    client.patch(f"/api/freigaben/{fid}", json={"kennwort": "Neu-Kennwort-888"})
    _extern(monkeypatch)
    assert client.get(f"/teilen/{fid}/api/modell").status_code == 401


def test_spielwelt_uebergabe_und_token(client, monkeypatch):
    assert client.get("/api/spielwelt").json()["version"] == 0
    glb = b"glTF" + b"\x00" * 60
    r = client.post("/api/spielwelt", files={"haus": ("haus.glb", glb, "model/gltf-binary")},
                    data={"welt": '{"format": 1, "modell_version": 7, "moebel": []}'})
    assert r.status_code == 200 and r.json()["version"] == 1 and r.json()["modell_version"] == 7
    bad = client.post("/api/spielwelt", files={"haus": ("x.glb", b"nope", "model/gltf-binary")}, data={"welt": "{}"})
    assert bad.status_code == 400
    # ohne gesetztes Token kein Abruf
    assert client.get("/spielwelt/haus.glb").status_code == 401
    monkeypatch.setenv("PLANER_SPIELWELT_TOKEN", "geheim-123")
    assert client.get("/spielwelt/haus.glb", headers={"Authorization": "Bearer falsch"}).status_code == 401
    h = {"Authorization": "Bearer geheim-123"}
    assert client.get("/spielwelt/haus.glb", headers=h).content == glb
    assert client.get("/spielwelt/welt.json", headers=h).json()["modell_version"] == 7
    assert client.get("/spielwelt/meta.json", headers=h).json()["version"] == 1
    assert client.get("/spielwelt/schluessel", headers=h).status_code == 404


def _mini_jpeg(w: int, h: int) -> bytes:
    """Nur Kopf (SOI, APP0, SOF0) – reicht für Ablage und Seitenverhältnis."""
    app0 = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0" + (17).to_bytes(2, "big") + b"\x08" + h.to_bytes(2, "big") + w.to_bytes(2, "big") + b"\x03" + b"\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9"


def test_panorama_und_zaun(client, monkeypatch):
    m = client.get("/api/modell").json()
    assert any(f["typ"] == "zaun_staketen" for f in m["feste_elemente"])
    assert client.get("/api/umgebung/panorama.jpg").status_code == 404
    assert client.post("/api/umgebung/panorama", files={"datei": ("p.png", b"\x89PNG....", "image/png")}).status_code == 400
    p = client.post("/api/umgebung/panorama", files={"datei": ("p.jpg", _mini_jpeg(2000, 1340), "image/jpeg")}).json()
    assert p["version"] == 1 and p["verhaeltnis"] == 0.67 and p["bogen_grad"] == 95
    assert client.get("/api/modell").json()["umgebung"]["panorama"]["version"] == 1
    assert client.get("/api/umgebung/panorama.jpg").content[:2] == b"\xff\xd8"
    # Freigabe: nur mit Sitzung
    fid = client.post("/api/freigaben", json={"name": "Kinder", "kennwort": "Eiche-Linde-1234"}).json()["id"]
    _extern(monkeypatch)
    assert client.get(f"/teilen/{fid}/api/umgebung/panorama.jpg").status_code == 401
    client.post(f"/teilen/{fid}/anmelden", data={"kennwort": "Eiche-Linde-1234"})
    assert client.get(f"/teilen/{fid}/api/umgebung/panorama.jpg").status_code == 200
