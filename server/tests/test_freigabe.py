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
    assert client.get(f"/teilen/{fid}/").headers["content-type"].startswith("text/html")
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
