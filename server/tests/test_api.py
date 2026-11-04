import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PLANER_DATA", str(tmp_path))
    monkeypatch.setenv("PLANER_DEV_USER", "murat")
    from planer.app import app
    with TestClient(app) as c:
        yield c


def test_modell_und_versionen(client):
    m = client.get("/api/modell").json()
    assert m["meta"]["version"] == 1 and m["meta"]["ausgerichtet"]
    assert len(m["moebel"]) > 20 and len(m["bibliothek"]) > 20
    sofa = next(x for x in m["moebel"] if x["id"] == "g-3er")
    assert sofa["rot_grad"] == 90 and sofa["masse_bth"][0] == 1.82  # Rücken an den östlichen Kniestock
    stuhl = next(x for x in m["moebel"] if x["id"] == "w-stuhl-nord")
    assert stuhl["rot_grad"] == 0  # Rückseite Norden, Front zum Tisch
    ost = next(x for x in m["moebel"] if x["id"] == "w-stuhl-ost-1")
    assert ost["rot_grad"] == 90
    m["moebel"][0]["pos"] = [1.0, 8.0]
    r = client.put("/api/modell", json={"modell": m, "basis_version": 1, "notiz": "test"})
    assert r.json()["version"] == 2
    r = client.put("/api/modell", json={"modell": m, "basis_version": 1})
    assert r.status_code == 409
    assert client.get("/api/versionen").json()[0]["version"] == 2


def test_varianten_bilder(client):
    assert client.post("/api/varianten", json={"name": "Wohnen Variante D"}).json()["slug"] == "wohnen-variante-d"
    assert client.get("/api/varianten").json()[0]["name"] == "Wohnen Variante D"
    r = client.post("/api/bilder", files={"datei": ("a.png", b"\x89PNG....", "image/png")}, data={"titel": "Test"})
    bid = r.json()["id"]
    assert client.get(f"/api/bilder/{bid}").status_code == 200
    r = client.post("/api/render", files={"szene": ("s.glb", b"glTF", "model/gltf-binary")},
                    data={"params": json.dumps({"titel": "X", "aufloesung": [640, 360], "samples": 16})})
    assert r.json()["status"] == "wartet"


def test_mcp_werkzeuge(client, monkeypatch):
    monkeypatch.setenv("PLANER_MCP_TOKEN", "geheim")
    h = {"Authorization": "Bearer geheim", "Accept": "application/json, text/event-stream"}
    r = client.post("/mcp", headers=h, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    namen = {t["name"] for t in r.json()["result"]["tools"]}
    assert {"moebel_setzen", "moebel_tauschen", "planer_ueberblick", "oberflaeche_setzen"} <= namen
    r = client.post("/mcp", headers=h, json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
        "name": "moebel_setzen", "arguments": {"moebel": [{"vorlage_id": "sessel", "raum": "wohnen", "pos": [2.0, 10.0]}]}}})
    assert not r.json()["result"].get("isError"), r.json()
    m = client.get("/api/modell").json()
    assert m["meta"]["version"] == 2 and any(x.get("vorlage_id") == "sessel" for x in m["moebel"])
    assert client.post("/mcp", json={}).status_code == 401


def test_render_hilfen() -> None:
    from planer import render_worker as rw

    assert rw.sonne_rgb(-3) is None
    r = rw.sonne_rgb(60)
    assert r is not None and 150 < r[0] < 170
    assert rw.B([1, 2, 3]) == (1.0, -2.0, 3.0)
    k = rw.kelvin_rgb(2700)
    assert k[0] > k[2]
