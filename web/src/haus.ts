// Baukörper aus dem Modell: Wände mit Öffnungen, Böden, Decken, Dach, Treppe, feste Einbauten.
// Modellkoordinaten: x nach Osten, y nach Süden, z nach oben. three.js: X = x, Y = z, Z = y.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat, nachNormaleTeilen, artAusMaterial, Art } from "./material";

export type P2 = [number, number];
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);

export interface Masse {
  W: number; // Innenbreite Ost-West
  L: number; // Innenlänge Nord-Süd (bis Glasfront)
  ogZ: number;
  traufe: number;
  tan: number;
  firstX: number;
  pfetteUK: number;
}

export function masse(m: any): Masse {
  const n = m.waende.find((w: any) => w.id === "EG-AW-N");
  const s = m.waende.find((w: any) => w.id === "EG-AW-S");
  const og = m.geschosse.find((g: any) => g.id === "OG") ?? {};
  const dach = og.dach ?? {};
  const pf = m.feste_elemente.find((f: any) => f.typ === "pfette");
  const W = n ? Math.abs(n.bis[0] - n.von[0]) : 7.78;
  return {
    W,
    L: s ? s.von[1] : 11.105,
    ogZ: og.z ?? 2.81,
    traufe: dach.traufhoehe_z ?? 4.0,
    tan: Math.tan(((dach.neigung_grad ?? 38) * Math.PI) / 180),
    firstX: dach.first_x ?? W / 2,
    pfetteUK: pf?.unterkante_z ?? 5.0,
  };
}

export function dachInnen(M: Masse, x: number) {
  return M.traufe + M.tan * Math.min(x, M.W - x);
}

export interface Oeffnung {
  id: string;
  typ: string;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  daten: any;
}

export interface WandInfo {
  id: string;
  geschoss: string;
  typ: string;
  a: P2; // Mittellinie Anfang (inkl. Verlängerung)
  b: P2;
  ux: number;
  uy: number; // Richtung
  nx: number;
  ny: number; // Normale (links der Laufrichtung)
  dicke: number;
  laenge: number;
  versatzU: number; // u des Original-Anfangs auf der verlängerten Achse
  z0: number;
  oben: (u: number) => number; // Oberkante je u
  oeffnungen: Oeffnung[];
  daten: any;
}

export interface KollSeg {
  ax: number; ay: number; bx: number; by: number; r: number; z0: number; z1: number;
}
export interface KollBox {
  cx: number; cy: number; hw: number; hd: number; rot: number; z0: number; z1: number; id?: string;
}

export interface HausErgebnis {
  gruppe: THREE.Group;
  teile: { [k: string]: THREE.Object3D }; // dach, ogDecke, og, eg, aussen
  waende: WandInfo[];
  wandMeshes: THREE.Mesh[];
  koll: { segs: KollSeg[]; boxen: KollBox[] };
  masse: Masse;
  treppe: TreppenWeg;
  ogPoly: P2[];
}

const ZARGE = "#3e4043";
const HOLZ_FICHTE = "#d9b98a";
const EICHE = "#b98c55";

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, schatten = true) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.copy(v3(x, y, z));
  me.castShadow = schatten;
  me.receiveShadow = true;
  return me;
}

/** Fläche (Polygon in Modell-xy) auf Höhe z; oben=true → Normale nach oben. */
export function flaeche(poly: P2[], z: number, m: THREE.Material | THREE.Material[], oben = true): THREE.Mesh {
  const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, oben ? -y : y)));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(oben ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, z, 0);
  const me = new THREE.Mesh(g, m);
  me.receiveShadow = true;
  return me;
}

function prisma(poly: P2[], z0: number, z1: number, m: THREE.Material | THREE.Material[]): THREE.Mesh {
  const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, z0, 0);
  const me = new THREE.Mesh(g, m);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

export function himmelsrichtung(text: string | undefined): P2 | null {
  const t = (text ?? "").toLowerCase();
  if (t.startsWith("süd") || t.startsWith("sued")) return [0, 1];
  if (t.startsWith("nord")) return [0, -1];
  if (t.startsWith("ost")) return [1, 0];
  if (t.startsWith("west")) return [-1, 0];
  return null;
}

export function farbeFlaeche(f: any): string {
  if (f?.farbe_hex) return f.farbe_hex;
  const s = String(f?.farbe ?? "").toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/fichte|holz/.test(s) || /holz/i.test(f?.material ?? "")) return HOLZ_FICHTE;
  if (/alu|grau/.test(s)) return "#bdb7ad";
  return "#f1efea";
}

export function artFlaeche(f: any): Art {
  const m = String(f?.material ?? "").toLowerCase();
  if (/holz/.test(m)) return "holz";
  if (/alu|metall/.test(m)) return "glatt";
  if (/fliese/.test(m)) return "fliese";
  if (/beton|stein/.test(m)) return "beton";
  if (/parkett|diele/.test(m)) return "parkett";
  return "putz";
}

// ---------------------------------------------------------------------------
// Wände
// ---------------------------------------------------------------------------
export function wandInfos(m: any, M: Masse): WandInfo[] {
  const gz: Record<string, number> = {};
  for (const g of m.geschosse) gz[g.id] = g.z ?? 0;
  const mitte: P2 = [M.W / 2, M.L / 2];
  const out: WandInfo[] = [];
  for (const w of m.waende) {
    const [x0, y0] = w.von, [x1, y1] = w.bis;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.01) continue;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const nx = -uy, ny = ux;
    const d = w.dicke ?? 0.175;
    const aussen = ["aussen", "glasfront", "kniestock"].includes(w.typ);
    let ax = x0, ay = y0, bx = x1, by = y1, versatz = 0;
    if (aussen) {
      const mx = (x0 + x1) / 2 - mitte[0], my = (y0 + y1) / 2 - mitte[1];
      const s = mx * nx + my * ny > 0 ? 1 : -1;
      ax += (s * nx * d) / 2; ay += (s * ny * d) / 2; bx += (s * nx * d) / 2; by += (s * ny * d) / 2;
      ax -= ux * d; ay -= uy * d; bx += ux * d; by += uy * d;
      versatz = d;
    }
    const z0 = gz[w.geschoss] ?? 0;
    const L = len + 2 * versatz;
    let oben: (u: number) => number;
    const xAt = (u: number) => ax + ux * u;
    if (w.geschoss === "EG") {
      oben = w.typ === "lamellen" ? () => z0 + (w.hoehe ?? 2.68) : () => M.ogZ;
    } else if (w.typ === "kniestock") {
      oben = () => z0 + (w.hoehe ?? M.traufe - M.ogZ);
    } else if (w.typ === "glasbruestung") {
      oben = () => z0 + (w.hoehe ?? 1.0);
    } else if (w.typ === "aussen") {
      // Giebel bis unter das Dach
      oben = (u) => (Math.abs(ux) > 0.5 ? dachInnen(M, xAt(u)) : M.traufe);
    } else {
      // Innenwand OG: bis Dach bzw. höchstens Pfettenunterkante
      oben = (u) => Math.min(dachInnen(M, xAt(u)), M.pfetteUK);
    }
    out.push({
      id: w.id, geschoss: w.geschoss, typ: w.typ, a: [ax, ay], b: [bx, by], ux, uy, nx, ny, dicke: d, laenge: L,
      versatzU: versatz, z0, oben, oeffnungen: [], daten: w,
    });
  }
  for (const o of m.oeffnungen) {
    let best: WandInfo | null = null, bestD = 1e9;
    for (const w of out) {
      if (w.geschoss !== o.geschoss) continue;
      const dist = (p: P2) => Math.abs((p[0] - w.a[0]) * w.nx + (p[1] - w.a[1]) * w.ny);
      const d1 = dist(o.p1), d2 = dist(o.p2);
      if (d1 > w.dicke / 2 + 0.04 || d2 > w.dicke / 2 + 0.04) continue;
      const u1 = (o.p1[0] - w.a[0]) * w.ux + (o.p1[1] - w.a[1]) * w.uy;
      const u2 = (o.p2[0] - w.a[0]) * w.ux + (o.p2[1] - w.a[1]) * w.uy;
      if (Math.min(u1, u2) < -0.01 || Math.max(u1, u2) > w.laenge + 0.01) continue;
      if (d1 + d2 < bestD) { bestD = d1 + d2; best = w; }
    }
    if (!best) continue;
    const u1 = (o.p1[0] - best.a[0]) * best.ux + (o.p1[1] - best.a[1]) * best.uy;
    const u2 = (o.p2[0] - best.a[0]) * best.ux + (o.p2[1] - best.a[1]) * best.uy;
    const zb = best.z0 + (o.bruestung ?? 0);
    best.oeffnungen.push({ id: o.id, typ: o.typ, u0: Math.min(u1, u2), u1: Math.max(u1, u2), z0: zb, z1: zb + (o.hoehe ?? 2.0), daten: o });
  }
  return out;
}

