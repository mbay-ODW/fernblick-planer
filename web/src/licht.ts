// Sonnenstand, Himmel, Tageslicht und Kunstlicht (Szenarien)
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { kelvinFarbe, leuchtMat, mat } from "./material";
import type { Masse } from "./haus";

const RAD = Math.PI / 180;

/** Sommerzeit Mitteleuropa: letzter Sonntag März 01:00 UTC bis letzter Sonntag Oktober 01:00 UTC */
function utcVersatz(j: number, mo: number, t: number, stundeLokal: number): number {
  const letzterSonntag = (monat: number) => {
    const d = new Date(Date.UTC(j, monat, 31));
    return 31 - d.getUTCDay();
  };
  const ms = letzterSonntag(2), os = letzterSonntag(9);
  const tag = mo * 100 + t;
  const beginn = 2 * 100 + ms, ende = 9 * 100 + os;
  let sommer = tag > beginn && tag < ende;
  if (tag === beginn) sommer = stundeLokal >= 2;
  if (tag === ende) sommer = stundeLokal < 3;
  return sommer ? 2 : 1;
}

export interface Sonnenstand {
  azimut: number; // Grad, von Norden im Uhrzeigersinn
  hoehe: number; // Grad über Horizont
  richtung: THREE.Vector3; // three.js-Koordinaten, zur Sonne zeigend
  modell: [number, number, number]; // Modellkoordinaten (x Ost, y Süd, z oben)
}

