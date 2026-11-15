// Außenanlage: Gelände, Terrasse mit Treppe in den Garten, Hof/Parkplatz mit Mauer, Kies, Hecke, Schuppen,
// Bäume, Findlinge, Staketenzaun und das Foto-Panorama der Aussicht nach Süden.
// Gelände und Anlagen sind maßgleich aus dem Website-Modell übernommen (dort Ursprung Hausmitte, z = 0 Gelände
// am Haus). Umrechnung Website → Planer: x + 3,89; y + 5,54; z − 0,25.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mat } from "./material";
import { tex } from "./texturen";

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);
const DX = 3.89, DY = 5.54, DZ = -0.25;

// Website-Maße
const W = 4.25, YN = -5.9, YS = 5.9, YT = YS + 4.0, XW = W + 1.5;

const ss = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Geländehöhe im Website-System (0 = Plateau am Haus) */
function gwz(x: number, y: number): number {
  const de = Math.min(1.2, 0.8 + 0.03 * (y + 1.5));
  const wfac = ss(1.5, 2.3, y);
  const a0 = (XW + 0.32) * (1 - wfac) + (W + 0.95) * wfac;
  const a1 = (XW + 0.5) * (1 - wfac) + (W + 2.3) * wfac;
  const ost = de * ss(a0, a1, x) * ss(-2.6, -1.5, y);
  const dw = Math.max(0, Math.min(1.1, 0.25 + 0.06 * (y + 6)));
  const west = dw * ss(-W - 0.9, -W - 3.2, x);
  // Süden: Böschung hinter der Terrasse, dann Rasen mit ca. 7 % Gefälle (weit draußen flacher)
  const d = y - YT - 2;
  const sued = 1.2 * Math.max(0, Math.min(1, (y - YT) / 2)) + 0.07 * Math.max(0, Math.min(d, 40)) + 0.02 * Math.max(0, d - 40);
  return -Math.max(ost, west, sued);
}

/** Geländeoberkante im Planer-System (Modellkoordinaten x, y → z) */
export function gelaendeZ(px: number, py: number): number {
  return gwz(px - DX, py - DY) - 0.02 + DZ;
}

/** Quader aus Website-Grenzen (x0..x1, y0..y1, z0..z1) */
function wbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, name: string) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0), m);
  me.position.copy(v3((x0 + x1) / 2 + DX, (y0 + y1) / 2 + DY, (z0 + z1) / 2 + DZ));
  me.name = name;
  return me;
}

/** Einfacher, reproduzierbarer Zufall */
function zufall(seed: number) {
  let s = seed * 9301 + 49297;
  return (a = 0, b = 1) => {
    s = (s * 9301 + 49297) % 233280;
    return a + (s / 233280) * (b - a);
  };
}

function gelaende(): THREE.Mesh {
  // Feines Raster nahe am Haus, nach außen gröber (bis 220 m)
  const achse = (mitte: number) => {
    const w: number[] = [];
    for (let d = -26; d <= 26 + 1e-6; d += 0.35) w.push(d);
    let d = 26, s = 0.6;
    const aussen: number[] = [];
    while (d < 220) { d += s; s *= 1.22; aussen.push(Math.min(d, 220)); }
    return [...aussen.map((a) => -a).reverse(), ...w, ...aussen].map((a) => a + mitte);
  };
  const xs = achse(DX), ys = achse(DY);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const y of ys) for (const x of xs) {
    pos.push(x, gelaendeZ(x, y), y);
    uv.push(x / 2.5, -y / 2.5);
  }
  const nx = xs.length;
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ name: "Rasen", color: new THREE.Color("#6f8a4f"), roughness: 1, map: tex.gras() });
  const me = new THREE.Mesh(g, m);
  me.name = "Gelände";
  me.userData.art = "gelaende";
  me.receiveShadow = true;
  me.userData.keinSchatten = true;
  return me;
}

function hecke(m: THREE.Material): THREE.Mesh {
  const x0 = W + 7.2, x1 = W + 8.1, ya = -10.5, yb = 15, h = 1.6;
  const prof = [[0, 0], [0, 0.75], [0.1, 0.95], [0.5, 1], [0.9, 0.95], [1, 0.75], [1, 0]];
  const n = prof.length;
  const pos: number[] = [], idx: number[] = [];
  const ysA: number[] = [];
  for (let y = ya; y <= yb + 1e-6; y += 0.4) ysA.push(y);
  for (const y of ysA) {
    const z0 = gwz((x0 + x1) / 2, y) - 0.2;
    const wob = 0.12 * Math.sin(y * 1.7) + 0.08 * Math.sin(y * 4.1);
    for (const [u, v] of prof) {
      const x = x0 + (x1 - x0) * u + (u > 0 && u < 1 ? 0.06 * Math.sin(y * 3.3) : 0);
      pos.push(x + DX, z0 + v * (h + wob + 0.2) + DZ, y + DY);
    }
  }
  for (let j = 0; j < ysA.length - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
    }
  // Stirnseiten
  for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);
  const L = (ysA.length - 1) * n;
  for (let i = 1; i < n - 1; i++) idx.push(L, L + i, L + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const me = new THREE.Mesh(g, m);
  me.name = "Hecke";
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return me;
}

