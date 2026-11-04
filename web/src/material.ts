// Materialien (Standard-PBR, damit GLB-Export und Cycles-Import sauber funktionieren)
import * as THREE from "three";
import { tex, dielenTextur } from "./texturen";

export type Art = "holz" | "stoff" | "putz" | "metall" | "glas" | "beton" | "glatt" | "spiegel" | "parkett" | "fliese" | "gras" | "leder" | "schalung";

export function artAusMaterial(material?: string, typ?: string): Art {
  const m = `${material ?? ""} ${typ ?? ""}`.toLowerCase();
  if (/spiegel/.test(m)) return "spiegel";
  if (/glas/.test(m)) return "glas";
  if (/cord|stoff|polster|wolle|jute|baumwolle|samt|leinen|boucl|teppich|sitzsack/.test(m)) return "stoff";
  if (/leder/.test(m)) return "leder";
  if (/holz|eiche|fichte|nuss|buche/.test(m)) return "holz";
  if (/beton|stein|keramik/.test(m)) return "beton";
  if (/metall|stahl|alu|eisen|messing/.test(m)) return "metall";
  if (/putz/.test(m)) return "putz";
  return "glatt";
}

const cache = new Map<string, THREE.Material>();

export function mat(farbe: string, art: Art = "glatt", extra: { name?: string; emissive?: string; seite?: THREE.Side } = {}): THREE.Material {
  const k = `${farbe}|${art}|${extra.name ?? ""}|${extra.emissive ?? ""}|${extra.seite ?? ""}`;
  const c = cache.get(k);
  if (c) return c;
  let m: THREE.Material;
  const col = new THREE.Color(farbe);
  switch (art) {
    case "glas":
      // Kein Transmission-Pass (teuer); der Render-Worker ersetzt „Glas“ durch echtes Glas
      m = new THREE.MeshStandardMaterial({
        name: "Glas", color: new THREE.Color("#dfe9ee"), metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5,
      });
      break;
    case "spiegel":
      m = new THREE.MeshStandardMaterial({ name: "Spiegel", color: 0xffffff, metalness: 1, roughness: 0.02 });
      break;
    case "holz":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, map: tex.holz() });
      break;
    case "parkett":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, map: tex.parkett() });
      break;
    case "fliese":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, map: tex.fliese() });
      break;
    case "stoff":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, map: tex.stoff() });
      break;
    case "leder":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 });
      break;
    case "putz":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.92, map: tex.putz() });
      break;
    case "beton":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, map: tex.beton() });
      break;
    case "schalung":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, map: tex.schalung() });
      break;
    case "gras":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 1, map: tex.gras() });
      break;
    case "metall":
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.38, metalness: 0.65 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 });
  }
  if (extra.name) m.name = extra.name;
  if (extra.emissive && m instanceof THREE.MeshStandardMaterial) {
    m.emissive = new THREE.Color(extra.emissive);
    m.emissiveIntensity = 1;
  }
  if (extra.seite !== undefined) m.side = extra.seite;
  cache.set(k, m);
  return m;
}

/** Leuchtende Fläche (Lampenschirm, Leuchtmittel); Intensität wird je Szenario gesetzt, daher nicht gecacht. */
export function leuchtMat(farbe: string, kelvin = 2700): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "Leuchte", color: new THREE.Color(farbe), roughness: 0.6, emissive: kelvinFarbe(kelvin), emissiveIntensity: 0,
  });
}

export function kelvinFarbe(k: number): THREE.Color {
  // Näherung nach Tanner Helland
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

/** Teilt eine nicht indizierte Geometrie nach Flächennormalen in Gruppen: 0 = ·dir>0.7, 1 = ·dir<−0.7, 2 = Rest. */
export function nachNormaleTeilen(geo: THREE.BufferGeometry, dir: THREE.Vector3): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const n = g.getAttribute("normal");
  const eimer: number[][] = [[], [], []];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    fn.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const d = fn.dot(dir);
    eimer[d > 0.7 ? 0 : d < -0.7 ? 1 : 2].push(i);
  }
  const out = new THREE.BufferGeometry();
  const P: number[] = [], U: number[] = [], N: number[] = [];
  let start = 0;
  eimer.forEach((liste, gi) => {
    for (const i of liste)
      for (let k = 0; k < 3; k++) {
        P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        N.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
        if (uv) U.push(uv.getX(i + k), uv.getY(i + k));
      }
    out.addGroup(start, liste.length * 3, gi);
    start += liste.length * 3;
  });
  out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  if (uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  return out;
}

/**
 * Bodenbelag (nicht gecacht, eigene Texturtransformation): material Klickvinyl/Parkett/Dielen/Fliese/Beton/Teppich,
 * dielenbreite/-laenge in m, richtung_grad 0 = Dielen in Nord-Süd-Richtung, 90 = Ost-West, 45 = diagonal.
 */
const dielenCache = new Map<string, THREE.Texture>();
export function bodenMaterial(b: any, name: string): THREE.Material {
  const material = String(b.material ?? "Klickvinyl").toLowerCase();
  const farbe = b.farbe_hex ?? "#c8a274";
  const key = `${material}|${farbe}|${b.dielenbreite}|${b.dielenlaenge}|${b.richtung_grad}|${name}`;
  if (cache.has(key)) return cache.get(key)!;
  let m: THREE.MeshStandardMaterial;
  if (/fliese|stein/.test(material)) m = mat(farbe, "fliese").clone() as THREE.MeshStandardMaterial;
  else if (/beton|estrich/.test(material)) m = mat(farbe, "beton").clone() as THREE.MeshStandardMaterial;
  else if (/teppich/.test(material)) m = mat(farbe, "stoff").clone() as THREE.MeshStandardMaterial;
  else {
    const br = Number(b.dielenbreite ?? 0.2), la = Number(b.dielenlaenge ?? 1.2);
    const tk = `${br}|${la}`;
    if (!dielenCache.has(tk)) dielenCache.set(tk, dielenTextur(br, la));
    const t = dielenCache.get(tk)!.clone();
    t.needsUpdate = true;
    t.repeat.set(1 / (4 * br), 1 / (2 * la));
    t.rotation = ((b.richtung_grad ?? 0) * Math.PI) / 180;
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(farbe), roughness: /vinyl/.test(material) ? 0.42 : 0.55, map: t });
  }
  m.name = name;
  cache.set(key, m);
  return m;
}