function wandMatrix(w: WandInfo): THREE.Matrix4 {
  const U = new THREE.Vector3(w.ux, 0, w.uy);
  const Y = new THREE.Vector3(0, 1, 0);
  const N = new THREE.Vector3().crossVectors(U, Y);
  return new THREE.Matrix4().makeBasis(U, Y, N).setPosition(w.a[0], 0, w.a[1]);
}

function wandUmriss(w: WandInfo, u0 = 0, u1 = w.laenge, zu0?: number, zu1?: number): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  const unten = zu0 ?? w.z0;
  pts.push(new THREE.Vector2(u0, unten), new THREE.Vector2(u1, unten));
  const schritte = w.typ === "aussen" || w.geschoss === "OG" ? 24 : 1;
  for (let i = schritte; i >= 0; i--) {
    const u = u0 + ((u1 - u0) * i) / schritte;
    pts.push(new THREE.Vector2(u, zu1 !== undefined ? Math.min(zu1, w.oben(u)) : w.oben(u)));
  }
  return new THREE.Shape(pts);
}

interface WandMats { plus: THREE.Material; minus: THREE.Material; rest: THREE.Material }

function wandMesh(w: WandInfo, mats: WandMats): THREE.Mesh {
  const s = wandUmriss(w);
  for (const o of w.oeffnungen) {
    const top = Math.min(o.z1, w.oben((o.u0 + o.u1) / 2) - 0.02);
    const h = new THREE.Path();
    h.moveTo(o.u0, o.z0 + (o.z0 <= w.z0 + 0.001 ? -0.001 : 0));
    h.lineTo(o.u0, top);
    h.lineTo(o.u1, top);
    h.lineTo(o.u1, o.z0);
    h.lineTo(o.u0, o.z0);
    // Öffnungen am Boden: Umriss unten aufschneiden statt Loch
    if (o.z0 <= w.z0 + 0.01) continue;
    s.holes.push(h);
  }
  let geo: THREE.BufferGeometry;
  const boden = w.oeffnungen.filter((o) => o.z0 <= w.z0 + 0.01).sort((a, b) => a.u0 - b.u0);
  if (boden.length) {
    // Wand in Stücke zwischen den bodentiefen Öffnungen zerlegen, über den Öffnungen Sturz
    const teile: THREE.BufferGeometry[] = [];
    let u = 0;
    const loecher = s.holes;
    const stueck = (a: number, b: number) => {
      if (b - a < 0.005) return;
      const sh = wandUmriss(w, a, b);
      sh.holes = loecher.filter((h) => {
        const p = h.getPoints();
        const minU = Math.min(...p.map((q) => q.x)), maxU = Math.max(...p.map((q) => q.x));
        return minU > a && maxU < b;
      });
      teile.push(new THREE.ExtrudeGeometry(sh, { depth: w.dicke, bevelEnabled: false }));
    };
    for (const o of boden) {
      stueck(u, o.u0);
      const top = Math.min(o.z1, w.oben((o.u0 + o.u1) / 2));
      if (w.oben(o.u0) - top > 0.01) {
        const sh = wandUmriss(w, o.u0, o.u1, top);
        teile.push(new THREE.ExtrudeGeometry(sh, { depth: w.dicke, bevelEnabled: false }));
      }
      u = o.u1;
    }
    stueck(u, w.laenge);
    geo = zusammenfuegen(teile);
  } else {
    geo = new THREE.ExtrudeGeometry(s, { depth: w.dicke, bevelEnabled: false });
  }
  geo.translate(0, 0, -w.dicke / 2);
  geo.applyMatrix4(wandMatrix(w));
  const N = new THREE.Vector3(w.nx, 0, w.ny);
  const g2 = nachNormaleTeilen(geo, N);
  const me = new THREE.Mesh(g2, [mats.plus, mats.minus, mats.rest]);
  me.castShadow = true;
  me.receiveShadow = true;
  me.userData = { art: "wand", wand: w.id, geschoss: w.geschoss };
  return me;
}

function zusammenfuegen(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = [], U: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.getAttribute("position"), uv = g.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      P.push(p.getX(i), p.getY(i), p.getZ(i));
      U.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  return out;
}

/** Welche Seite (plus = Normalenrichtung) einer Wand meint ein Oberflächen-Eintrag? */
export function seiteVon(f: any, w: WandInfo, m: any): "plus" | "minus" {
  const r = himmelsrichtung(f.seite);
  if (r) return r[0] * w.nx + r[1] * w.ny >= 0 ? "plus" : "minus";
  const raum = m.raeume.find((x: any) => x.id === f.raum);
  if (raum) {
    const c = raum.polygon.reduce((s: P2, p: P2) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    const cx = c[0] / raum.polygon.length, cy = c[1] / raum.polygon.length;
    return (cx - w.a[0]) * w.nx + (cy - w.a[1]) * w.ny >= 0 ? "plus" : "minus";
  }
  return "plus";
}

/**
 * Verlauf einer Linienleuchte (LED-Streifen, Stromschiene) in Modellkoordinaten mit absoluter Höhe.
 *  - an: "pfette"              → Unterseite der Pfette, bereich = [y von, y bis]
 *  - wand + seite              → entlang der Wandoberkante (folgt der Dachschräge), abstand_oben, abstand_wand
 *  - pfad [[x, y, z], …]       → z über Geschossboden
 * Liefert außerdem die Richtung in den Raum (Normale der Wandseite) für schräg ausgerichtete Spots.
 */
export function leuchtePfad(le: any, M: Masse, waende: WandInfo[]): { punkte: [number, number, number][]; raum: P2 | null } | null {
  const basis = le.geschoss === "OG" ? M.ogZ : 0;
  if (le.an === "pfette") {
    const [y0, y1] = le.bereich ?? [0.3, M.L - 0.2];
    const z = M.pfetteUK - (le.abstand_oben ?? 0.03);
    return { punkte: [[M.firstX, y0, z], [M.firstX, y1, z]], raum: null };
  }
  if (le.wand) {
    const w = waende.find((x) => x.id === le.wand);
    if (!w) return null;
    const r = himmelsrichtung(le.seite);
    const s = r ? (r[0] * w.nx + r[1] * w.ny >= 0 ? 1 : -1) : 1;
    const ab = w.dicke / 2 + (le.abstand_wand ?? 0.04);
    const [uA, uB] = le.bereich ?? [w.versatzU + 0.05, w.laenge - w.versatzU - 0.05];
    const punkte: [number, number, number][] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const u = uA + ((uB - uA) * i) / n;
      punkte.push([w.a[0] + w.ux * u + w.nx * s * ab, w.a[1] + w.uy * u + w.ny * s * ab, w.oben(u) - (le.abstand_oben ?? 0.06)]);
    }
    return { punkte, raum: [w.nx * s, w.ny * s] };
  }
  if (Array.isArray(le.pfad) && le.pfad.length >= 2)
    return { punkte: le.pfad.map((p: number[]) => [p[0], p[1], basis + (p[2] ?? 2.4)] as [number, number, number]), raum: null };
  return null;
}

