// 3D-Bühne: Renderer, Kameras, Umschauen (Orbit) und Begehen (Ego-Perspektive), Auswahl und Verschieben
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { hausBauen, HausErgebnis, KollBox, P2, seiteAusNormale } from "./haus";
import { moebelBauen, istFlach } from "./moebel";
import { Beleuchtung, leuchtenBauen, LeuchteEintrag, leuchteSetzen } from "./licht";
import { MOBIL } from "./geraet";

export type Geschossfilter = "alle" | "EG" | "OG";

export interface SzenenRueckrufe {
  auswahl: (id: string | null) => void;
  verschoben: (id: string, pos: P2, rot?: number) => void;
  wandKlick: (wand: string, seite: "plus" | "minus", raum?: string) => void;
  bodenKlick: (raum: string) => void;
  kamera: () => void;
  bauteil: (b: Bauteil) => void;
  bauteilVerschoben: (b: Bauteil, dx: number, dy: number) => void;
}

/** Feste Einbauten (Küche, Bad, Geländer …) und Wand-Teilflächen (z. B. Aluverbundplatte) */
export interface Bauteil {
  art: "fest" | "flaeche" | "wand";
  id: string;
}

const AUGE = 1.62;
const RADIUS = 0.24;

function punktInPoly(x: number, y: number, poly: P2[]) {
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) innen = !innen;
  }
  return innen;
}

export class Szene {
  renderer: THREE.WebGLRenderer;
  szene = new THREE.Scene();
  kamera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  haus!: HausErgebnis;
  licht!: Beleuchtung;
  modell: any;
  modus: "orbit" | "begehen" = "orbit";
  geschoss: Geschossfilter = "alle";
  dachZeigen = false;
  pinsel = false;
  auswahlId: string | null = null;
  private moebelGruppe = new THREE.Group();
  private moebelObj = new Map<string, THREE.Group>();
  private moebelLichter = new Map<string, LeuchteEintrag>();
  private leuchtenGruppe = new THREE.Group();
  leuchten: LeuchteEintrag[] = [];
  private markierung: THREE.LineSegments | null = null;
  private ray = new THREE.Raycaster();
  private uhr = new THREE.Clock();
  private tasten = new Set<string>();
  private blick = { gier: 0, nick: 0 };
  fuss = new THREE.Vector3(6, 0, 5); // Modell x, y, z (Fußhöhe)
  private ziehen: { id: string; ebene: THREE.Plane; versatz: THREE.Vector3; start: THREE.Vector2; aktiv: boolean } | null = null;
  private bauteilZiehen: { b: Bauteil; obj: THREE.Object3D; ebene: THREE.Plane; p0: THREE.Vector3; pos0: THREE.Vector3; richtung?: THREE.Vector3; start: THREE.Vector2; aktiv: boolean; d: THREE.Vector3 } | null = null;
  private blickZiehen: { x: number; y: number } | null = null;
  private laufZiel: THREE.Vector2 | null = null;
  private szenarioWerte: Record<string, number> = {};
  aktiv = true;
  private bedarf = 3;
  /** Neu zeichnen anfordern (Rendering nur bei Änderungen). */
  neu() {
    this.bedarf = 2;
  }