function findling(x: number, y: number, s: number, seed: number, m: THREE.Material) {
  const r = zufall(seed);
  const g = new THREE.IcosahedronGeometry(s, 2);
  const p = g.getAttribute("position");
  const fx = r(0.85, 1.2), fy = r(0.7, 1.1), fz = r(0.9, 1.4);
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * fx, p.getY(i) * fz, p.getZ(i) * fy);
  g.computeVertexNormals();
  const me = new THREE.Mesh(g, m);
  me.position.copy(v3(x + DX, y + DY, gwz(x, y) + s * 0.35 + DZ));
  me.name = "Findling";
  return me;
}

function laubbaum(x: number, y: number, h: number, rk: number, seed: number, rinde: THREE.Material, laub: THREE.Material) {
  const r = zufall(seed);
  const gr = new THREE.Group();
  gr.name = "Laubbaum";
  const z0 = gwz(x, y) + DZ;
  const px = x + DX, py = y + DY;
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * h / 5, 0.2 * h / 5, h * 0.7, 10), rinde);
  st.position.copy(v3(px, py, z0 + h * 0.35 - 0.1));
  gr.add(st);
  const kronen: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const a = r(0, Math.PI * 2), d = r(0, rk * 0.6);
    const rr = rk * r(0.45, 0.7);
    const g = new THREE.IcosahedronGeometry(rr, 2);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const f = 1 + 0.16 * Math.sin(p.getX(i) * 5.1 + seed) * Math.cos(p.getZ(i) * 4.3 + p.getY(i) * 3.7);
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    g.translate(px + Math.cos(a) * d, z0 + h * r(0.68, 0.9), py + Math.sin(a) * d);
    kronen.push(g);
  }
  const kg = mergeGeometries(kronen);
  kg.computeVertexNormals();
  const krone = new THREE.Mesh(kg, laub);
  krone.name = "Krone";
  gr.add(krone);
  return gr;
}

function nadelbaum(x: number, y: number, h: number, seed: number, rinde: THREE.Material, nadel: THREE.Material) {
  const gr = new THREE.Group();
  gr.name = "Nadelbaum";
  const z0 = gwz(x, y) + DZ;
  const px = x + DX, py = y + DY;
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h * 0.5, 8), rinde);
  st.position.copy(v3(px, py, z0 + h * 0.2));
  gr.add(st);
  const teile: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const zb = z0 + h * (0.12 + 0.17 * k);
    const rr = h * 0.26 * (1 - k / 5.5);
    const g = new THREE.ConeGeometry(rr, h * 0.34, 14, 1, false);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) < 0) p.setY(i, p.getY(i) + 0.12 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7 + seed));
    g.translate(px, zb + h * 0.17, py);
    teile.push(g);
  }
  const kg = mergeGeometries(teile);
  kg.computeVertexNormals();
  const me = new THREE.Mesh(kg, nadel);
  me.name = "Nadelkrone";
  gr.add(me);
  return gr;
}

/** Holztreppe von der Terrasse über die Böschung in den Garten (6 Stufen, mittig) */
function treppe(holz: THREE.Material) {
  const gr = new THREE.Group();
  gr.name = "Gartentreppe";
  for (let k = 0; k < 6; k++) {
    const y0 = YT + k * 0.33, zt = -k * 0.2;
    gr.add(wbox(-0.7, 0.7, y0, y0 + 0.33, zt - 0.05, zt, holz, "Stufe"));
    for (const xx of [-0.7, 0.62]) gr.add(wbox(xx, xx + 0.08, y0, y0 + 0.33, zt - 0.32, zt + 0.02, holz, "Wange"));
  }
  return gr;
}

/** Staketenzaun (Kastanie): Latten, zwei Drahtlagen, Pfosten; folgt dem Gelände.
 *  Feste Elemente typ "zaun_staketen": punkte [[x, y], …] (Modellkoordinaten), hoehe, lattenabstand */