/** Lage einer Wand-Teilfläche: Seite und u-Bereich entlang der Wand (für den Plan). */
export function flaecheLage(f: any, w: WandInfo, m: any): { seite: "plus" | "minus"; uA: number; uB: number; teil: boolean } {
  const seite = seiteVon(f, w, m);
  const ber: [number, number] | undefined = Math.abs(w.ux) > 0.5 ? f.x : f.y;
  const achse0 = Math.abs(w.ux) > 0.5 ? w.a[0] : w.a[1];
  const richt = Math.abs(w.ux) > 0.5 ? w.ux : w.uy;
  let uA = w.versatzU, uB = w.laenge - w.versatzU;
  if (ber) {
    const a = (ber[0] - achse0) / richt, b = (ber[1] - achse0) / richt;
    uA = Math.max(0, Math.min(a, b));
    uB = Math.min(w.laenge, Math.max(a, b));
  }
  return { seite, uA, uB, teil: !!ber };
}

export function seitenName(w: WandInfo, seite: "plus" | "minus"): string {
  const s = seite === "plus" ? 1 : -1;
  const nx = w.nx * s, ny = w.ny * s;
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? "Ost" : "West";
  return ny > 0 ? "Süd" : "Nord";
}

function wandStandardMat(w: WandInfo, std: any, seite: "plus" | "minus"): THREE.Material {
  const innen = w.typ === "innen" || w.typ === "lamellen";
  // Außenseite von Außenwänden: Putz hell
  const mx = w.a[0] + w.nx * (seite === "plus" ? 1 : -1);
  void mx;
  if (!innen) {
    const cx = 3.89, cy = 5.5;
    const d = (cx - w.a[0]) * w.nx + (cy - w.a[1]) * w.ny;
    const istInnen = (d >= 0) === (seite === "plus");
    if (!istInnen) return mat("#e9e6df", "putz");
  }
  return mat(farbeFlaeche(std), artFlaeche(std));
}

function oberflaechenAnwenden(m: any, waende: WandInfo[], gruppe: THREE.Group, wandMeshes: THREE.Mesh[]) {
  const ob = m.oberflaechen ?? {};
  const std = ob.standard ?? { farbe: "weiß", material: "Rollputz" };
  for (const me of wandMeshes) {
    const w = waende.find((x) => x.id === me.userData.wand)!;
    const mats = me.material as THREE.Material[];
    mats[0] = wandStandardMat(w, std, "plus");
    mats[1] = wandStandardMat(w, std, "minus");
  }
  for (const f of ob.flaechen ?? []) {
    if (!f.wand) continue;
    const w = waende.find((x) => x.id === f.wand);
    const me = wandMeshes.find((x) => x.userData.wand === f.wand);
    if (!w || !me) continue;
    const seite = seiteVon(f, w, m);
    const material = mat(farbeFlaeche(f), artFlaeche(f), { name: `Fläche ${f.id}` });
    // Teilbereich? (x- oder y-Bereich entlang der Wand, z-Bereich)
    const ber: [number, number] | undefined = Math.abs(w.ux) > 0.5 ? f.x : f.y;
    const achse0 = Math.abs(w.ux) > 0.5 ? w.a[0] : w.a[1];
    const richt = Math.abs(w.ux) > 0.5 ? w.ux : w.uy;
    let uA = 0, uB = w.laenge;
    if (ber) {
      const a = (ber[0] - achse0) / richt, b = (ber[1] - achse0) / richt;
      uA = Math.max(0, Math.min(a, b));
      uB = Math.min(w.laenge, Math.max(a, b));
    }
    const zA = f.z ? f.z[0] : w.z0;
    const zB = f.z ? f.z[1] : 99;
    const ganz = uA <= w.versatzU + 0.05 && uB >= w.laenge - w.versatzU - 0.05 && zA <= w.z0 + 0.02 &&
      zB >= Math.max(...[0, 0.25, 0.5, 0.75, 1].map((t) => w.oben(t * w.laenge))) - 0.02;
    if (ganz) {
      (me.material as THREE.Material[])[seite === "plus" ? 0 : 1] = material;
      continue;
    }
    // Teilfläche als dünne Verkleidung vor der Wand
    const sh = wandUmriss(w, uA, uB, Math.max(zA, w.z0), zB);
    for (const o of w.oeffnungen) {
      if (o.u0 > uA && o.u1 < uB && o.z0 > zA && o.z1 < zB) {
        const h = new THREE.Path();
        h.moveTo(o.u0, o.z0); h.lineTo(o.u1, o.z0); h.lineTo(o.u1, o.z1); h.lineTo(o.u0, o.z1); h.lineTo(o.u0, o.z0);
        sh.holes.push(h);
      }
    }
    const g = new THREE.ShapeGeometry(sh);
    const s = seite === "plus" ? 1 : -1;
    g.translate(0, 0, s * (w.dicke / 2 + 0.004));
    g.applyMatrix4(wandMatrix(w));
    const pm = new THREE.Mesh(g, material.clone());
    (pm.material as THREE.Material).side = THREE.DoubleSide;
    pm.receiveShadow = true;
    pm.userData = { art: "wand", wand: w.id, geschoss: w.geschoss, flaeche: f.id };
    gruppe.add(pm);
  }
}