  constructor(private behaelter: HTMLElement, private rueck: SzenenRueckrufe) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !MOBIL, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    // iPhone & Co.: geringere Auflösung, sonst beendet iOS den Tab wegen Grafikspeicher
    this.renderer.setPixelRatio(Math.min(MOBIL ? 1.5 : 2, window.devicePixelRatio));
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      const t = document.getElementById("toast");
      if (t) {
        t.textContent = "3D-Ansicht wurde vom Gerät beendet (Grafikspeicher) – Seite neu laden";
        t.className = "zeigen fehler";
      }
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    behaelter.appendChild(this.renderer.domElement);
    this.kamera = new THREE.PerspectiveCamera(55, 1, 0.05, 3000);
    this.kamera.position.set(16, 14, 22);
    this.orbit = new OrbitControls(this.kamera, this.renderer.domElement);
    this.orbit.target.set(3.9, 1.5, 6);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.addEventListener("change", () => {
      this.neu();
      this.rueck.kamera();
    });
    this.szene.add(this.moebelGruppe, this.leuchtenGruppe);
    this.moebelGruppe.name = "Möbel";
    new ResizeObserver(() => this.groesse()).observe(behaelter);
    this.ereignisse();
    this.renderer.setAnimationLoop(() => this.bild());
  }

  // ---------------------------------------------------------------------------
  // Aufbau
  // ---------------------------------------------------------------------------
  laden(m: any) {
    this.modell = m;
    if (this.haus) {
      this.szene.remove(this.haus.gruppe);
      this.haus.gruppe.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.haus = hausBauen(m);
    this.szene.add(this.haus.gruppe);
    if (!this.licht) this.licht = new Beleuchtung(this.szene, this.renderer, this.haus.masse);
    this.leuchtenNeu(m);
    this.moebelNeu(m);
    this.einstellungen(m.einstellungen ?? {});
    this.sichtbarkeit();
  }

  leuchtenNeu(m: any) {
    this.szene.remove(this.leuchtenGruppe);
    this.haus.gruppe.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const treffer = (pos: THREE.Vector3, d: THREE.Vector3) => {
      rc.set(pos, d);
      rc.far = 12;
      const h = rc.intersectObject(this.haus.gruppe, true).find((x) => x.object.userData.art !== "glas" && x.face);
      if (!h || !h.face) return null;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.dot(d) > 0) n.negate();
      const mm = Array.isArray((h.object as THREE.Mesh).material) ? ((h.object as THREE.Mesh).material as THREE.Material[])[h.face.materialIndex] : (h.object as THREE.Mesh).material;
      const farbe = ((mm as THREE.MeshStandardMaterial).color ?? new THREE.Color(0.7, 0.7, 0.7)).clone();
      return { punkt: h.point.clone(), normal: n, farbe };
    };
    const { gruppe, eintraege } = leuchtenBauen(m, this.haus.masse, this.haus.waende, treffer);
    this.leuchtenGruppe = gruppe;
    this.leuchten = eintraege;
    this.szene.add(gruppe);
    this.szenarioAnwenden();
  }

  moebelNeu(m: any) {
    this.modell = m;
    for (const o of this.moebelObj.values()) this.moebelGruppe.remove(o);
    this.moebelObj.clear();
    this.moebelLichter.clear();
    for (const x of m.moebel ?? []) this.moebelEinfuegen(x);
    this.markieren(this.auswahlId);
    this.sichtbarkeit();
    this.szenarioAnwenden();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private moebelEinfuegen(x: any) {
    const o = moebelBauen(x);
    const g = o.gruppe;
    g.userData = { art: "moebel", id: x.id };
    g.traverse((c) => (c.userData.moebelId = x.id));
    this.platzieren(g, x);
    this.moebelGruppe.add(g);
    this.moebelObj.set(x.id, g);
    if (o.lichter.length)
      this.moebelLichter.set(x.id, { id: x.id, name: x.name, lichter: o.lichter, mats: o.leuchtflaechen, lumen: o.lichter[0].userData.lumen, kelvin: o.lichter[0].userData.kelvin, daten: x });
  }

  private geschossZ(ge: string) {
    return ge === "OG" ? this.haus.masse.ogZ : 0;
  }

  private platzieren(g: THREE.Object3D, x: any) {
    g.position.set(x.pos[0], this.geschossZ(x.geschoss) + (x.z ?? 0), x.pos[1]);
    g.rotation.set(0, (-(x.rot_grad ?? 0) * Math.PI) / 180, 0);
  }

  /** Nur Lage eines Möbels aktualisieren (beim Ziehen im Plan). */
  moebelLage(x: any) {
    const g = this.moebelObj.get(x.id);
    if (g) this.platzieren(g, x);
    this.renderer.shadowMap.needsUpdate = true;
  }

  einstellungen(e: any) {
    this.licht.tageslicht(e);
    this.szenarioAnwenden(e);
  }

  szenarioAnwenden(e?: any) {
    const m = this.modell;
    if (!m) return;
    const ein = e ?? m.einstellungen ?? {};
    const sz = (m.szenarien ?? []).find((s: any) => s.id === ein.szenario);
    const werte: Record<string, number> = { ...(sz?.leuchten ?? {}), ...(ein.dimmer ?? {}) };
    this.szenarioWerte = werte;
    // Nur die hellsten Spots werfen Schatten (Textur-Einheiten sind begrenzt)
    const an = this.leuchten.filter((l) => (werte[l.id] ?? 0) > 0).sort((a, b) => b.lumen * (werte[b.id] ?? 0) - a.lumen * (werte[a.id] ?? 0));
    const schatten = new Set(an.slice(0, MOBIL ? 1 : 4).map((l) => l.id));
    for (const l of this.leuchten) leuchteSetzen(l, werte[l.id] ?? 0, schatten.has(l.id));
    for (const l of this.moebelLichter.values()) leuchteSetzen(l, werte[l.id] ?? 0, false);
    this.renderer.shadowMap.needsUpdate = true;
  }

  aktiveLeuchten(): { eintrag: LeuchteEintrag; dimm: number }[] {
    const alle = [...this.leuchten, ...this.moebelLichter.values()];
    return alle.map((e) => ({ eintrag: e, dimm: this.szenarioWerte[e.id] ?? 0 })).filter((x) => x.dimm > 0);
  }

  alleLeuchten(): LeuchteEintrag[] {
    return [...this.leuchten, ...this.moebelLichter.values()];
  }

  sichtbarkeit() {
    if (!this.haus) return;
    const t = this.haus.teile;
    const beg = this.modus === "begehen";
    const og = beg || this.geschoss !== "EG";
    t.og.visible = og;
    t.ogDecke.visible = og;
    t.dach.visible = beg || this.dachZeigen;
    t.eg.visible = true;
    for (const [id, g] of this.moebelObj) {
      const x = (this.modell.moebel ?? []).find((y: any) => y.id === id);
      g.visible = !x || x.geschoss !== "OG" || og;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Auswahl
  // ---------------------------------------------------------------------------
  markieren(id: string | null) {
    this.auswahlId = id;
    if (this.markierung) {
      this.markierung.parent?.remove(this.markierung);
      this.markierung.geometry.dispose();
      this.markierung = null;
    }
    this.neu();
    if (!id) return;
    const g = this.moebelObj.get(id);
    const x = this.modell.moebel.find((y: any) => y.id === id);
    if (!g || !x) return;
    const [w, d, h] = x.masse_bth;
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.04, Math.max(h, 0.02) + 0.04, d + 0.04));
    geo.translate(0, Math.max(h, 0.02) / 2, 0);
    this.markierung = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffb000, depthTest: false, transparent: true }));
    this.markierung.renderOrder = 999;
    this.markierung.userData.helfer = true;
    g.add(this.markierung);
    this.neu();
  }

  /** Getroffenes Objekt → Einbau (userData.art = fest) oder Teilfläche (userData.flaeche) */
  private bauteilVon(o: THREE.Object3D): { b: Bauteil; obj: THREE.Object3D } | null {
    let x: THREE.Object3D | null = o;
    while (x) {
      if (x.userData.flaeche) return { b: { art: "flaeche", id: x.userData.flaeche }, obj: x };
      if (x.userData.lamellen) return { b: { art: "wand", id: x.userData.lamellen }, obj: x };
      if (x.userData.art === "fest" && x.userData.id) return { b: { art: "fest", id: x.userData.id }, obj: x };
      x = x.parent;
    }
    return null;
  }

  markierenBauteil(b: Bauteil | null, obj?: THREE.Object3D) {
    if (this.markierung) {
      this.markierung.parent?.remove(this.markierung);
      this.markierung.geometry.dispose();
      this.markierung = null;
    }
    this.neu();
    if (!b || !this.haus) return;
    let ziel = obj ?? null;
    if (!ziel)
      this.haus.gruppe.traverse((o) => {
        if (ziel) return;
        if ((b.art === "flaeche" && o.userData.flaeche === b.id) || (b.art === "wand" && o.userData.lamellen === b.id) || (b.art === "fest" && o.userData.art === "fest" && o.userData.id === b.id)) ziel = o;
      });
    if (!ziel) return;
    const box = new THREE.Box3().setFromObject(ziel).expandByScalar(0.02);
    const hl = new THREE.Box3Helper(box, 0xffb000);
    (hl.material as THREE.LineBasicMaterial).depthTest = false;
    hl.renderOrder = 999;
    hl.userData.helfer = true;
    this.szene.add(hl);
    this.markierung = hl;
  }

  fokus(id: string) {
    const x = this.modell.moebel.find((y: any) => y.id === id);
    if (!x || this.modus !== "orbit") return;
    const ziel = new THREE.Vector3(x.pos[0], this.geschossZ(x.geschoss) + 0.6, x.pos[1]);
    const ab = this.kamera.position.clone().sub(this.orbit.target);
    ab.setLength(Math.min(ab.length(), 7));
    this.orbit.target.copy(ziel);
    this.kamera.position.copy(ziel).add(ab);
  }

  private treffer(e: PointerEvent | MouseEvent, ziele?: THREE.Object3D[]) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = this.modus === "begehen" && document.pointerLockElement
      ? new THREE.Vector2(0, 0)
      : new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.kamera);
    const liste = ziele ?? [this.haus.gruppe, this.moebelGruppe];
    return this.ray.intersectObjects(liste, true).filter((h) => {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (!o.visible || o.userData.helfer) return false;
        o = o.parent;
      }
      return h.object.userData.art !== "glas";
    });
  }

  private ereignisse() {
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      el.focus();
      if (!this.haus) return;
      const t = this.treffer(e)[0];
      if (this.modus === "begehen") {
        this.blickZiehen = { x: e.clientX, y: e.clientY };
        (this.blickZiehen as any).zeit = performance.now();
        (this.blickZiehen as any).treffer = t;
        return;
      }
      if (e.button !== 0) return;
      const mid = t?.object.userData.moebelId;
      if (this.pinsel && t) {
        this.pinselTreffer(t);
        return;
      }
      const bt = !mid && t ? this.bauteilVon(t.object) : null;
      if (bt && t) {
        this.rueck.bauteil(bt.b);
        const ebene = new THREE.Plane(new THREE.Vector3(0, 1, 0), -t.point.y);
        let richtung: THREE.Vector3 | undefined;
        if (bt.b.art === "flaeche") {
          const w = this.haus.waende.find((x) => x.id === bt.obj.userData.wand);
          if (w) richtung = new THREE.Vector3(w.ux, 0, w.uy);
        }
        this.bauteilZiehen = { b: bt.b, obj: bt.obj, ebene, p0: t.point.clone(), pos0: bt.obj.position.clone(), richtung, start: new THREE.Vector2(e.clientX, e.clientY), aktiv: false, d: new THREE.Vector3() };
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (mid) {
        if (mid !== this.auswahlId) this.rueck.auswahl(mid);
        const x = this.modell.moebel.find((y: any) => y.id === mid);
        const ebene = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.geschossZ(x.geschoss) + (x.z ?? 0)));
        const p = new THREE.Vector3();
        this.ray.ray.intersectPlane(ebene, p);
        const g = this.moebelObj.get(mid)!;
        this.ziehen = { id: mid, ebene, versatz: g.position.clone().sub(p), start: new THREE.Vector2(e.clientX, e.clientY), aktiv: false };
        el.setPointerCapture(e.pointerId);
      } else {
        (this as any)._klickStart = { x: e.clientX, y: e.clientY };
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (this.modus === "begehen" && this.blickZiehen && !document.pointerLockElement) {
        const dx = e.clientX - this.blickZiehen.x, dy = e.clientY - this.blickZiehen.y;
        this.blickZiehen.x = e.clientX;
        this.blickZiehen.y = e.clientY;
        this.drehen(dx, dy, 0.004);
        return;
      }
      const bz = this.bauteilZiehen;
      if (bz) {
        if (!bz.aktiv && bz.start.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 4) return;
        bz.aktiv = true;
        this.orbit.enabled = false;
        this.treffer(e, []);
        const p = new THREE.Vector3();
        if (!this.ray.ray.intersectPlane(bz.ebene, p)) return;
        const d = p.sub(bz.p0);
        d.y = 0;
        if (bz.richtung) d.copy(bz.richtung).multiplyScalar(d.dot(bz.richtung));
        const raster = e.altKey ? 0.01 : 0.05;
        d.x = Math.round(d.x / raster) * raster;
        d.z = Math.round(d.z / raster) * raster;
        bz.d.copy(d);
        bz.obj.position.copy(bz.pos0).add(d);
        if (this.markierung && !this.markierung.parent?.userData.moebelId) this.markierenBauteil(bz.b, bz.obj);
        this.renderer.shadowMap.needsUpdate = true;
        this.neu();
        return;
      }
      if (!this.ziehen) return;
      if (!this.ziehen.aktiv && this.ziehen.start.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 4) return;
      this.ziehen.aktiv = true;
      this.orbit.enabled = false;
      this.treffer(e, []);
      const p = new THREE.Vector3();
      if (!this.ray.ray.intersectPlane(this.ziehen.ebene, p)) return;
      p.add(this.ziehen.versatz);
      const raster = e.altKey ? 0.01 : 0.05;
      p.x = Math.round(p.x / raster) * raster;
      p.z = Math.round(p.z / raster) * raster;
      const g = this.moebelObj.get(this.ziehen.id)!;
      g.position.x = p.x;
      g.position.z = p.z;
      this.renderer.shadowMap.needsUpdate = true;
      this.neu();
    });
    el.addEventListener("pointerup", (e) => {
      if (this.modus === "begehen" && this.blickZiehen) {
        const b = this.blickZiehen as any;
        const kurz = performance.now() - b.zeit < 300 && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 5;
        this.blickZiehen = null;
        if (kurz && b.treffer && !document.pointerLockElement) this.begehenKlick(b.treffer, e);
        return;
      }
      if (this.bauteilZiehen) {
        const bz = this.bauteilZiehen;
        this.bauteilZiehen = null;
        this.orbit.enabled = true;
        if (bz.aktiv && (Math.abs(bz.d.x) > 1e-4 || Math.abs(bz.d.z) > 1e-4))
          this.rueck.bauteilVerschoben(bz.b, Math.round(bz.d.x * 1000) / 1000, Math.round(bz.d.z * 1000) / 1000);
        return;
      }
      if (this.ziehen) {
        const z = this.ziehen;
        this.ziehen = null;
        this.orbit.enabled = true;
        if (z.aktiv) {
          const g = this.moebelObj.get(z.id)!;
          this.rueck.verschoben(z.id, [Math.round(g.position.x * 1000) / 1000, Math.round(g.position.z * 1000) / 1000]);
        }
        return;
      }
      const s = (this as any)._klickStart;
      (this as any)._klickStart = null;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) this.rueck.auswahl(null);
    });
    el.addEventListener("click", (e) => {
      if (this.modus === "begehen" && document.pointerLockElement) {
        const t = this.treffer(e)[0];
        if (t) this.begehenKlick(t, e);
      }
    });
    el.addEventListener("dblclick", () => {
      if (this.modus === "begehen" && !document.pointerLockElement) el.requestPointerLock();
    });
    document.addEventListener("mousemove", (e) => {
      if (this.modus === "begehen" && document.pointerLockElement === el) this.drehen(e.movementX, e.movementY, 0.0022);
    });
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      this.tasten.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.tasten.delete(e.code));
    window.addEventListener("blur", () => this.tasten.clear());
  }

  private pinselTreffer(t: THREE.Intersection) {
    const o = t.object;
    if (o.userData.art === "wand" && t.face) {
      const w = this.haus.waende.find((x) => x.id === o.userData.wand);
      if (!w) return;
      const n = t.face.normal.clone().transformDirection(o.matrixWorld);
      const seite = seiteAusNormale(w, n);
      if (seite) this.rueck.wandKlick(w.id, seite);
    } else if (o.userData.art === "boden" && o.userData.raum) {
      this.rueck.bodenKlick(o.userData.raum);
    }
  }

  private begehenKlick(t: THREE.Intersection, e: MouseEvent) {
    if (this.pinsel) return this.pinselTreffer(t);
    const mid = t.object.userData.moebelId;
    if (mid) return this.rueck.auswahl(mid);
    const bt = this.bauteilVon(t.object);
    if (bt) return this.rueck.bauteil(bt.b);
    if (t.face && t.face.normal.y > 0.7 && !e.shiftKey) {
      // auf den Boden geklickt → dorthin laufen
      this.laufZiel = new THREE.Vector2(t.point.x, t.point.z);
    }
    this.rueck.auswahl(null);
  }

  private drehen(dx: number, dy: number, k: number) {
    this.blick.gier -= dx * k;
    this.blick.nick = Math.max(-1.4, Math.min(1.4, this.blick.nick - dy * k));
    this.kameraEgo();
    this.neu();
    this.rueck.kamera();
  }

  // ---------------------------------------------------------------------------
  // Modi
  // ---------------------------------------------------------------------------
  umschauen() {
    this.modus = "orbit";
    if (document.pointerLockElement) document.exitPointerLock();
    this.orbit.enabled = true;
    const ziel = new THREE.Vector3(this.fuss.x, this.fuss.z + 1.2, this.fuss.y);
    this.orbit.target.copy(ziel);
    // Hochformat (Handy): weiter weg, damit das ganze Haus ins Bild passt
    const asp = (this.behaelter.clientWidth || 1) / (this.behaelter.clientHeight || 1);
    const f = asp < 1 ? Math.min(2.2, 1.15 / Math.max(0.35, asp)) : 1;
    this.kamera.position.set(ziel.x + 9 * f, ziel.y + 11 * f, ziel.z + 13 * f);
    this.kamera.fov = 55;
    this.kamera.updateProjectionMatrix();
    this.sichtbarkeit();
  }

  begehen(start?: { pos: number[]; ziel: number[]; fov?: number }) {
    this.modus = "begehen";
    this.orbit.enabled = false;
    if (start) {
      this.fuss.set(start.pos[0], start.pos[2], start.pos[1] - AUGE);
      const d = new THREE.Vector3(start.ziel[0] - start.pos[0], start.ziel[1] - start.pos[1], start.ziel[2] - start.pos[2]).normalize();
      this.blick.gier = Math.atan2(-d.x, -d.z);
      this.blick.nick = Math.asin(d.y);
      this.kamera.fov = start.fov ?? 62;
    } else if (this.fuss.x === 6 && this.fuss.y === 5) {
      this.fuss.set(6.4, 5.0, 0);
      this.blick.gier = Math.atan2(1, 1) + Math.PI / 2;
      this.blick.nick = -0.05;
      this.kamera.fov = 62;
    }
    this.fuss.z = this.boden(this.fuss.x, this.fuss.y, this.fuss.z + 0.3);
    this.kamera.updateProjectionMatrix();
    this.sichtbarkeit();
    this.kameraEgo();
    this.neu();
  }

  /** Kamera auf gespeicherte Ansicht setzen (three-Koordinaten). */
  ansicht(k: { pos: number[]; ziel: number[]; fov?: number }, begehen: boolean) {
    if (begehen) return this.begehen(k);
    this.modus = "orbit";
    this.orbit.enabled = true;
    this.kamera.position.set(k.pos[0], k.pos[1], k.pos[2]);
    this.orbit.target.set(k.ziel[0], k.ziel[1], k.ziel[2]);
    this.kamera.fov = k.fov ?? 55;
    this.kamera.updateProjectionMatrix();
    this.sichtbarkeit();
  }

  kameraDaten(): { pos: number[]; ziel: number[]; fov: number; begehen: boolean } {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const dir = new THREE.Vector3();
    this.kamera.getWorldDirection(dir);
    const ziel = this.modus === "orbit" ? this.orbit.target.clone() : this.kamera.position.clone().addScaledVector(dir, 4);
    return { pos: this.kamera.position.toArray().map(r), ziel: ziel.toArray().map(r), fov: this.kamera.fov, begehen: this.modus === "begehen" };
  }

  // ---------------------------------------------------------------------------
  // Begehen: Boden, Treppe, Kollision
  // ---------------------------------------------------------------------------
  boden(x: number, y: number, fussZ: number): number {
    const h = this.haus;
    if (h.treppe.zone(x, y)) return h.treppe.hoehe(x, y);
    if (fussZ > 1.5 && punktInPoly(x, y, h.ogPoly)) return h.masse.ogZ;
    return 0;
  }

  private moebelBoxen(): KollBox[] {
    const out: KollBox[] = [];
    for (const x of this.modell.moebel ?? []) {
      if (istFlach(x)) continue;
      const [w, d, hh] = x.masse_bth;
      const z0 = this.geschossZ(x.geschoss) + (x.z ?? 0);
      out.push({ cx: x.pos[0], cy: x.pos[1], hw: w / 2, hd: d / 2, rot: ((x.rot_grad ?? 0) * Math.PI) / 180, z0, z1: z0 + hh, id: x.id });
    }
    return out;
  }

  private frei(x: number, y: number, fz: number, boxen: KollBox[]): boolean {
    const kopf = fz + 1.75, knie = fz + 0.3;
    for (const s of this.haus.koll.segs) {
      if (s.z1 <= knie || s.z0 >= kopf) continue;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const l = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l));
      if (Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy)) < s.r + RADIUS) return false;
    }
    for (const b of [...this.haus.koll.boxen, ...boxen]) {
      if (b.z1 <= knie || b.z0 >= kopf) continue;
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
      const lx = (x - b.cx) * c - (y - b.cy) * s, ly = (x - b.cx) * s + (y - b.cy) * c;
      const qx = Math.max(-b.hw, Math.min(b.hw, lx)), qy = Math.max(-b.hd, Math.min(b.hd, ly));
      if (Math.hypot(lx - qx, ly - qy) < RADIUS) return false;
    }
    return Math.hypot(x - 3.9, y - 8) < 40;
  }

  private schritt(dx: number, dy: number, boxen: KollBox[]) {
    const f = this.fuss;
    const versuch = (nx: number, ny: number) => {
      const g = this.boden(nx, ny, f.z);
      if (Math.abs(g - f.z) > 0.42) return false;
      if (!this.frei(nx, ny, Math.min(g, f.z), boxen)) return false;
      f.x = nx;
      f.y = ny;
      f.z = g;
      return true;
    };
    if (!versuch(f.x + dx, f.y + dy)) {
      versuch(f.x + dx, f.y);
      versuch(f.x, f.y + dy);
    }
  }

  private kameraEgo() {
    const e = new THREE.Euler(this.blick.nick, this.blick.gier, 0, "YXZ");
    this.kamera.quaternion.setFromEuler(e);
    this.kamera.position.set(this.fuss.x, this.fuss.z + AUGE, this.fuss.y);
  }

  private bewegen(dt: number) {
    const k = this.tasten;
    let vor = 0, seit = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) vor += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) vor -= 1;
    if (k.has("KeyA")) seit -= 1;
    if (k.has("KeyD")) seit += 1;
    if (k.has("ArrowLeft")) this.drehen(-dt * 400, 0, 0.004);
    if (k.has("ArrowRight")) this.drehen(dt * 400, 0, 0.004);
    const tempo = (k.has("ShiftLeft") || k.has("ShiftRight") ? 2.6 : 1.4) * dt;
    const boxen = this.moebelBoxen();
    if (vor || seit) {
      this.laufZiel = null;
      const g = this.blick.gier;
      const fx = -Math.sin(g), fz = -Math.cos(g);
      const rx = Math.cos(g), rz = -Math.sin(g);
      let mx = fx * vor + rx * seit, my = fz * vor + rz * seit;
      const n = Math.hypot(mx, my) || 1;
      mx = (mx / n) * tempo;
      my = (my / n) * tempo;
      // in kleinen Schritten, damit Treppenstufen sauber erkannt werden
      const teile = Math.ceil(Math.hypot(mx, my) / 0.05);
      for (let i = 0; i < teile; i++) this.schritt(mx / teile, my / teile, boxen);
      this.rueck.kamera();
    } else if (this.laufZiel) {
      const dx = this.laufZiel.x - this.fuss.x, dy = this.laufZiel.y - this.fuss.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) this.laufZiel = null;
      else {
        const s = Math.min(d, 1.6 * dt);
        const vx = this.fuss.x, vy = this.fuss.y;
        const teile = Math.ceil(s / 0.05);
        for (let i = 0; i < teile; i++) this.schritt(((dx / d) * s) / teile, ((dy / d) * s) / teile, boxen);
        if (Math.hypot(this.fuss.x - vx, this.fuss.y - vy) < s * 0.2) this.laufZiel = null;
        this.rueck.kamera();
      }
    }
    this.kameraEgo();
  }

  // ---------------------------------------------------------------------------
  // Schleife, Größe, Bildschirmfoto, Export
  // ---------------------------------------------------------------------------
  private groesse() {
    const w = this.behaelter.clientWidth, h = this.behaelter.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.kamera.aspect = w / h;
    this.kamera.updateProjectionMatrix();
    this.neu();
  }

  private bild() {
    const dt = Math.min(0.05, this.uhr.getDelta());
    if (!this.aktiv || !this.haus) return;
    if (this.modus === "begehen") {
      if (this.tasten.size || this.laufZiel || this.blickZiehen || document.pointerLockElement) {
        const vorher = this.kamera.position.clone(), q = this.kamera.quaternion.clone();
        this.bewegen(dt);
        if (!vorher.equals(this.kamera.position) || !q.equals(this.kamera.quaternion)) this.neu();
      }
    } else if (this.orbit.update()) this.neu();
    if (this.renderer.shadowMap.needsUpdate) this.neu();
    if (this.bedarf <= 0) return;
    this.bedarf--;
    this.renderer.render(this.szene, this.kamera);
  }

  async bildschirmfoto(breite?: number, hoehe?: number): Promise<Blob> {
    const alt = this.markierung?.visible;
    if (this.markierung) this.markierung.visible = false;
    let blob: Blob;
    if (breite && hoehe) {
      const ziel = new THREE.WebGLRenderTarget(breite, hoehe, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      const asp = this.kamera.aspect;
      this.kamera.aspect = breite / hoehe;
      this.kamera.updateProjectionMatrix();
      this.renderer.setRenderTarget(ziel);
      this.renderer.render(this.szene, this.kamera);
      const px = new Uint8Array(breite * hoehe * 4);
      this.renderer.readRenderTargetPixels(ziel, 0, 0, breite, hoehe, px);
      this.renderer.setRenderTarget(null);
      this.kamera.aspect = asp;
      this.kamera.updateProjectionMatrix();
      ziel.dispose();
      const cv = document.createElement("canvas");
      cv.width = breite;
      cv.height = hoehe;
      const c = cv.getContext("2d")!;
      const img = c.createImageData(breite, hoehe);
      for (let y = 0; y < hoehe; y++) img.data.set(px.subarray((hoehe - 1 - y) * breite * 4, (hoehe - y) * breite * 4), y * breite * 4);
      c.putImageData(img, 0, 0);
      blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), "image/jpeg", 0.9));
    } else {
      this.renderer.render(this.szene, this.kamera);
      blob = await new Promise<Blob>((r) => this.renderer.domElement.toBlob((b) => r(b!), "image/jpeg", 0.92));
    }
    if (this.markierung) this.markierung.visible = alt ?? true;
    return blob;
  }

  /** Sichtbare Szene (ohne Himmel, Lichter, Hilfslinien) als GLB für Cycles. */
  async exportGlb(): Promise<ArrayBuffer> {
    const versteckt: THREE.Object3D[] = [];
    this.szene.traverse((o) => {
      if (o.visible && (o.userData.helfer || (o as THREE.Light).isLight || o === this.licht.himmel)) {
        o.visible = false;
        versteckt.push(o);
      }
    });
    try {
      const ex = new GLTFExporter();
      const ziele = [this.haus.gruppe, this.moebelGruppe, this.leuchtenGruppe].filter((o) => o.visible);
      const res = await ex.parseAsync(ziele, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
      return res as ArrayBuffer;
    } finally {
      for (const o of versteckt) o.visible = true;
    }
  }
}