export function staketenzaun(f: any): THREE.Group | null {
  const pts: number[][] = Array.isArray(f.punkte) ? f.punkte.filter((p: any) => Array.isArray(p) && p.length >= 2) : [];
  if (pts.length < 2) return null;
  const h = Number(f.hoehe) || 1.0;
  const lb = 0.035; // Lattenbreite (gespaltene Kastanie ca. 3–4 cm)
  const teilung = (Number(f.lattenabstand) || 0.08) + lb;
  const r = zufall(17);
  const latten: THREE.BufferGeometry[] = [], draht: THREE.BufferGeometry[] = [], pfosten: THREE.BufferGeometry[] = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 0.05) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    const winkel = Math.atan2(uy, ux);
    const n = Math.max(1, Math.round(L / teilung));
    for (let i = 0; i <= n; i++) {
      if (i === n && s < pts.length - 2) continue; // Eckpunkt nur einmal
      const t = (i / n) * L;
      const x = ax + ux * t, y = ay + uy * t, z = gelaendeZ(x, y);
      const lh = h + r(-0.04, 0.04);
      const g = new THREE.BoxGeometry(lb + r(-0.008, 0.01), lh, 0.022);
      // Spitze andeuten: obere Kante leicht schräg
      const p = g.getAttribute("position");
      for (let k = 0; k < p.count; k++) if (p.getY(k) > 0 && p.getX(k) > 0) p.setY(k, p.getY(k) - 0.025);
      g.rotateZ(r(-0.03, 0.03));
      g.rotateY(-winkel);
      g.translate(x, z + lh / 2 - 0.02, y);
      latten.push(g);
    }
    // Pfosten etwa alle 2,5 m
    const np = Math.max(1, Math.round(L / 2.5));
    for (let i = 0; i <= np; i++) {
      if (i === np && s < pts.length - 2) continue;
      const t = (i / np) * L;
      const x = ax + ux * t - uy * 0.04, y = ay + uy * t + ux * 0.04, z = gelaendeZ(x, y);
      const g = new THREE.CylinderGeometry(0.045, 0.05, h + 0.1, 8);
      g.translate(x, z + (h + 0.1) / 2 - 0.05, y);
      pfosten.push(g);
    }
    // Drahtlagen: kurze Abschnitte, damit sie dem Gelände folgen
    const nd = Math.max(1, Math.ceil(L / 1.0));
    for (const hz of [0.18, h - 0.2]) {
      for (let i = 0; i < nd; i++) {
        const t0 = (i / nd) * L, t1 = ((i + 1) / nd) * L;
        const p0 = v3(ax + ux * t0, ay + uy * t0, gelaendeZ(ax + ux * t0, ay + uy * t0) + hz);
        const p1 = v3(ax + ux * t1, ay + uy * t1, gelaendeZ(ax + ux * t1, ay + uy * t1) + hz);
        const len = p0.distanceTo(p1);
        const g = new THREE.CylinderGeometry(0.004, 0.004, len, 4);
        g.rotateZ(Math.PI / 2);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), p1.clone().sub(p0).normalize());
        g.applyQuaternion(q);
        g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
        draht.push(g);
      }
    }
  }
  const gr = new THREE.Group();
  gr.name = "Staketenzaun";
  const holz = mat(f.farbe_hex ?? "#8a6d52", "holz", { name: "Kastanie" });
  if (latten.length) gr.add(Object.assign(new THREE.Mesh(mergeGeometries(latten), holz), { name: "Latten" }));
  if (pfosten.length) gr.add(Object.assign(new THREE.Mesh(mergeGeometries(pfosten), mat("#6f5642", "holz", { name: "Pfosten" })), { name: "Pfosten" }));
  if (draht.length) gr.add(Object.assign(new THREE.Mesh(mergeGeometries(draht), mat("#5b5d5f", "metall", { name: "Draht" })), { name: "Draht" }));
  gr.userData.feste = f.id;
  return gr;
}

/** Foto-Panorama der Aussicht als Teilkugel um den Blickpunkt (Terrasse). Bild liegt im Datenordner des
 *  Planers (nicht im Repo) und kommt über /api/umgebung/panorama.jpg. */
export function panorama(p: any, basis: string): THREE.Mesh | null {
  if (!p || !p.version) return null;
  const bogen = THREE.MathUtils.degToRad(Number(p.bogen_grad) || 95);
  const mitte = THREE.MathUtils.degToRad(Number(p.mitte_grad) || 0);
  const verh = Number(p.verhaeltnis) || 0.67;
  const hz = p.horizont ?? 0.6;
  const r = Number(p.abstand) || 45;
  const auge = Array.isArray(p.auge) ? p.auge : [3.9, 13.6, 1.45];
  const hoehe = bogen * verh; // gleiche Winkelauflösung in beiden Richtungen
  // three: x = −r·cos(φ)·sin(θ), z = r·sin(φ)·sin(θ); Süden (+y im Modell) = +z → φ = π/2
  const g = new THREE.SphereGeometry(r, 96, 48, Math.PI / 2 - bogen / 2 - mitte, bogen, Math.PI / 2 - hz * hoehe, hoehe);
  // Bild links = Osten: u spiegeln
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const t = new THREE.TextureLoader().load(`${basis}/api/umgebung/panorama.jpg?v=${p.version}`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ name: "Panorama", map: t, side: THREE.BackSide, toneMapped: false, fog: false });
  const me = new THREE.Mesh(g, m);
  me.name = "Panorama";
  me.position.copy(v3(auge[0], auge[1], auge[2]));
  me.userData.keinSchatten = true;
  me.userData.art = "panorama";
  me.castShadow = false;
  me.receiveShadow = false;
  return me;
}