// ---------------------------------------------------------------------------
// Öffnungen ausstatten (Rahmen, Glas, Türblätter)
// ---------------------------------------------------------------------------
function oeffnungenAusstatten(w: WandInfo, g: THREE.Group, innen: number) {
  const rahmen = mat(ZARGE, "metall", { name: "Rahmen" });
  const glas = mat("#ffffff", "glas");
  const weiss = mat("#f4f2ee", "glatt", { name: "Zarge" });
  const M = wandMatrix(w);
  const lokal = (o: THREE.Object3D) => {
    o.applyMatrix4(M);
    g.add(o);
  };
  for (const o of w.oeffnungen) {
    const b = o.u1 - o.u0, h = o.z1 - o.z0, uc = (o.u0 + o.u1) / 2, zc = (o.z0 + o.z1) / 2;
    const mk = (bw: number, bh: number, bd: number, m: THREE.Material, u: number, z: number, wv = 0, schatten = true) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
      me.position.set(u, z, wv);
      me.castShadow = schatten;
      me.receiveShadow = true;
      lokal(me);
      return me;
    };
    const glasScheibe = (u: number, z: number, bw: number, bh: number) => {
      const me = mk(bw, bh, 0.012, glas, u, z, 0, false);
      me.userData = { art: "glas" };
    };
    const p = 0.06; // Profil
    if (["fenster", "festverglasung", "hebeschiebetuer"].includes(o.typ)) {
      mk(b, p, 0.08, rahmen, uc, o.z0 + p / 2);
      mk(b, p, 0.08, rahmen, uc, o.z1 - p / 2);
      mk(p, h, 0.08, rahmen, o.u0 + p / 2, zc);
      mk(p, h, 0.08, rahmen, o.u1 - p / 2, zc);
      const felder = o.typ === "hebeschiebetuer" ? 2 : o.typ === "festverglasung" ? Math.max(1, Math.round(b / 1.7)) : 1;
      for (let i = 1; i < felder; i++) mk(p * 1.4, h, 0.09, rahmen, o.u0 + (b * i) / felder, zc);
      glasScheibe(uc, zc, b - p, h - p);
      if (o.typ === "fenster" && o.z0 > w.z0 + 0.3) {
        // Fensterbank innen
        mk(b + 0.04, 0.02, 0.2, mat("#e8e4dc", "beton", { name: "Fensterbank" }), uc, o.z0 - 0.01, innen * (w.dicke / 2 - 0.05));
      }
    } else if (o.typ === "haustuer") {
      const tb = Math.min(1.05, b * 0.65);
      mk(b, p, 0.09, rahmen, uc, o.z1 - p / 2);
      mk(p, h, 0.09, rahmen, o.u0 + p / 2, zc);
      mk(p, h, 0.09, rahmen, o.u1 - p / 2, zc);
      mk(p, h, 0.09, rahmen, o.u0 + tb, zc);
      mk(tb - p, h - p, 0.06, mat("#2f3133", "glatt", { name: "Haustür" }), o.u0 + tb / 2 + p / 4, zc - p / 2);
      const st = mk(b - tb - p, h - p, 0.02, mat("#eef2f2", "glatt", { name: "Milchglas" }), o.u0 + tb + (b - tb) / 2, zc - p / 2, 0, false);
      st.userData = { art: "glas" };
    } else if (o.typ === "tuer") {
      const z = 0.03;
      mk(z, h, w.dicke + 0.02, weiss, o.u0 - z / 2, zc);
      mk(z, h, w.dicke + 0.02, weiss, o.u1 + z / 2, zc);
      mk(b + 2 * z, z, w.dicke + 0.02, weiss, uc, o.z1 + z / 2);
    } else if (o.typ === "schiebetuer") {
      const pb = o.daten.parkbereich as P2[] | undefined;
      // Türblatt in Parkposition vor der Wand (Galerieseite angenommen)
      let uP = uc + b;
      if (pb) {
        const a = (pb[0][0] - w.a[0]) * w.ux + (pb[0][1] - w.a[1]) * w.uy;
        const c = (pb[1][0] - w.a[0]) * w.ux + (pb[1][1] - w.a[1]) * w.uy;
        uP = (a + c) / 2;
      }
      mk(b + 0.06, h + 0.02, 0.04, mat("#f4f2ee", "glatt", { name: "Schiebetür" }), uP, zc + 0.01, w.dicke / 2 + 0.04);
      mk(b * 2 + 0.2, 0.04, 0.05, rahmen, (uc + uP) / 2, o.z1 + 0.04, w.dicke / 2 + 0.04);
    }
  }
}

function lamellen(w: WandInfo, g: THREE.Group, koll: KollSeg[]) {
  const m = mat(EICHE, "holz", { name: "Lamellen Eiche" });
  const h = w.oben(0) - w.z0;
  const M = wandMatrix(w);
  const n = Math.floor(w.laenge / 0.1);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const geo = new THREE.BoxGeometry(0.04, h, 0.06);
    geo.translate(0.05 + i * 0.1, w.z0 + h / 2, 0);
    geos.push(geo);
  }
  const inst = new THREE.Mesh(mergeGeometries(geos), m);
  inst.applyMatrix4(M);
  inst.castShadow = true;
  inst.receiveShadow = true;
  g.add(inst);
  koll.push({ ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], r: 0.05, z0: w.z0, z1: w.z0 + h });
}

// ---------------------------------------------------------------------------
// Treppe (halbgewendelt) – Geometrie und Lauflinie fürs Begehen
// ---------------------------------------------------------------------------
export interface TreppenWeg {
  zone: (x: number, y: number) => boolean;
  hoehe: (x: number, y: number) => number;
  /** Steigungslinie über den Stufenvorderkanten (glatt) – für Handlauf und Wangen */
  lauf: (x: number, y: number) => number;
  stufen: { poly: P2[]; z: number }[];
  innen: { unten: [P2, P2]; oben: [P2, P2] };
}

export function treppenWeg(m: any, M: Masse): TreppenWeg {
  const t = m.feste_elemente.find((f: any) => String(f.typ).startsWith("treppe"));
  const ul = t?.unterer_lauf?.polygon ?? [[0, 6.195], [1.563, 6.195], [1.563, 7.115], [0, 7.115]];
  const ol = t?.oberer_lauf?.polygon ?? [[0, 5.175], [2.98, 5.175], [2.98, 6.095], [0, 6.095]];
  const xs = (p: P2[]) => p.map((q) => q[0]), ys = (p: P2[]) => p.map((q) => q[1]);
  const uX1 = Math.max(...xs(ul)), uY0 = Math.min(...ys(ul)), uY1 = Math.max(...ys(ul));
  const oX1 = Math.max(...xs(ol)), oY0 = Math.min(...ys(ol)), oY1 = Math.max(...ys(ol));
  const breite = t?.wange_ak ?? 0.92;
  const cx = breite, cy = (uY0 + oY1) / 2;
  const yU = (uY0 + uY1) / 2;
  const r = yU - cy;
  const l1 = uX1 - cx, l2 = Math.PI * r, l3 = oX1 - cx;
  const L = l1 + l2 + l3;
  const n = (t?.steigungen ?? 16) - 1; // Auftritte
  const steig = (t?.steigung ?? M.ogZ / (n + 1));
  const sVon = (x: number, y: number) => {
    if (y >= cy && x > cx) return Math.max(0, uX1 - x);
    if (x <= cx) {
      const phi = Math.atan2(-(x - cx), y - cy);
      return l1 + r * Math.max(0, Math.min(Math.PI, phi));
    }
    return l1 + l2 + Math.min(l3, x - cx);
  };
  const zone = (x: number, y: number) =>
    (x >= 0 && x <= oX1 && y >= oY0 && y <= cy) || (x >= 0 && x <= uX1 && y >= cy && y <= uY1);
  // Stufenpolygone
  const stufen: { poly: P2[]; z: number }[] = [];
  const strahl = (phi: number): P2 => {
    const dx = -Math.sin(phi), dy = Math.cos(phi);
    let tt = 1e9;
    if (dx < -1e-6) tt = Math.min(tt, (0 - cx) / dx);
    if (dy > 1e-6) tt = Math.min(tt, (uY1 - cy) / dy);
    if (dy < -1e-6) tt = Math.min(tt, (oY0 - cy) / dy);
    return [cx + dx * tt, cy + dy * tt];
  };
  const ecken = [Math.atan2(cx, uY1 - cy), Math.PI - Math.atan2(cx, cy - oY0)];
  for (let k = 0; k < n; k++) {
    const sa = (k * L) / n, sb = ((k + 1) * L) / n;
    const z = (k + 1) * steig;
    const teil = (a: number, b: number, f: (a: number, b: number) => P2[]) => {
      if (b - a > 1e-4) stufen.push({ poly: f(a, b), z });
    };
    teil(Math.max(sa, 0), Math.min(sb, l1), (a, b) => [[uX1 - b, uY0], [uX1 - a, uY0], [uX1 - a, uY1], [uX1 - b, uY1]]);
    teil(Math.max(sa, l1), Math.min(sb, l1 + l2), (a, b) => {
      const pa = (a - l1) / r, pb = (b - l1) / r;
      const winkel = [pa, ...ecken.filter((e) => e > pa && e < pb), pb];
      return [[cx, cy], ...winkel.map(strahl)];
    });
    teil(Math.max(sa, l1 + l2), Math.min(sb, L), (a, b) => {
      const xa = cx + (a - l1 - l2), xb = cx + (b - l1 - l2);
      return [[xa, oY0], [xb, oY0], [xb, oY1], [xa, oY1]];
    });
  }
  return {
    zone,
    hoehe: (x, y) => {
      const s = sVon(x, y);
      // Stufig fürs Gefühl, aber weich genug fürs Laufen
      const k = Math.min(n, Math.floor((s / L) * n + 0.5));
      return Math.min(M.ogZ, k * steig);
    },
    lauf: (x, y) => steig * (1 + (sVon(x, y) * n) / L),
    stufen,
    innen: { unten: [[uX1, uY0], [cx, uY0]], oben: [[cx, oY1], [oX1, oY1]] },
  };
}

