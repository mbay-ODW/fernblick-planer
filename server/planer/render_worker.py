"""Render-Worker: arbeitet Render-Aufträge aus PLANER_DATA/auftraege mit Blender Cycles (bpy) ab.

    python -m planer.render_worker                 Dauerschleife (eigener Container)
    python -m planer.render_worker --auftrag DIR   einen Auftrag rendern (Unterprozess, damit Abbrechen sicher geht)

Szene: GLB aus dem Browser (three.js, Y oben). Der glTF-Import dreht nach Blender (Z oben):
Modell (x Ost, y Süd, z oben) → Blender (x, −y, z).
Licht physikalisch: Himmel „Multiple Scattering“ ohne Sonnenscheibe + Sonnenlampe aus einer Tabelle
(Bestrahlungsstärke je Sonnenhöhe, aus dem Blender-Himmel kalibriert), Leuchten mit lm/683 W.
Die Belichtung ermittelt ein kleiner Vorab-Durchgang (log. Mittelwert der Leuchtdichte).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from planer import speicher

# Bestrahlungsstärke der Sonne senkrecht zur Einfallsrichtung (W/m², RGB) je Sonnenhöhe in Grad
SONNE = {0.5: (10.9, 1.95, 0.01), 1: (18.4, 4.14, 0.01), 2: (34.3, 10.8, 0.08), 3: (49.0, 19.2, 1.68),
         5: (72.9, 37.2, 8.49), 7: (90.6, 53.4, 18.0), 10: (109.0, 72.7, 32.7), 15: (127.4, 94.2, 53.3),
         20: (138.1, 107.5, 68.3), 30: (149.7, 122.7, 87.3), 45: (157.5, 133.5, 102.1), 60: (161.1, 138.5, 109.4),
         75: (162.8, 140.9, 113.0), 90: (163.6, 141.9, 114.3)}
LM_PRO_W = 683.0


def _jetzt() -> float:
    return time.time()


def status_setzen(d: Path, **felder: Any) -> None:
    p = d / "status.json"
    try:
        st = json.loads(p.read_text())
    except (FileNotFoundError, ValueError):
        st = {}
    st.update(felder)
    st["zeit"] = speicher.jetzt()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False))
    os.replace(tmp, p)


def sonne_rgb(hoehe: float) -> tuple[float, float, float] | None:
    if hoehe <= 0:
        return None
    ks = sorted(SONNE)
    if hoehe <= ks[0]:
        f = hoehe / ks[0]
        return tuple(v * f for v in SONNE[ks[0]])  # type: ignore[return-value]
    for a, b in zip(ks, ks[1:], strict=False):
        if a <= hoehe <= b:
            t = (hoehe - a) / (b - a)
            return tuple(SONNE[a][i] * (1 - t) + SONNE[b][i] * t for i in range(3))  # type: ignore[return-value]
    return SONNE[90]


def kelvin_rgb(k: float) -> tuple[float, float, float]:
    t = k / 100
    if t <= 66:
        r, g = 255.0, 99.47 * math.log(t) - 161.12
        b = 0.0 if t <= 19 else 138.52 * math.log(t - 10) - 305.04
    else:
        r, g, b = 329.7 * (t - 60) ** -0.1332, 288.12 * (t - 60) ** -0.0755, 255.0

    def lin(v: float) -> float:
        c = max(0.0, min(255.0, v)) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return lin(r), lin(g), lin(b)


def B(p: list[float]) -> tuple[float, float, float]:
    """Modellkoordinaten → Blender."""
    return float(p[0]), -float(p[1]), float(p[2])


# ---------------------------------------------------------------------------
# Szene aufbauen (läuft im Unterprozess mit bpy)
# ---------------------------------------------------------------------------
def _materialien(bpy: Any) -> None:
    for mat in bpy.data.materials:
        name = mat.name.lower()
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        if name.startswith("glas") or name.startswith("milchglas"):
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            if name.startswith("milchglas"):
                tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
                tr.inputs["Color"].default_value = (0.85, 0.87, 0.88, 1)
                nt.links.new(tr.outputs[0], out.inputs["Surface"])
                continue
            # dünnes Architekturglas: durchsichtig + Fresnel-Spiegelung, Schatten- und Diffusstrahlen gehen durch
            trans = nt.nodes.new("ShaderNodeBsdfTransparent")
            trans.inputs["Color"].default_value = (0.94, 0.97, 0.97, 1)
            glanz = nt.nodes.new("ShaderNodeBsdfGlossy")
            glanz.inputs["Roughness"].default_value = 0.0
            fres = nt.nodes.new("ShaderNodeFresnel")
            fres.inputs["IOR"].default_value = 1.52
            mix = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(fres.outputs[0], mix.inputs[0])
            nt.links.new(trans.outputs[0], mix.inputs[1])
            nt.links.new(glanz.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        if name.startswith("spiegel"):
            bsdf.inputs["Metallic"].default_value = 1.0
            bsdf.inputs["Roughness"].default_value = 0.02
            bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.92, 1)
        if name.startswith("leuchte"):
            # Leuchtende Schirme: three.js-Stärke 1,5–4 → dezente physikalische Leuchtdichte
            st = bsdf.inputs.get("Emission Strength")
            if st is not None:
                s = float(st.default_value)
                dimm = max(0.0, min(1.0, (s - 1.5) / 2.5)) if s > 0 else 0.0
                st.default_value = 0.0 if s <= 0 else 0.02 + 0.06 * dimm


def _welt(bpy: Any, p: dict[str, Any]) -> None:
    s = bpy.context.scene
    w = bpy.data.worlds.new("Himmel")
    s.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    sonne = p.get("sonne") or {}
    hoehe = float(sonne.get("hoehe", 30))
    r = sonne.get("richtung") or [0, 1, 0.5]
    d = B(r)
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_disc = False
    sky.sun_elevation = math.radians(max(-8.0, hoehe))
    sky.sun_rotation = math.atan2(-d[0], d[1])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs[1].default_value = max(0.0, min(1.0, (hoehe + 9.0) / 8.0))  # Dämmerung → Nacht
    nt.links.new(sky.outputs[0], bg.inputs[0])
    # Nachthimmel: etwas Restlicht dazu
    nacht = nt.nodes.new("ShaderNodeBackground")
    nacht.inputs[0].default_value = (0.0006, 0.0009, 0.002, 1)
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(bg.outputs[0], add.inputs[0])
    nt.links.new(nacht.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])

    rgb = sonne_rgb(hoehe)
    if rgb:
        import mathutils

        m = max(rgb)
        lamp = bpy.data.lights.new("Sonne", "SUN")
        lamp.energy = m
        lamp.color = tuple(v / m for v in rgb)
        lamp.angle = math.radians(0.8)
        o = bpy.data.objects.new("Sonne", lamp)
        o.rotation_euler = mathutils.Vector(d).normalized().to_track_quat("Z", "Y").to_euler()
        s.collection.objects.link(o)


def _leuchten(bpy: Any, p: dict[str, Any]) -> None:
    import mathutils

    s = bpy.context.scene
    for i, le in enumerate(p.get("leuchten") or []):
        lm = float(le.get("lumen", 0))
        if lm <= 0:
            continue
        spot = le.get("typ") == "spot"
        lamp = bpy.data.lights.new(f"Leuchte {i} {le.get('id', '')}", "SPOT" if spot else "POINT")
        lamp.color = kelvin_rgb(float(le.get("kelvin", 2700)))
        lamp.shadow_soft_size = float(le.get("radius", 0.05))
        energie = lm / LM_PRO_W
        o = bpy.data.objects.new(lamp.name, lamp)
        o.location = B(le["pos"])
        if spot:
            winkel = math.radians(float(le.get("winkel", 120)))
            lamp.spot_size = winkel
            lamp.spot_blend = float(le.get("weich", 0.5))
            omega = 2 * math.pi * (1 - math.cos(winkel / 2))
            energie *= 4 * math.pi / omega
            r = mathutils.Vector(B(le.get("richtung", [0, 0, -1])))
            o.rotation_euler = (-r).normalized().to_track_quat("Z", "Y").to_euler()
        lamp.energy = energie
        s.collection.objects.link(o)


def _kamera(bpy: Any, p: dict[str, Any]) -> None:
    import mathutils

    s = bpy.context.scene
    k = p["kamera"]
    cam = bpy.data.cameras.new("Kamera")
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(float(k.get("fov_v", 55)))
    cam.clip_start = 0.03
    cam.clip_end = 2000
    o = bpy.data.objects.new("Kamera", cam)
    pos, ziel = mathutils.Vector(B(k["pos"])), mathutils.Vector(B(k["ziel"]))
    o.location = pos
    o.rotation_euler = (ziel - pos).to_track_quat("-Z", "Y").to_euler()
    s.collection.objects.link(o)
    s.camera = o
    w, h = p.get("aufloesung", [1280, 720])
    s.render.resolution_x, s.render.resolution_y = int(w), int(h)
    s.render.resolution_percentage = 100


def _cycles(bpy: Any, samples: int) -> None:
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    c = s.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = True
    c.denoiser = "OPENIMAGEDENOISE"
    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 4
    c.transmission_bounces = 8
    c.transparent_max_bounces = 16
    c.sample_clamp_indirect = 8.0
    c.blur_glossy = 1.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.light_sampling_threshold = 0.01
    threads = int(os.environ.get("PLANER_RENDER_THREADS", "0") or 0)
    if threads > 0:
        s.render.threads_mode = "FIXED"
        s.render.threads = threads


def _belichtung_messen(bpy: Any, d: Path, p: dict[str, Any]) -> float:
    """Kleiner Vorab-Durchgang; liefert Belichtung in Blendenstufen für AgX."""
    import numpy as np

    s = bpy.context.scene
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.view_settings.exposure = 0.0
    s.render.resolution_percentage = max(10, int(100 * 320 / max(s.render.resolution_x, s.render.resolution_y)))
    s.cycles.samples = 12
    s.render.image_settings.file_format = "OPEN_EXR"
    s.render.filepath = str(d / "vorab.exr")
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(d / "vorab.exr"), check_existing=False)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :3]
    y = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
    y = np.sort(y)[: max(1, int(len(y) * 0.97))]  # Fenster/Himmel-Spitzen dämpfen
    lavg = float(np.exp(np.mean(np.log(y + 1e-6))))
    bpy.data.images.remove(img)
    (d / "vorab.exr").unlink(missing_ok=True)
    ziel = 0.27 if p.get("kamera", {}).get("begehen") else 0.18
    ev = math.log2(ziel / max(lavg, 1e-7))
    return max(-14.0, min(14.0, ev))


def einzelauftrag(d: Path) -> None:
    import bpy  # noqa: PLC0415 – nur im Unterprozess

    a = json.loads((d / "auftrag.json").read_text())
    p = a["params"]
    t0 = _jetzt()
    status_setzen(d, status="laeuft", phase="Szene laden", fortschritt=0.02)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        import addon_utils

        addon_utils.enable("io_scene_gltf2", default_set=True)
    except Exception:  # noqa: BLE001
        pass
    bpy.ops.import_scene.gltf(filepath=str(d / "szene.glb"))
    for o in list(bpy.data.objects):
        if o.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        namen = [m.name.lower() for m in o.data.materials if m]
        if any(n.startswith("leuchte") for n in namen):
            o.visible_shadow = False
        if any(n.startswith("glas") for n in namen):
            o.visible_shadow = True
    _materialien(bpy)
    _welt(bpy, p)
    _leuchten(bpy, p)
    _kamera(bpy, p)
    _cycles(bpy, int(p.get("samples", 64)))

    status_setzen(d, phase="Belichtung messen", fortschritt=0.06)
    ev = _belichtung_messen(bpy, d, p)
    s = bpy.context.scene
    s.render.resolution_percentage = 100
    s.cycles.samples = int(p.get("samples", 64))
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = "AgX - Base Contrast"
    except TypeError:
        pass
    s.view_settings.exposure = ev + float(p.get("belichtung_ev", 0))

    gesamt = int(p.get("samples", 64))
    letzte = [0.0]

    def fortschritt(*args: Any) -> None:
        text = str(args[0]) if args else ""
        if (d / "abbrechen").exists():
            raise KeyboardInterrupt
        if _jetzt() - letzte[0] < 2:
            return
        letzte[0] = _jetzt()
        felder: dict[str, Any] = {"phase": "rendert"}
        if "Sample " in text:
            try:
                n, m = text.split("Sample ")[1].split()[0].split("/")
                felder["fortschritt"] = round(0.1 + 0.85 * int(n) / max(1, int(m)), 3)
            except ValueError:
                pass
        if "Remaining:" in text:
            r = text.split("Remaining:")[1].split("|")[0].strip()
            try:
                teile = [float(x) for x in r.split(":")]
                sek = teile[-1] + (teile[-2] * 60 if len(teile) > 1 else 0) + (teile[-3] * 3600 if len(teile) > 2 else 0)
                felder["rest_sek"] = int(sek)
            except ValueError:
                pass
        if "Denois" in text:
            felder["phase"] = "entrauscht"
        status_setzen(d, **felder)

    bpy.app.handlers.render_stats.append(fortschritt)
    status_setzen(d, phase="rendert", fortschritt=0.1, samples=gesamt)
    s.render.image_settings.file_format = "JPEG"
    s.render.image_settings.quality = 93
    ziel = d / "ergebnis.jpg"
    s.render.filepath = str(ziel)
    bpy.ops.render.render(write_still=True)
    bpy.app.handlers.render_stats.remove(fortschritt)

    dauer = int(_jetzt() - t0)
    meta = {"titel": p.get("titel") or "Rendering", "art": "rendering", "modus": "cycles", "kamera": p.get("kamera"),
            "wer": a.get("wer"), "auftrag": a["id"], "vorschau_id": p.get("vorschau_id"), "samples": gesamt,
            "dauer_sek": dauer, "aufloesung": p.get("aufloesung"), "belichtung_ev": round(ev, 2),
            "datum": p.get("datum"), "uhrzeit": p.get("uhrzeit"), "szenario": p.get("szenario"),
            "modell_version": p.get("modell_version")}
    b = speicher.bild_ablegen(ziel.read_bytes(), "jpg", meta)
    ziel.unlink(missing_ok=True)
    status_setzen(d, status="fertig", phase="fertig", fortschritt=1.0, bild_id=b["id"], dauer_sek=dauer, rest_sek=0)


# ---------------------------------------------------------------------------
# Dauerschleife
# ---------------------------------------------------------------------------
def _ausfuehren(d: Path) -> None:
    status_setzen(d, status="laeuft", phase="startet", fortschritt=0.01)
    log = d / "render.log"
    with log.open("w") as f:
        proc = subprocess.Popen([sys.executable, "-m", "planer.render_worker", "--auftrag", str(d)],
                                stdout=f, stderr=subprocess.STDOUT, cwd=str(Path(__file__).resolve().parent.parent))
        while proc.poll() is None:
            if (d / "abbrechen").exists():
                proc.terminate()
                try:
                    proc.wait(15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                status_setzen(d, status="abgebrochen", phase="abgebrochen")
                return
            time.sleep(1)
    try:
        st = json.loads((d / "status.json").read_text())
    except (FileNotFoundError, ValueError):
        st = {}
    if st.get("status") != "fertig":
        zeilen = [z for z in log.read_text(errors="replace").splitlines() if z.strip()]
        fehler = next((z for z in reversed(zeilen) if "Error" in z or "Exception" in z), zeilen[-1] if zeilen else "unbekannt")
        status_setzen(d, status="fehler", phase="fehler", fehler=fehler[-300:])


def schleife() -> None:
    basis = speicher.daten() / "auftraege"
    print(f"Render-Worker bereit, beobachte {basis}", flush=True)
    # Aufträge, die beim Neustart mitten im Rendern waren, neu einreihen
    for d in basis.iterdir():
        try:
            st = json.loads((d / "status.json").read_text())
            if st.get("status") == "laeuft":
                status_setzen(d, status="wartet", phase="neu eingereiht", fortschritt=0)
        except (FileNotFoundError, ValueError, NotADirectoryError):
            continue
    aufgeraeumt = 0.0
    while True:
        if time.time() - aufgeraeumt > 86400:
            speicher.auftraege_aufraeumen(14)
            aufgeraeumt = time.time()
        offen = []
        for d in sorted(basis.iterdir()):
            try:
                if json.loads((d / "status.json").read_text()).get("status") == "wartet":
                    offen.append(d)
            except (FileNotFoundError, ValueError, NotADirectoryError):
                continue
        if offen:
            d = offen[0]
            print(f"Rendere {d.name}", flush=True)
            try:
                _ausfuehren(d)
            except Exception:  # noqa: BLE001
                status_setzen(d, status="fehler", fehler=traceback.format_exc()[-300:])
            print(f"Fertig {d.name}: {json.loads((d / 'status.json').read_text()).get('status')}", flush=True)
            continue
        time.sleep(3)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--auftrag":
        verz = Path(sys.argv[2])
        try:
            einzelauftrag(verz)
        except KeyboardInterrupt:
            status_setzen(verz, status="abgebrochen", phase="abgebrochen")
            sys.exit(3)
        except Exception:
            traceback.print_exc()
            status_setzen(verz, status="fehler", phase="fehler", fehler=traceback.format_exc().splitlines()[-1][-300:])
            sys.exit(2)
    else:
        schleife()