/** Komplette Außenanlage in die Gruppe ziel */
export function aussenanlageBauen(m: any, ziel: THREE.Group, basis = "") {
  const kies = mat("#d9d5cc", "beton", { name: "Kies" });
  const pflaster = mat("#8c9096", "beton", { name: "Pflaster" });
  const mauer = mat("#a3a5a6", "beton", { name: "Mauer" });
  const stein = mat("#b8826a", "beton", { name: "Sandstein" });
  const kante = mat("#3a3c3e", "metall", { name: "Kante" });
  const deck = mat("#9a7b5c", "holz", { name: "Terrasse Holz" });
  const treppenholz = mat("#a8845e", "holz", { name: "Treppe Holz" });
  const anthrazit = mat("#2b2d30", "glatt", { name: "Anthrazit" });
  const rinde = mat("#4a4038", "holz", { name: "Rinde" });
  const laub = mat("#4f7a2c", "glatt", { name: "Laub" });
  const nadel = mat("#2f4a30", "glatt", { name: "Nadeln" });
  const thuja = mat("#3a5a35", "glatt", { name: "Thuja" });

  ziel.add(gelaende());
  ziel.add(wbox(-W - 0.6, W + 0.6, YN - 0.95, YN, -0.02, 0.025, kies, "Kies Nord"));
  ziel.add(wbox(-W - 0.6, -W, YN, YS, -0.02, 0.025, kies, "Kies West"));
  ziel.add(wbox(-W - 0.68, -W - 0.6, YN - 0.95, YS, -0.1, 0.05, kante, "Kante West"));
  ziel.add(hecke(thuja));
  ziel.add(wbox(W + 0.05, W + 6.2, -10.5, -1.5, -0.02, 0.03, pflaster, "Hof Pflaster"));
  ziel.add(wbox(W + 0.05, XW, -1.5, 1.5, -0.02, 0.03, pflaster, "Weg"));
  ziel.add(wbox(XW, XW + 0.32, -1.5, 1.5, -1.0, 0.16, mauer, "Mauer"));
  ziel.add(wbox(XW - 0.02, XW + 0.34, -1.5, 1.5, 0.16, 0.22, mauer, "Mauerkopf"));
  ziel.add(wbox(W + 0.05, W + 0.9, 1.5, YT, -0.02, 0.025, kies, "Kies Ost"));
  ziel.add(wbox(W + 0.9, W + 0.96, 1.5, YT, -0.12, 0.06, stein, "Kante Ost"));
  ziel.add(treppe(treppenholz));
  const zs = gwz(W + 6, 14.4);
  ziel.add(wbox(W + 5.4, W + 6.6, 13.8, 15.1, zs - 0.1, zs + 2.0, anthrazit, "Schuppen"));
  ziel.add(wbox(W + 5.3, W + 6.7, 13.7, 15.2, zs + 2.0, zs + 2.08, kante, "Schuppendach"));
  ziel.add(wbox(-W, W, YS, YT, -0.02, 0.14, deck, "Terrasse"));
  ziel.add(wbox(0.55, 1.55, YN - 0.62, YN - 0.18, 0.02, 0.98, anthrazit, "Wärmepumpe"));
  ziel.add(wbox(0.6, 1.5, YN - 0.64, YN - 0.62, 0.1, 0.9, kante, "Wärmepumpe Gitter"));
  [[W - 0.25, YN - 0.6, 0.55], [-W + 0.5, YN - 0.6, 0.3], [-W - 1.2, YS + 1.6, 0.5]].forEach(([x, y, s], i) =>
    ziel.add(findling(x, y, s, i + 1, stein)));
  ziel.add(laubbaum(8.2, 7.0, 4.6, 2.0, 1, rinde, laub));
  ziel.add(laubbaum(-7.6, 8.4, 3.5, 1.6, 2, rinde, laub));
  ziel.add(laubbaum(-7.8, -6.8, 3.4, 1.4, 3, rinde, laub));
  ziel.add(nadelbaum(8.9, -7.6, 6.2, 4, rinde, nadel));
  ziel.add(nadelbaum(-8.2, 1.0, 4.2, 5, rinde, nadel));
  for (const f of m.feste_elemente ?? []) {
    if (f.typ !== "zaun_staketen") continue;
    const z = staketenzaun(f);
    if (z) ziel.add(z);
  }
  const pano = panorama(m.umgebung?.panorama, basis);
  if (pano) ziel.add(pano);
}