function treppeBauen(weg: TreppenWeg, g: THREE.Group) {
  const holz = mat(EICHE, "holz", { name: "Treppe Eiche" });
  const stahl = mat("#1d1d1d", "metall", { name: "Wange Stahl" });
  for (const s of weg.stufen) {
    const me = prisma(s.poly, s.z - 0.04, s.z, [holz, holz]);
    me.userData = { art: "treppe" };
    g.add(me);
  }
  // Geschlossene Wange an der Südseite des unteren Laufs, Wange an der offenen Seite des oberen Laufs
  const unten = weg.stufen.filter((s) => s.poly.some((p) => p[1] > 7.0));
  if (unten.length) {
    const xMax = Math.max(...unten.flatMap((s) => s.poly.map((p) => p[0])));
    const zMax = Math.max(...unten.map((s) => s.z));
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(xMax, 0), new THREE.Vector2(xMax, 0.25),
      new THREE.Vector2(0, zMax + 0.08)]);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
    const me = new THREE.Mesh(geo, stahl);
    me.position.set(0, 0, 7.115);
    me.castShadow = true;
    g.add(me);
  }
  // Innenwangen (Stahlblech) entlang der Steigungslinie an den offenen Seiten beider Läufe
  for (const [a, b] of [weg.innen.unten, weg.innen.oben]) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const n = 12;
    const oben: THREE.Vector2[] = [], unten: THREE.Vector2[] = [];
    for (let i = 0; i <= n; i++) {
      const u = (L * i) / n;
      const x = a[0] + ux * u, y = a[1] + uy * u;
      const z = weg.lauf(x, y);
      oben.push(new THREE.Vector2(u, z + 0.06));
      unten.push(new THREE.Vector2(u, Math.max(0, z - 0.3)));
    }
    const sh = new THREE.Shape([...unten, ...oben.reverse()]);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
    geo.translate(0, 0, -0.006);
    const U = new THREE.Vector3(ux, 0, uy), Y = new THREE.Vector3(0, 1, 0);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(U, Y, new THREE.Vector3().crossVectors(U, Y)).setPosition(a[0], 0, a[1]));
    const me = new THREE.Mesh(geo, stahl);
    me.castShadow = true;
    me.userData = { art: "treppe" };
    g.add(me);
  }
}

// ---------------------------------------------------------------------------
// Geländer (Relinggeländer: Vierkantpfosten, 4 Rundstäbe, Handlauf Eiche)
// ---------------------------------------------------------------------------
function gelaenderBauen(m: any, M: Masse, weg: TreppenWeg, ziele: Record<string, THREE.Group>, segs: KollSeg[]) {
  const stahl = mat("#1d1d1d", "metall", { name: "Geländer Stahl schwarz" });
  const eiche = mat(EICHE, "holz", { name: "Handlauf Eiche" });
  for (const f of m.feste_elemente ?? []) {
    if (!String(f.typ).startsWith("gelaender") || !Array.isArray(f.punkte) || f.punkte.length < 2) continue;
    const ge = f.geschoss ?? "EG";
    const basis = ge === "OG" ? M.ogZ : 0;
    const hoehe = f.hoehe ?? 0.9;
    const staebe = f.staebe ?? 4;
    const treppe = f.folgt === "treppe";
    const zAn = (p: P2) => (treppe ? weg.lauf(p[0], p[1]) : basis);
    const sub = new THREE.Group();
    sub.userData = { art: "fest", id: f.id };
    const balken = (a: THREE.Vector3, b: THREE.Vector3, quer: [number, number], m2: THREE.Material, rund = false) => {
      const L = a.distanceTo(b);
      const geo = rund ? new THREE.CylinderGeometry(quer[0] / 2, quer[0] / 2, L, 10) : new THREE.BoxGeometry(quer[0], L, quer[1]);
      const me = new THREE.Mesh(geo, m2);
      me.position.copy(a).add(b).multiplyScalar(0.5);
      me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      me.castShadow = true;
      sub.add(me);
    };
    for (let i = 0; i + 1 < f.punkte.length; i++) {
      const a: P2 = f.punkte[i], b: P2 = f.punkte[i + 1];
      const za = zAn(a), zb = zAn(b);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      // Handlauf etwas über die Endpfosten hinaus
      const ue = 0.05;
      const ha = v3(a[0] - ux * ue, a[1] - uy * ue, za + hoehe - ((zb - za) / L) * ue);
      const hb = v3(b[0] + ux * ue, b[1] + uy * ue, zb + hoehe + ((zb - za) / L) * ue);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, ha.distanceTo(hb)), eiche);
      hand.position.copy(ha).add(hb).multiplyScalar(0.5);
      hand.lookAt(hb);
      hand.castShadow = true;
      sub.add(hand);
      for (let k = 1; k <= staebe; k++) {
        const dz = hoehe - 0.06 - (k * (hoehe - 0.18)) / staebe;
        balken(v3(a[0], a[1], za + dz), v3(b[0], b[1], zb + dz), [0.012, 0.012], stahl, true);
      }
      const nP = Math.max(1, Math.round(L / 1.0));
      for (let k = 0; k <= nP; k++) {
        if (k === 0 && i > 0) continue;
        const t = k / nP;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = za + (zb - za) * t;
        const unten = treppe ? Math.max(0, z - 0.32) : basis;
        balken(v3(x, y, unten), v3(x, y, z + hoehe - 0.02), [0.04, 0.04], stahl);
      }
      // Kollision stückweise (Neigung)
      const teile = Math.max(1, Math.ceil(L / 0.25));
      for (let k = 0; k < teile; k++) {
        const t0 = k / teile, t1 = (k + 1) / teile;
        const z0 = za + (zb - za) * t0, z1 = za + (zb - za) * t1;
        segs.push({ ax: a[0] + (b[0] - a[0]) * t0, ay: a[1] + (b[1] - a[1]) * t0, bx: a[0] + (b[0] - a[0]) * t1, by: a[1] + (b[1] - a[1]) * t1,
          r: 0.03, z0: Math.min(z0, z1) - 0.3, z1: Math.max(z0, z1) + hoehe });
      }
    }
    (ge === "OG" ? ziele.og : ziele.eg).add(sub);
  }
}