export function sonnenstand(lat: number, lon: number, datum: string, zeit: string, nordwinkel = 0): Sonnenstand {
  const [j, mo, t] = datum.split("-").map(Number);
  const [hh, mm] = zeit.split(":").map(Number);
  const lokal = hh + (mm || 0) / 60;
  const utc = lokal - utcVersatz(j, mo - 1, t, lokal);
  const start = Date.UTC(j, 0, 1);
  const doy = Math.floor((Date.UTC(j, mo - 1, t) - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (utc - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dekl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = utc * 60 + eqt + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(dekl) + Math.cos(phi) * Math.cos(dekl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dekl) * Math.cos(phi)) / RAD + 180;
  az = (az + 360) % 360;
  const hoehe = 90 - zen / RAD;
  // Hausachse: Modell-Norden weicht um nordwinkel (Grad, im Uhrzeigersinn) von geografisch Nord ab
  const a = (az - nordwinkel) * RAD, h = hoehe * RAD;
  const mx = Math.sin(a) * Math.cos(h), my = -Math.cos(a) * Math.cos(h), mz = Math.sin(h);
  return { azimut: az, hoehe, richtung: new THREE.Vector3(mx, mz, my).normalize(), modell: [mx, my, mz] };
}

const glatt = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Umrechnung Lichtstrom → three.js-Intensität (künstlerisch skaliert, damit Tag und Nacht in einem Bild funktionieren)
export const LICHT_K = 1 / 160;

export interface LeuchteEintrag {
  id: string;
  name: string;
  lichter: THREE.Light[];
  mats: THREE.MeshStandardMaterial[];
  lumen: number;
  kelvin: number;
  daten: any;
}

export class Beleuchtung {
  sonne: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  himmel: Sky;
  tagFaktor = 1;
  stand!: Sonnenstand;
  private pmrem: THREE.PMREMGenerator;
  private raumEnv: THREE.Texture;

  constructor(private szene: THREE.Scene, private renderer: THREE.WebGLRenderer, private M: Masse) {
    this.himmel = new Sky();
    this.himmel.scale.setScalar(1800);
    this.himmel.name = "Himmel";
    szene.add(this.himmel);
    const u = this.himmel.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;

    this.sonne = new THREE.DirectionalLight(0xffffff, 3);
    this.sonne.name = "Sonne";
    this.sonne.castShadow = true;
    this.sonne.shadow.mapSize.set(4096, 4096);
    const c = this.sonne.shadow.camera;
    c.left = -14; c.right = 14; c.top = 14; c.bottom = -14; c.near = 1; c.far = 90;
    this.sonne.shadow.bias = -0.0004;
    this.sonne.shadow.normalBias = 0.02;
    this.sonne.target.position.set(M.W / 2, 2, M.L / 2 + 1.5);
    szene.add(this.sonne, this.sonne.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6f6a5a, 0.5);
    szene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.raumEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    szene.environment = this.raumEnv;
  }

  tageslicht(e: any) {
    const s = sonnenstand(e.breitengrad ?? 49.654, e.laengengrad ?? 9.077, e.datum ?? "2026-06-21", e.uhrzeit ?? "12:00", e.nordwinkel ?? 0);
    this.stand = s;
    const tag = glatt(-6, 8, s.hoehe);
    this.tagFaktor = tag;
    const u = this.himmel.material.uniforms;
    u.sunPosition.value.copy(s.richtung).multiplyScalar(1000);
    const sicht = glatt(-1, 6, s.hoehe);
    this.sonne.visible = sicht > 0.001;
    this.sonne.intensity = 3.4 * sicht * (0.35 + 0.65 * glatt(0, 35, s.hoehe));
    const warm = new THREE.Color("#ff9d55"), weiss = new THREE.Color("#fff3e2");
    this.sonne.color.copy(warm).lerp(weiss, glatt(2, 30, s.hoehe));
    this.sonne.position.copy(this.sonne.target.position).addScaledVector(s.richtung, 45);
    this.hemi.intensity = 0.06 + 0.75 * tag;
    this.hemi.color.set(tag > 0.3 ? "#cfe0ff" : "#2a3a66");
    this.hemi.groundColor.set(tag > 0.3 ? "#7a7360" : "#121418");
    this.szene.environmentIntensity = 0.04 + 0.5 * tag;
    // Nachthimmel: Sky-Shader wird unter dem Horizont fast schwarz – etwas Restlicht
    this.szene.background = tag < 0.02 ? new THREE.Color("#070b16") : null;
    this.himmel.visible = tag >= 0.02;
    this.renderer.toneMappingExposure = (e.belichtung ?? 1) * (0.55 + 1.6 * (1 - tag));
    this.renderer.shadowMap.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Leuchten aus dem Modell
// ---------------------------------------------------------------------------
export function leuchtenBauen(m: any, M: Masse): { gruppe: THREE.Group; eintraege: LeuchteEintrag[] } {
  const g = new THREE.Group();
  g.name = "Leuchten";
  const eintraege: LeuchteEintrag[] = [];
  const schwarz = mat("#1d1d1d", "metall", { name: "Leuchte schwarz" });
  const gz = (ge: string) => (ge === "OG" ? M.ogZ : 0);
  for (const le of m.leuchten ?? []) {
    const lichter: THREE.Light[] = [];
    const mats: THREE.MeshStandardMaterial[] = [];
    const [x, y] = le.pos ?? [M.W / 2, M.L / 2];
    const z0 = gz(le.geschoss ?? "EG");
    const kelvin = le.kelvin ?? 2700;
    const typ = le.typ ?? "deckenspot";
    if (typ === "pendel_cluster" || typ === "pendel") {
      const n = typ === "pendel" ? 1 : le.anzahl ?? 3;
      const tisch = (m.moebel ?? []).find((t: any) => /tisch/.test(t.typ) && Math.hypot(t.pos[0] - x, t.pos[1] - y) < 0.6);
      const unten = z0 + (le.z ?? (tisch ? (tisch.masse_bth?.[2] ?? 0.75) + (le.unterkante_ueber_tisch ?? 0.7) : 1.5));
      const decke = M.pfetteUK;
      for (let i = 0; i < n; i++) {
        const a = (i * Math.PI * 2) / n + 0.4;
        const r = n > 1 ? 0.22 : 0;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const pz = unten + (n > 1 ? i * 0.14 : 0);
        const lm = leuchtMat("#d9cfbf", kelvin);
        mats.push(lm);
        const schirm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), lm);
        schirm.position.set(px, pz + 0.13, py);
        schirm.rotation.x = 0;
        schirm.material.side = THREE.DoubleSide;
        g.add(schirm);
        const kabel = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, decke - pz - 0.26, 6), schwarz);
        kabel.position.set(px, (decke + pz + 0.26) / 2, py);
        g.add(kabel);
        const pl = new THREE.PointLight(kelvinFarbe(kelvin), 0, 9, 2);
        pl.position.set(px, pz + 0.06, py);
        pl.userData = { anteil: 1 / n };
        g.add(pl);
        lichter.push(pl);
      }
      const bald = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 32), schwarz);
      bald.position.set(x, decke - 0.015, y);
      g.add(bald);
    } else if (typ === "wandleuchte" || typ === "strahler") {
      const z = z0 + (le.z ?? 1.8);
      const lm = leuchtMat("#efe9dc", kelvin);
      mats.push(lm);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 20), lm);
      k.position.set(x, z, y);
      g.add(k);
      const pl = new THREE.PointLight(kelvinFarbe(kelvin), 0, 8, 2);
      pl.position.set(x, z, y);
      g.add(pl);
      lichter.push(pl);
    } else if (typ === "led_streifen") {
      const z = z0 + (le.z ?? 2.4);
      const L = le.laenge ?? 1.5;
      const lm = leuchtMat("#ffffff", kelvin);
      mats.push(lm);
      const st = new THREE.Mesh(new THREE.BoxGeometry(L, 0.012, 0.02), lm);
      st.position.set(x, z, y);
      st.rotation.y = (-(le.rot_grad ?? 0) * Math.PI) / 180;
      g.add(st);
      const nn = Math.max(1, Math.round(L / 0.8));
      for (let i = 0; i < nn; i++) {
        const pl = new THREE.PointLight(kelvinFarbe(kelvin), 0, 5, 2);
        const t = (i + 0.5) / nn - 0.5;
        const a = ((le.rot_grad ?? 0) * Math.PI) / 180;
        pl.position.set(x + Math.cos(a) * t * L, z - 0.05, y + Math.sin(a) * t * L);
        pl.userData = { anteil: 1 / nn };
        g.add(pl);
        lichter.push(pl);
      }
    } else {
      // Deckenspot / Deckenleuchte
      const z = z0 + (le.z ?? 2.6);
      const lm = leuchtMat("#fbf7ef", kelvin);
      mats.push(lm);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), [mat("#f4f2ee", "glatt"), mat("#f4f2ee", "glatt"), lm]);
      k.position.set(x, z + 0.015, y);
      g.add(k);
      const sp = new THREE.SpotLight(kelvinFarbe(kelvin), 0, 12, (62 * Math.PI) / 180, 0.65, 2);
      sp.position.set(x, z - 0.02, y);
      sp.target.position.set(x, z - 3, y);
      sp.shadow.mapSize.set(1024, 1024);
      sp.shadow.bias = -0.0008;
      sp.shadow.camera.near = 0.05;
      sp.userData = { spot: true };
      g.add(sp, sp.target);
      lichter.push(sp);
    }
    eintraege.push({ id: le.id, name: le.name ?? le.id, lichter, mats, lumen: le.lumen ?? 800, kelvin, daten: le });
  }
  return { gruppe: g, eintraege };
}

/** Lichtintensität für einen Dimmwert setzen. */
export function leuchteSetzen(e: LeuchteEintrag, dimm: number, schatten: boolean) {
  for (const l of e.lichter) {
    const anteil = l.userData.anteil ?? 1;
    const lm = e.lumen * anteil * dimm;
    if ((l as THREE.SpotLight).isSpotLight) {
      const sp = l as THREE.SpotLight;
      const omega = 2 * Math.PI * (1 - Math.cos(sp.angle));
      sp.intensity = (lm / omega) * LICHT_K * 4;
      sp.castShadow = schatten && dimm > 0;
    } else {
      l.intensity = (lm / (4 * Math.PI)) * LICHT_K * 4;
      l.castShadow = false;
    }
    l.visible = dimm > 0;
  }
  for (const m of e.mats) m.emissiveIntensity = dimm > 0 ? 1.5 + 2.5 * dimm : 0;
}