// ---------------------------------------------------------------------------
// Feste Elemente (Küche, Bad, Technik)
// ---------------------------------------------------------------------------
function festeElemente(m: any, M: Masse, g: THREE.Group, koll: KollBox[]) {
  const gAussen = g;
  const front = mat("#cfc8bb", "glatt", { name: "Küchenfront Cremegrau" });
  const platte = mat("#e4e0d8", "beton", { name: "Arbeitsplatte Beton" });
  const schwarz = mat("#1f1f1f", "glatt", { name: "Schwarz" });
  const weiss = mat("#f6f5f2", "glatt", { name: "Keramik weiß" });
  const gz: Record<string, number> = {};
  for (const ge of m.geschosse) gz[ge.id] = ge.z ?? 0;
  for (const f of m.feste_elemente) {
    const z0 = gz[f.geschoss ?? "EG"] ?? 0;
    if (f.rechteck) {
      const [[x0, y0], [x1, y1]] = f.rechteck;
      const w = Math.abs(x1 - x0), d = Math.abs(y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const h = f.hoehe ?? 0.9;
      const typ = String(f.typ);
      const sub = new THREE.Group();
      sub.userData = { art: "fest", id: f.id };
      if (typ.startsWith("unterschrank") || typ === "spuelenschrank" || typ === "geschirrspueler" || typ === "backofen_kochfeld") {
        sub.add(box(w - 0.004, h - 0.14, d - 0.004, front, cx, cy, z0 + 0.1 + (h - 0.14) / 2));
        sub.add(box(w, 0.1, d - 0.06, schwarz, cx, cy, z0 + 0.05));
        sub.add(box(w, 0.04, d, platte, cx, cy, z0 + h - 0.02));
        if (typ === "spuelenschrank") sub.add(box(Math.min(w, d) * 0.6, 0.012, Math.max(w, d) * 0.55, mat("#2a2a2a", "metall"), cx, cy, z0 + h + 0.001));
        if (typ === "backofen_kochfeld") {
          sub.add(box(w * 0.85, 0.006, d * 0.85, mat("#111111", "glatt", { name: "Kochfeld" }), cx, cy, z0 + h + 0.003));
        }
      } else if (typ.startsWith("hochschrank")) {
        sub.add(box(w - 0.004, h - 0.1, d - 0.004, front, cx, cy, z0 + 0.1 + (h - 0.1) / 2));
        sub.add(box(w, 0.1, d - 0.06, schwarz, cx, cy, z0 + 0.05));
      } else if (typ === "dusche_walkin") {
        sub.add(box(w, 0.01, d, mat("#b9b4ab", "beton", { name: "Duschboden" }), cx, cy, z0 + 0.005));
        if (f.glaswand) {
          const [[a0, b0], [a1, b1]] = f.glaswand;
          const gl = box(Math.max(0.01, Math.abs(a1 - a0)), 2.0, Math.max(0.01, Math.abs(b1 - b0)), mat("#ffffff", "glas"), (a0 + a1) / 2, (b0 + b1) / 2, z0 + 1.02, false);
          gl.userData = { art: "glas" };
          sub.add(gl);
          koll.push({ cx: (a0 + a1) / 2, cy: (b0 + b1) / 2, hw: Math.max(0.02, Math.abs(a1 - a0) / 2), hd: Math.max(0.02, Math.abs(b1 - b0) / 2), rot: 0, z0, z1: z0 + 2 });
        }
        sub.add(box(0.25, 0.01, 0.25, schwarz, x1 - 0.35, y0 + 0.4, z0 + 2.2));
        sub.add(box(0.02, 0.4, 0.02, schwarz, x1 - 0.35, y0 + 0.15, z0 + 2.4));
      } else if (typ === "waschtisch_aufsatz") {
        sub.add(box(w, 0.5, d, mat("#f2f0ec", "glatt", { name: "Waschtisch Front" }), cx, cy, z0 + h - 0.32));
        sub.add(box(w + 0.01, 0.04, d + 0.01, mat(EICHE, "holz"), cx, cy, z0 + h - 0.02));
        const becken = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.13, 32), weiss);
        becken.position.copy(v3(cx + 0.03, cy, z0 + h + 0.065));
        becken.castShadow = true;
        sub.add(becken);
        koll.push({ cx, cy, hw: w / 2, hd: d / 2, rot: 0, z0, z1: z0 + h });
      } else if (typ === "handtuchheizkoerper") {
        for (let i = 0; i < 9; i++) sub.add(box(0.03, 0.025, d, schwarz, cx, cy, z0 + 0.25 + i * 0.12));
      } else if (typ === "speicher_technik") {
        for (const yy of [y0 + d * 0.27, y0 + d * 0.73]) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d / 2) * 0.42, Math.min(w, d / 2) * 0.42, 1.9, 32), mat("#eeeeee", "glatt", { name: "Speicher" }));
          c.position.copy(v3(cx, yy, z0 + 0.95));
          c.castShadow = true;
          sub.add(c);
        }
        koll.push({ cx, cy, hw: w / 2, hd: d / 2, rot: 0, z0, z1: z0 + 1.9 });
      } else {
        sub.add(box(w, h, d, front, cx, cy, z0 + h / 2));
      }
      if (/unterschrank|spuelen|geschirr|backofen|hochschrank/.test(typ)) koll.push({ cx, cy, hw: w / 2, hd: d / 2, rot: 0, z0, z1: z0 + h });
      g.add(sub);
    } else if (f.typ === "klimageraet_innen" && f.pos) {
      const [b, t, h] = f.masse ?? [0.9, 0.22, 0.3];
      // Gerät an der Ostwand: Breite entlang y
      const k = box(t, h, b, mat("#f7f7f5", "glatt", { name: "Klimagerät" }), f.pos[0] + 0.08 - t / 2, f.pos[1], (f.z ?? 2.85));
      const sub = new THREE.Group();
      sub.userData = { art: "fest", id: f.id };
      sub.add(k);
      g.add(sub);
    } else if (f.typ === "wc_wandhaengend" && f.pos) {
      const sub = new THREE.Group();
      sub.userData = { art: "fest", id: f.id };
      g.add(sub);
      g = sub as any;
      if (f.vorwand) {
        const [[x0, y0], [x1, y1]] = f.vorwand;
        const vw = box(Math.abs(x1 - x0), f.vorwand_hoehe ?? 1.2, Math.abs(y1 - y0), mat("#bdb7ad", "glatt", { name: "Vorwand Alu" }), (x0 + x1) / 2, (y0 + y1) / 2, z0 + (f.vorwand_hoehe ?? 1.2) / 2);
        g.add(vw);
        koll.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.abs(x1 - x0) / 2, hd: Math.abs(y1 - y0) / 2, rot: 0, z0, z1: z0 + 1.2 });
      }
      const wc = new THREE.Group();
      const sch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), weiss);
      sch.scale.set(1, 0.55, 1.45);
      sch.position.set(0, 0, 0);
      sch.castShadow = true;
      wc.add(sch);
      const deckel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 24), weiss);
      deckel.scale.set(1, 1, 1.45);
      deckel.position.set(0, 0.11, 0);
      wc.add(deckel);
      wc.position.copy(v3(f.pos[0] - 0.05, f.pos[1], z0 + 0.32));
      wc.rotation.y = (-(f.rot ?? 270) * Math.PI) / 180 + Math.PI / 2;
      g.add(wc);
      g = gAussen;
    }
  }
}

// ---------------------------------------------------------------------------
// Gesamtaufbau
// ---------------------------------------------------------------------------
export function hausBauen(m: any): HausErgebnis {
  const M = masse(m);
  const gruppe = new THREE.Group();
  gruppe.name = "Haus";
  const teile: Record<string, THREE.Group> = {};
  for (const k of ["eg", "og", "ogDecke", "dach", "aussen"]) {
    teile[k] = new THREE.Group();
    teile[k].name = k;
    gruppe.add(teile[k]);
  }
  const segs: KollSeg[] = [];
  const boxen: KollBox[] = [];
  const waende = wandInfos(m, M);
  const wandMeshes: THREE.Mesh[] = [];
  const rest = mat("#efede8", "putz", { name: "Laibung" });
  const glas = mat("#ffffff", "glas");

  for (const w of waende) {
    const ziel = w.geschoss === "OG" ? teile.og : teile.eg;
    if (w.typ === "lamellen") {
      lamellen(w, ziel, segs);
      continue;
    }
    if (w.typ === "glasbruestung") {
      const sh = wandUmriss(w);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
      geo.translate(0, 0, -0.006);
      geo.applyMatrix4(wandMatrix(w));
      const me = new THREE.Mesh(geo, glas);
      me.userData = { art: "glas" };
      ziel.add(me);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(w.laenge, 0.03, 0.04), mat("#1d1d1d", "metall"));
      hand.position.set(w.laenge / 2, w.oben(0), 0);
      hand.applyMatrix4(wandMatrix(w));
      ziel.add(hand);
      segs.push({ ax: w.a[0], ay: w.a[1], bx: w.b[0], by: w.b[1], r: 0.03, z0: w.z0, z1: w.z0 + 1.0 });
      continue;
    }
    const me = wandMesh(w, { plus: rest, minus: rest, rest });
    ziel.add(me);
    wandMeshes.push(me);
    const innenSeite = (M.W / 2 - w.a[0]) * w.nx + (M.L / 2 - w.a[1]) * w.ny >= 0 ? 1 : -1;
    oeffnungenAusstatten(w, ziel, innenSeite);
    // Kollision: Wand ohne begehbare Öffnungen
    const luecken = w.oeffnungen
      .filter((o) => ["tuer", "schiebetuer", "durchgang"].includes(o.typ) || o.daten.oeffnung)
      .map((o) => {
        if (o.daten.oeffnung) {
          const [p1, p2] = o.daten.oeffnung as P2[];
          const a = (p1[0] - w.a[0]) * w.ux + (p1[1] - w.a[1]) * w.uy, b = (p2[0] - w.a[0]) * w.ux + (p2[1] - w.a[1]) * w.uy;
          return [Math.min(a, b), Math.max(a, b)];
        }
        return [o.u0, o.u1];
      })
      .sort((a, b) => a[0] - b[0]);
    let u = 0;
    const top = Math.max(w.oben(0), w.oben(w.laenge / 2), w.oben(w.laenge));
    for (const [a, b] of [...luecken, [w.laenge, w.laenge]]) {
      if (a - u > 0.01)
        segs.push({ ax: w.a[0] + w.ux * u, ay: w.a[1] + w.uy * u, bx: w.a[0] + w.ux * a, by: w.a[1] + w.uy * a, r: w.dicke / 2, z0: w.z0, z1: top });
      u = Math.max(u, b);
    }
  }
  oberflaechenAnwenden(m, waende, gruppe, wandMeshes);

  // Böden
  const ob = m.oberflaechen ?? {};
  const bodenMat = (raum: any) => {
    const f = (ob.flaechen ?? []).find((x: any) => x.art === "boden" && x.raum === raum.id);
    if (f) return mat(farbeFlaeche(f), artFlaeche(f).replace("putz", "parkett") as Art, { name: `Boden ${raum.id}` });
    if (raum.id === "bad") return mat("#c9c4bb", "fliese", { name: "Boden Bad" });
    if (raum.id === "hwr") return mat("#bdb8ae", "beton", { name: "Boden HWR" });
    return mat("#c8a274", "parkett", { name: "Parkett Eiche" });
  };
  const aussenW = 0.36;
  teile.eg.add(prisma([[-aussenW, -aussenW], [M.W + aussenW, -aussenW], [M.W + aussenW, M.L + aussenW], [-aussenW, M.L + aussenW]], -0.3, -0.001, mat("#8f8a82", "beton")));
  for (const r of m.raeume) {
    const ziel = r.geschoss === "OG" ? teile.og : teile.eg;
    const z = (r.geschoss === "OG" ? M.ogZ : 0) + 0.002;
    const me = flaeche(r.polygon, z, bodenMat(r));
    me.userData = { art: "boden", raum: r.id, geschoss: r.geschoss };
    ziel.add(me);
  }
  // Parkett auch unter den Türen / Lücken im EG
  teile.eg.add(flaeche([[0, 0], [M.W, 0], [M.W, M.L], [0, M.L]], 0.0005, mat("#c8a274", "parkett", { name: "Parkett Eiche" })));

  // OG-Decke (Sichtholz), Balken, Deckenstirn
  const loch = m.feste_elemente.find((f: any) => String(f.typ).startsWith("treppe"))?.gesamt_aussenmass?.deckenloch_laenge ?? 2.98;
  const galerie = m.raeume.find((r: any) => r.id === "galerie");
  const kanteY = galerie ? Math.max(...galerie.polygon.map((p: P2) => p[1])) : 6.525;
  const kinder = m.raeume.find((r: any) => r.id === "kinder");
  const lochY0 = kinder ? Math.max(...kinder.polygon.map((p: P2) => p[1])) + 0.175 : 5.34;
  const ogPoly: P2[] = [[0, 0], [M.W, 0], [M.W, kanteY], [loch, kanteY], [loch, lochY0], [0, lochY0]];
  const egD = m.geschosse.find((g: any) => g.id === "EG")?.decke ?? {};
  const schalung = M.ogZ - 0.13;
  const holz = mat(HOLZ_FICHTE, "holz", { name: "Sichtholz Fichte" });
  const decke = new THREE.Group();
  decke.name = "EG-Decke";
  const stirn = prisma(ogPoly, schalung, M.ogZ - 0.003, [holz, holz]);
  stirn.userData = { art: "decke" };
  decke.add(stirn);
  const bb = egD.balken_breite ?? 0.1, bh = egD.balken_hoehe ?? 0.21, ab = egD.balken_achsabstand ?? 0.625;
  const bUK = egD.balken_unterkante_z ?? schalung - bh;
  for (let y = ab / 2; y < kanteY - 0.05; y += ab) {
    const x0 = y > lochY0 ? loch : 0;
    decke.add(box(M.W - x0, schalung - bUK, bb, holz, (x0 + M.W) / 2, y, (bUK + schalung) / 2));
  }
  decke.add(box(M.W - loch, schalung - bUK, bb, holz, (loch + M.W) / 2, kanteY - bb / 2, (bUK + schalung) / 2));
  teile.ogDecke.add(decke);

  // OG-Boden als Platte (Oberseite) – Räume liegen darüber
  const ogBoden = flaeche(ogPoly, M.ogZ, mat("#c8a274", "parkett", { name: "Parkett Eiche" }));
  ogBoden.userData = { art: "boden", geschoss: "OG" };
  teile.og.add(ogBoden);

  // Kinderzimmer: Decke auf Höhe Pfettenunterkante (Annahme)
  if (kinder) {
    const xk = Math.max(...kinder.polygon.map((p: P2) => p[0])) + 0.0875;
    const xs = (M.pfetteUK - M.traufe) / M.tan;
    if (xs < xk) {
      const km = flaeche([[xs, 0], [xk, 0], [xk, lochY0 - 0.0875], [xs, lochY0 - 0.0875]], M.pfetteUK, mat("#f1efea", "putz", { name: "Decke Kinderzimmer" }), false);
      km.userData = { art: "decke" };
      teile.dach.add(km);
    }
  }

  // Südgiebel verglast über dem EG
  {
    const pts = [new THREE.Vector2(0, M.ogZ), new THREE.Vector2(M.W, M.ogZ), new THREE.Vector2(M.W, M.traufe),
      new THREE.Vector2(M.firstX, dachInnen(M, M.firstX)), new THREE.Vector2(0, M.traufe)];
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    const me = new THREE.Mesh(geo, glas);
    me.position.set(0, 0, M.L + 0.18);
    me.userData = { art: "glas" };
    teile.dach.add(me);
    const r = mat(ZARGE, "metall", { name: "Rahmen" });
    teile.dach.add(box(M.W + 0.72, 0.12, 0.12, r, M.W / 2, M.L + 0.18, M.ogZ + 0.06));
    for (let i = 0; i <= 6; i++) {
      const x = (M.W * i) / 6;
      const top = dachInnen(M, x);
      teile.dach.add(box(0.07, top - M.ogZ, 0.1, r, x, M.L + 0.18, (M.ogZ + top) / 2));
    }
  }

  // Dach: zwei Dachflächen, innen Sichtholz, außen anthrazit, Überstand Süden 2 m
  {
    const dick = 0.32;
    const ueN = 0.5, ueS = 2.0, ueT = 0.55;
    const y0 = -0.36 - ueN, y1 = M.L + 0.36 + ueS;
    const aussen = mat("#3b3d40", "glatt", { name: "Dach außen" });
    const kante = mat("#2c2d2f", "glatt", { name: "Ortgang" });
    const cos = Math.cos(Math.atan(M.tan));
    for (const seite of [0, 1]) {
      const xa = seite === 0 ? -0.36 - ueT : M.W + 0.36 + ueT;
      const xr = M.firstX;
      const za = M.traufe - M.tan * (seite === 0 ? -xa : xa - M.W);
      const zr = dachInnen(M, xr);
      const off = dick / cos;
      const sh = new THREE.Shape([new THREE.Vector2(xa, za), new THREE.Vector2(xr, zr), new THREE.Vector2(xr, zr + off), new THREE.Vector2(xa, za + off)]);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false });
      geo.translate(0, 0, y0);
      const sin = Math.sin(Math.atan(M.tan));
      const innenN = new THREE.Vector3(seite === 0 ? sin : -sin, -cos, 0);
      const g2 = nachNormaleTeilen(geo, innenN);
      const me = new THREE.Mesh(g2, [holz, aussen, kante]);
      me.castShadow = true;
      me.receiveShadow = true;
      me.userData = { art: "dach" };
      teile.dach.add(me);
      // Sparren sichtbar
      const sp = mat(HOLZ_FICHTE, "holz", { name: "Sparren" });
      const xi = seite === 0 ? 0 : M.W;
      const laenge = Math.abs(xr - xi) / cos;
      for (let y = 0.4; y < M.L; y += 0.8) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(laenge, 0.14, 0.08), sp);
        const mx = (xi + xr) / 2;
        s.position.set(mx, dachInnen(M, mx) - 0.07 / cos, y);
        s.rotation.z = seite === 0 ? Math.atan(M.tan) : -Math.atan(M.tan);
        s.castShadow = true;
        teile.dach.add(s);
      }
    }
    // Pfette
    const pf = box(0.16, 0.24, M.L + 0.36, mat(HOLZ_FICHTE, "holz", { name: "Pfette" }), M.firstX, M.L / 2, M.pfetteUK + 0.12);
    teile.dach.add(pf);
    // PV: 2 Module je Dachseite
    const pv = mat("#1a2230", "glatt", { name: "PV-Modul" });
    for (const seite of [0, 1]) {
      for (const yy of [3.6, 5.4]) {
        const mod = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 1.1), pv);
        const xm = seite === 0 ? 1.9 : M.W - 1.9;
        const zz = dachInnen(M, xm) + 0.32 / cos + 0.06;
        mod.position.set(xm, zz, yy);
        mod.rotation.z = seite === 0 ? Math.atan(M.tan) : -Math.atan(M.tan);
        mod.castShadow = true;
        teile.dach.add(mod);
      }
    }
  }

  // Treppe
  const weg = treppenWeg(m, M);
  treppeBauen(weg, teile.eg);
  gelaenderBauen(m, M, weg, teile, segs);

  // Feste Elemente
  festeElemente(m, M, teile.eg, boxen);

  // Außenanlage: Terrasse 4 m, Hof im Osten, Wiese
  {
    const terr = mat("#9a7b5c", "holz", { name: "Terrasse Holz" });
    teile.aussen.add(box(M.W + 0.72, 0.06, 4.0, terr, M.W / 2, M.L + 0.36 + 2.0, -0.03));
    teile.aussen.add(box(9, 0.04, M.L + 6, mat("#a9a49b", "beton", { name: "Hof Pflaster" }), M.W + 0.36 + 4.5, M.L / 2, -0.04));
    const wiese = new THREE.Mesh(new THREE.CircleGeometry(160, 64), mat("#6f8a4f", "gras", { name: "Wiese" }));
    wiese.rotation.x = -Math.PI / 2;
    wiese.position.set(M.W / 2, -0.08, M.L / 2);
    (wiese.material as THREE.MeshStandardMaterial).map?.repeat.set(80, 80);
    wiese.receiveShadow = true;
    wiese.userData.keinSchatten = true;
    teile.aussen.add(wiese);
    // Odenwald-Hügel am Horizont
    const hm = mat("#4f6644", "glatt", { name: "Hügel" });
    const ring = new THREE.CylinderGeometry(420, 420, 1, 160, 1, true);
    const pos = ring.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        const h = 18 + 14 * Math.sin(a * 3 + 1) + 9 * Math.sin(a * 7 + 2) + 5 * Math.sin(a * 13);
        pos.setY(i, Math.max(6, h));
      } else pos.setY(i, -2);
    }
    ring.computeVertexNormals();
    const hue = new THREE.Mesh(ring, hm);
    (hue.material as THREE.Material).side = THREE.BackSide;
    hue.position.set(M.W / 2, 0, M.L / 2);
    hue.userData.keinSchatten = true;
    teile.aussen.add(hue);
  }

  gruppe.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.art !== "glas" && !o.userData.keinSchatten) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    if (o.userData.art === "glas") o.castShadow = false;
  });
  return { gruppe, teile, waende, wandMeshes, koll: { segs, boxen }, masse: M, treppe: weg, ogPoly };
}

export function wandAusMesh(h: HausErgebnis, mesh: THREE.Object3D): WandInfo | undefined {
  return h.waende.find((w) => w.id === mesh.userData.wand);
}

/** Seite einer Wand aus der Weltnormale des getroffenen Dreiecks. */
export function seiteAusNormale(w: WandInfo, n: THREE.Vector3): "plus" | "minus" | null {
  const d = n.x * w.nx + n.z * w.ny;
  if (d > 0.7) return "plus";
  if (d < -0.7) return "minus";
  return null;
}

export { artAusMaterial };
