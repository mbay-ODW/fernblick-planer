// Parametrische Möbel. Lokales System: Mitte der Grundfläche im Ursprung, Breite b entlang X, Tiefe t entlang Z,
// Front nach +Z (bei rot 0 = Süden), Rückseite −Z, Höhe nach +Y ab Unterkante.
import * as THREE from "three";
import { mat, artAusMaterial, leuchtMat, lichtFarbe } from "./material";

export function farbeVon(m: any): string {
  return m.farbe_hex || "#a0a0a0";
}

function heller(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return "#" + c.getHexString();
}

type B = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;

function werkzeug(g: THREE.Group): B {
  return (w, h, d, m, x, y, z) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.005), Math.max(h, 0.005), Math.max(d, 0.005)), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    me.receiveShadow = true;
    g.add(me);
    return me;
  };
}

function rund(g: THREE.Group, r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 32, r2?: number) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 ?? r, h, seg), m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  g.add(me);
  return me;
}

function polster(b: B, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  // leicht abgerundeter Eindruck durch zwei überlagerte Quader
  b(w, h * 0.9, d, m, x, y - h * 0.05, z);
  return b(w * 0.97, h, d * 0.97, m, x, y, z);
}

export interface MoebelObjekt {
  gruppe: THREE.Group;
  lichter: THREE.Light[];
  leuchtflaechen: THREE.MeshStandardMaterial[];
}

export function moebelBauen(m: any): MoebelObjekt {
  const g = new THREE.Group();
  const [w, d, h] = (m.masse_bth ?? [0.5, 0.5, 0.5]).map((x: number) => Number(x) || 0.3);
  const typ = String(m.typ ?? "").toLowerCase();
  const farbe = farbeVon(m);
  const art = artAusMaterial(m.material, typ);
  const haupt = mat(farbe, art === "glatt" && /sofa|sessel|bett|polster|teppich/.test(typ) ? "stoff" : art);
  const dunkel = mat("#1f1f1f", "metall", { name: "Metall schwarz" });
  const holz = mat("#b98c55", "holz", { name: "Holz Eiche" });
  const b = werkzeug(g);
  const lichter: THREE.Light[] = [];
  const leuchtflaechen: THREE.MeshStandardMaterial[] = [];
  const beine = (hh: number, inset = 0.06, dm = 0.035, mm: THREE.Material = dunkel) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b(dm, hh, dm, mm, sx * (w / 2 - inset), hh / 2, sz * (d / 2 - inset));
  };
  const stoff = mat(farbe, "stoff");
  const kissen = mat(heller(farbe, 1.06), "stoff");

  switch (typ) {
    case "sofa":
    case "sessel": {
      const arm = Math.min(0.18, w * 0.12), sitz = 0.44, lehne = Math.max(sitz + 0.2, h);
      beine(0.08, 0.08, 0.04);
      polster(b, w, sitz - 0.08, d, stoff, 0, 0.08 + (sitz - 0.08) / 2, 0);
      polster(b, w, lehne - 0.08, 0.2, stoff, 0, 0.08 + (lehne - 0.08) / 2, -d / 2 + 0.1);
      for (const s of [-1, 1]) polster(b, arm, 0.62 - 0.08, d, stoff, s * (w / 2 - arm / 2), 0.08 + 0.27, 0);
      const n = typ === "sessel" ? 1 : Math.max(2, Math.round((w - 2 * arm) / 0.65));
      const kb = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + arm + kb * (i + 0.5);
        polster(b, kb - 0.02, 0.1, d - 0.28, kissen, x, sitz + 0.04, 0.05);
        polster(b, kb - 0.04, 0.4, 0.14, kissen, x, sitz + 0.22, -d / 2 + 0.25);
      }
      break;
    }
    case "ecksofa": {
      // L-Form: Lehne entlang der Rückseite, Recamiere über die ganze Tiefe –
      // von vorn gesehen rechts (+X, Standard) oder links (recamiere: "links" spiegelt in X)
      const sx = recamiereLinks(m) ? -1 : 1;
      const sitzT = Math.min(0.95, d * 0.6), sitz = 0.44, lehne = Math.max(0.75, h * 0.85), arm = 0.16;
      const rb = Math.min(1.0, w * 0.38);
      polster(b, w, sitz, sitzT, stoff, 0, sitz / 2, -d / 2 + sitzT / 2);
      polster(b, rb, sitz, d - sitzT, stoff, sx * (w / 2 - rb / 2), sitz / 2, -d / 2 + sitzT + (d - sitzT) / 2);
      polster(b, w, lehne, 0.2, stoff, 0, lehne / 2, -d / 2 + 0.1);
      polster(b, arm, 0.62, sitzT, stoff, sx * (-w / 2 + arm / 2), 0.31, -d / 2 + sitzT / 2);
      const n = Math.max(2, Math.round((w - rb - arm) / 0.7));
      const kb = (w - rb - arm) / n;
      for (let i = 0; i < n; i++) {
        const x = sx * (-w / 2 + arm + kb * (i + 0.5));
        polster(b, kb - 0.03, 0.1, sitzT - 0.25, kissen, x, sitz + 0.05, -d / 2 + 0.2 + (sitzT - 0.2) / 2);
        polster(b, kb - 0.05, 0.42, 0.14, kissen, x, sitz + 0.23, -d / 2 + 0.27);
      }
      polster(b, rb - 0.04, 0.1, d - 0.3, kissen, sx * (w / 2 - rb / 2), sitz + 0.05, 0.1);
      polster(b, rb - 0.06, 0.42, 0.14, kissen, sx * (w / 2 - rb / 2), sitz + 0.23, -d / 2 + 0.27);
      break;
    }
    case "waschmaschine":
    case "trockner": {
      // Frontlader: weißer Korpus, Bedienblende oben, Bullauge vorn (+Z), Waschmittelschublade
      const weiss = mat(farbe, "glatt", { name: "Gerät Lack" });
      const blende = mat("#e3e5e6", "glatt", { name: "Bedienblende" });
      b(w, h - 0.12, d, weiss, 0, (h - 0.12) / 2, 0);
      b(w, 0.12, d, blende, 0, h - 0.06, 0);
      b(w * 0.3, 0.07, 0.006, weiss, -w / 2 + w * 0.18, h - 0.06, d / 2 + 0.003);
      const knopf = rund(g, 0.028, 0.02, dunkel, w * 0.12, h - 0.06, d / 2 + 0.01, 24);
      knopf.rotation.x = Math.PI / 2;
      b(w * 0.18, 0.035, 0.004, mat("#1b2a33", "glatt", { name: "Display" }), w * 0.34, h - 0.06, d / 2 + 0.003);
      const r = Math.min(w, h) * 0.28, zy = (h - 0.12) * 0.52;
      const ring = rund(g, r, 0.035, mat(typ === "trockner" ? "#9aa0a6" : "#c7cbcf", "metall", { name: "Türring" }), 0, zy, d / 2 + 0.017, 48);
      ring.rotation.x = Math.PI / 2;
      const glas = rund(g, r * 0.78, 0.04, mat("#22303a", "glatt", { name: "Bullauge" }), 0, zy, d / 2 + 0.02, 48);
      glas.rotation.x = Math.PI / 2;
      break;
    }
    case "haengeschrank": {
      // Hängeschrank: tueren (1/2), front "riffel"/"glatt", griff links/rechts/ohne,
      // offen_unten = Höhe offener Fächer unten (Mittelwand bei 2 Türen)
      const ft = 0.016, t = 0.016, ho = Math.max(0, Math.min(h - 0.1, Number(m.offen_unten) || 0));
      const nT = Math.max(1, Math.round(Number(m.tueren) || 1));
      if (ho > 0) {
        const tief = d - ft;
        b(t, h, tief, haupt, -w / 2 + t / 2, h / 2, -ft / 2);
        b(t, h, tief, haupt, w / 2 - t / 2, h / 2, -ft / 2);
        b(w, h, t, haupt, 0, h / 2, -d / 2 + t / 2);
        b(w - 2 * t, t, d, haupt, 0, t / 2, 0);
        b(w - 2 * t, t, d, haupt, 0, ho, 0);
        b(w - 2 * t, h - ho, tief, haupt, 0, ho + (h - ho) / 2, -ft / 2);
        if (nT >= 2) b(t, ho - t, d - t, haupt, 0, t + (ho - t) / 2, t / 2);
      } else {
        b(w, h, d - ft, haupt, 0, h / 2, -ft / 2);
      }
      const hT = h - ho - (ho > 0 ? t / 2 : 0), yT = h - hT / 2;
      if ((m.front ?? "glatt") === "riffel") {
        const n = Math.max(4, Math.round(w / 0.03));
        const r = w / n / 2;
        b(w, hT - 0.002, 0.004, haupt, 0, yT, d / 2 - ft + 0.002);
        for (let i = 0; i < n; i++) rund(g, r, hT - 0.002, haupt, -w / 2 + r + i * 2 * r, yT, d / 2 - ft + r * 0.9, 12);
      } else {
        const fuge = 0.003, bw = (w - (nT - 1) * fuge) / nT;
        for (let i = 0; i < nT; i++) b(bw - 0.002, hT - 0.003, ft, haupt, -w / 2 + bw / 2 + i * (bw + fuge), yT, d / 2 - ft / 2);
      }
      if ((m.griff ?? "links") !== "ohne") {
        const messing = mat(m.griff_farbe ?? "#d4b06a", "glatt", { name: "Knauf Messing" });
        const xs = nT >= 2 ? [-0.03, 0.03] : [(m.griff === "rechts" ? 1 : -1) * (w / 2 - Math.min(0.05, w * 0.15))];
        for (const gx of xs) {
          const k = rund(g, 0.014, 0.022, messing, gx, yT, d / 2 + 0.011, 20);
          k.rotation.x = Math.PI / 2;
        }
      }
      break;
    }
    case "waschmaschinenschrank": {
      // Überbauschrank für Frontlader: Seiten, Deckplatte, zwei Türen, unten und hinten offen
      const t = 0.018;
      b(t, h - t, d - 0.02, haupt, -w / 2 + t / 2, (h - t) / 2, -0.01);
      b(t, h - t, d - 0.02, haupt, w / 2 - t / 2, (h - t) / 2, -0.01);
      b(w + 0.006, t, d, haupt, 0, h - t / 2, 0);
      const nT = Math.max(1, Math.round(Number(m.tueren) || 2)), fuge = 0.003;
      const bw = (w - (nT - 1) * fuge) / nT;
      for (let i = 0; i < nT; i++) b(bw - 0.002, h - t - 0.02, 0.018, haupt, -w / 2 + bw / 2 + i * (bw + fuge), 0.02 + (h - t - 0.02) / 2, d / 2 - 0.009);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(0.03, 0.012, 0.03, dunkel, sx * (w / 2 - 0.03), 0.006, sz * (d / 2 - 0.05));
      break;
    }
    case "waschmaschinen_unterbau": {
      // Unterbau mit Arbeitsplatte: offene Nische (nische_breite) für die Maschine, daneben schmaler Schrank mit Tür
      // und Böden; nische "links"/"rechts" (von vorn), platte_farbe für die Arbeitsplatte
      const t = 0.018, pt = Number(m.platte_staerke) || 0.03;
      const nb = Math.min(w - 0.12, Number(m.nische_breite) || 0.65);
      const s = m.nische === "rechts" ? -1 : 1; // +1: Nische links, Schrank rechts
      const xN0 = -w / 2 * s, kh = h - pt;
      const platte = mat(m.platte_farbe ?? "#c49a64", "holz", { name: "Arbeitsplatte Eiche" });
      b(w, pt, d, platte, 0, h - pt / 2, 0);
      // Außenwand Nischenseite, Mittelwand, Außenwand Schrankseite
      b(t, kh, d - 0.01, haupt, xN0 + s * t / 2, kh / 2, -0.005);
      const xM = xN0 + s * (t + nb + t / 2);
      b(t, kh, d - 0.01, haupt, xM, kh / 2, -0.005);
      b(t, kh, d - 0.01, haupt, -xN0 - s * t / 2, kh / 2, -0.005);
      // Rückwand Nische (zwei Querriegel), Schrankkorpus mit Boden, Rückwand, Böden
      for (const yy of [0.1, kh - 0.42]) b(nb, 0.08, t, haupt, xN0 + s * (t + nb / 2), yy, -d / 2 + t / 2);
      const sb = w - nb - 3 * t, xS = (xM + (-xN0 - s * t)) / 2;
      b(sb, kh, t, haupt, xS, kh / 2, -d / 2 + t / 2);
      for (const yy of [0.04, 0.04 + 0.275 + t, 0.04 + 2 * (0.275 + t)]) b(sb, t, d - 0.04, haupt, xS, yy + t / 2, -0.02);
      b(sb + 2 * t - 0.004, kh - 0.01, t, haupt, xS, kh / 2 + 0.005, d / 2 - t / 2 + 0.002);
      break;
    }
    case "mehrzweckschrank": {
      // Hochschrank mit zwei Türen übereinander und durchgehender Griffmulde (teilung = Höhe der Mulde über Boden)
      const sockel = 0.05, mulde = 0.03;
      const teil = Math.min(h - 0.2, Math.max(0.2, Number(m.teilung) || h * 0.62));
      b(w - 0.02, sockel, d - 0.04, mat("#2a2a2a", "glatt", { name: "Sockel" }), 0, sockel / 2, -0.02);
      b(w, h - sockel, d - 0.02, haupt, 0, sockel + (h - sockel) / 2, -0.01);
      const unten = teil - sockel - 0.002, oben = h - teil - mulde - 0.002;
      b(w - 0.004, unten, 0.019, haupt, 0, sockel + unten / 2, d / 2 - 0.0095);
      b(w - 0.004, oben, 0.019, haupt, 0, teil + mulde + oben / 2, d / 2 - 0.0095);
      // Griffmulde: zurückgesetzte, etwas dunklere Leiste
      b(w - 0.004, mulde, 0.01, mat(farbe, "glatt", { name: "Griffmulde" }), 0, teil + mulde / 2, d / 2 - 0.03);
      break;
    }
    case "apothekerschrank": {
      // schmaler Hochschrank mit einem Vollauszug; Griffleiste oben, Sockel zurückgesetzt
      const sockel = 0.06;
      b(w - 0.02, sockel, d - 0.04, mat("#2a2a2a", "glatt", { name: "Sockel" }), 0, sockel / 2, -0.02);
      b(w, h - sockel, d - 0.02, haupt, 0, sockel + (h - sockel) / 2, -0.01);
      b(w - 0.004, h - sockel - 0.004, 0.019, haupt, 0, sockel + (h - sockel) / 2, d / 2 - 0.0095);
      b(w * 0.6, 0.012, 0.02, dunkel, 0, h - 0.05, d / 2 + 0.01);
      break;
    }
    case "esssofa":
    case "bank": {
      const sitz = 0.46;
      beine(sitz - 0.1, 0.06, 0.035);
      polster(b, w, 0.12, d, stoff, 0, sitz - 0.06, 0);
      if (typ === "esssofa") {
        polster(b, w, h - sitz + 0.02, 0.14, stoff, 0, sitz + (h - sitz) / 2, -d / 2 + 0.07);
        for (const s of [-1, 1]) polster(b, 0.08, 0.2, d, stoff, s * (w / 2 - 0.04), sitz + 0.1, 0);
      }
      break;
    }
    case "schuhbank": {
      b(w, 0.04, d, haupt, 0, h - 0.02, 0);
      b(w - 0.04, 0.02, d - 0.04, haupt, 0, h * 0.4, 0);
      for (const s of [-1, 1]) b(0.03, h - 0.04, d, haupt, s * (w / 2 - 0.015), (h - 0.04) / 2, 0);
      break;
    }
    case "stuhl": {
      const sitz = 0.46;
      beine(sitz - 0.03, 0.05, 0.03);
      polster(b, w - 0.04, 0.06, d - 0.08, haupt, 0, sitz - 0.02, 0.02);
      polster(b, w - 0.06, Math.max(0.2, h - sitz - 0.08), 0.05, haupt, 0, sitz + (h - sitz) / 2 + 0.02, -d / 2 + 0.05);
      break;
    }
    case "sitzsack": {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20), stoff);
      s.scale.set(w, h * 1.1, d);
      s.position.y = h * 0.5;
      s.castShadow = true;
      s.receiveShadow = true;
      g.add(s);
      break;
    }
    case "schreibtisch_container": {
      // Schreibtisch mit Schubladenelement (z. B. LAGKAPTEN/ALEX): Platte mit Kante, Container links/rechts,
      // zwei Rundbeine auf der anderen Seite
      const pt = 0.025, cw = Number(m.container_breite) || 0.36, sx = m.container === "rechts" ? 1 : -1;
      const platteM = mat(farbe, "glatt", { name: "Tischplatte" });
      const kante = mat(m.kante_farbe ?? "#c9a875", "holz", { name: "Kante" });
      b(w, pt, d, platteM, 0, h - pt / 2, 0);
      b(w + 0.002, pt - 0.004, 0.003, kante, 0, h - pt / 2, d / 2 + 0.001);
      b(w + 0.002, pt - 0.004, 0.003, kante, 0, h - pt / 2, -d / 2 - 0.001);
      for (const s7 of [-1, 1]) b(0.003, pt - 0.004, d, kante, s7 * (w / 2 + 0.001), h - pt / 2, 0);
      const cM = mat(m.container_farbe ?? farbe, "glatt", { name: "Container" });
      const ch = h - pt, cx = sx * (w / 2 - cw / 2 - 0.01);
      b(cw, ch - 0.01, d - 0.03, cM, cx, (ch - 0.01) / 2 + 0.005, -0.01);
      const nS = Math.max(1, Math.round(Number(m.schubladen) || 5)), sh = (ch - 0.03) / nS;
      const fugeM = mat("#2b2b2b", "glatt", { name: "Fuge" });
      for (let i8 = 1; i8 < nS; i8++) b(cw - 0.01, 0.004, 0.003, fugeM, cx, 0.02 + i8 * sh, d / 2 - 0.024);
      for (let i8 = 0; i8 < nS; i8++) b(cw * 0.35, 0.01, 0.006, fugeM, cx, 0.02 + (i8 + 1) * sh - 0.025, d / 2 - 0.022);
      const beinM = mat(m.beine_farbe ?? "#1f1f1f", "metall", { name: "Tischbein" });
      for (const sz of [-1, 1]) rund(g, 0.018, ch, beinM, -sx * (w / 2 - 0.06), ch / 2, sz * (d / 2 - 0.06), 14);
      break;
    }
    case "esstisch":
    case "couchtisch":
    case "schreibtisch":
    case "sideboard_tisch": {
      const platte = 0.04;
      b(w, platte, d, haupt, 0, h - platte / 2, 0);
      if (/kufe/i.test(m.material ?? "") || typ === "esstisch") {
        // Kufengestell schwarz
        for (const s of [-1, 1]) {
          const x = s * (w / 2 - 0.12);
          const lang = w < d;
          if (lang) {
            const zz = s * (d / 2 - 0.15);
            b(w - 0.16, 0.03, 0.04, dunkel, 0, 0.015, zz);
            for (const t of [-1, 1]) b(0.04, h - platte, 0.04, dunkel, t * (w / 2 - 0.1), (h - platte) / 2, zz);
            b(w - 0.16, 0.04, 0.04, dunkel, 0, h - platte - 0.02, zz);
          } else {
            b(0.04, 0.03, d - 0.16, dunkel, x, 0.015, 0);
            for (const t of [-1, 1]) b(0.04, h - platte, 0.04, dunkel, x, (h - platte) / 2, t * (d / 2 - 0.1));
            b(0.04, 0.04, d - 0.16, dunkel, x, h - platte - 0.02, 0);
          }
        }
      } else {
        beine(h - platte, 0.05, 0.04, typ === "couchtisch" ? haupt : dunkel);
      }
      if (typ === "couchtisch") b(w - 0.1, 0.02, d - 0.1, haupt, 0, 0.12, 0);
      break;
    }
    case "couchtisch_rund":
    case "esstisch_rund": {
      const r = Math.min(w, d) / 2;
      rund(g, r, 0.04, haupt, 0, h - 0.02, 0, 48);
      if (typ === "couchtisch_rund") {
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI * 2) / 3;
          rund(g, 0.015, h - 0.04, dunkel, Math.cos(a) * r * 0.65, (h - 0.04) / 2, Math.sin(a) * r * 0.65, 8);
        }
      } else {
        rund(g, 0.05, h - 0.04, dunkel, 0, (h - 0.04) / 2, 0, 16);
        rund(g, r * 0.45, 0.03, dunkel, 0, 0.015, 0, 32);
      }
      break;
    }
    case "bett":
    case "bett_einzel": {
      // Kopfteil: bei langen Betten quer (b > t) am −X-Ende, sonst an der Rückseite.
      // Optional: beine (Fußhöhe, Holzfüße sichtbar), rahmen_hoehe (Oberkante Bettkasten), schubladen (je Längsseite),
      // knoepfe (gepolstertes Kopfteil mit Knopfheftung), beine_farbe
      const quer = w > d * 1.3;
      const fuss = Number(m.beine) || 0;
      const rahmenOben = Number(m.rahmen_hoehe) || 0.06 + 0.28;
      const rahmenU = fuss || 0.06, rahmenH = rahmenOben - rahmenU, matr = 0.2;
      const holzM = mat(heller(farbe, 0.85), artAusMaterial(m.material, "polster"));
      b(w, rahmenH, d, holzM, 0, rahmenU + rahmenH / 2, 0);
      if (fuss) {
        const beinM = mat(m.beine_farbe ?? "#c9a06a", "holz", { name: "Bettfuß" });
        const lang = quer ? w : d, breit = quer ? d : w;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = quer ? sx * (lang / 2 - 0.08) : sx * (breit / 2 - 0.08), z = quer ? sz * (breit / 2 - 0.08) : sz * (lang / 2 - 0.08);
          rund(g, 0.022, fuss, beinM, x, fuss / 2, z, 12, 0.016);
        }
      } else b(w - 0.06, 0.06, d - 0.06, dunkel, 0, 0.03, 0);
      // Schubladenfugen an den Längsseiten
      const nS = Math.round(Number(m.schubladen) || 0);
      if (nS > 0) {
        const fuge = mat("#3a3632", "glatt", { name: "Fuge" });
        const lang = quer ? w : d;
        const kopf = 0.12, nutz = lang - kopf - 0.1;
        for (const s2 of [-1, 1]) for (let i2 = 0; i2 <= nS; i2++) {
          const u = -lang / 2 + kopf + (nutz * i2) / nS;
          const yy = rahmenU + rahmenH * 0.45;
          if (quer) b(0.006, rahmenH * 0.8, 0.004, fuge, u, yy, s2 * (d / 2 + 0.002));
          else b(0.004, rahmenH * 0.8, 0.006, fuge, s2 * (w / 2 + 0.002), yy, u);
        }
        const lA = quer ? nutz : 0.004, lB = quer ? 0.004 : nutz;
        for (const s2 of [-1, 1]) {
          const yy = rahmenU + rahmenH * 0.05 + 0.02;
          if (quer) b(lA, 0.004, 0.004, fuge, -lang / 2 + kopf + nutz / 2, yy + rahmenH * 0.8, s2 * (d / 2 + 0.002));
          else b(lA, 0.004, lB, fuge, s2 * (w / 2 + 0.002), yy + rahmenH * 0.8, -lang / 2 + kopf + nutz / 2);
        }
      }
      const mOben = rahmenOben - 0.08 + matr;
      b(w - 0.06, matr, d - 0.06, mat("#f3f1ec", "stoff", { name: "Matratze" }), 0, mOben - matr / 2, 0);
      const decke = mat(heller(farbe, 1.1), "stoff", { name: "Bettdecke" });
      const kopfH = Math.max(h, 0.75);
      const knopfM = mat(heller(farbe, 0.75), "stoff", { name: "Knopf" });
      if (quer) {
        b(0.08, kopfH, d, holzM, -w / 2 + 0.04, kopfH / 2, 0);
        b(w * 0.62, 0.06, d - 0.04, decke, w * 0.17, mOben - 0.02, 0);
        b(0.4, 0.12, d - 0.2, kissen, -w / 2 + 0.3, mOben + 0.05, 0);
      } else {
        const kt = m.knoepfe ? 0.12 : 0.08;
        b(w, kopfH, kt, holzM, 0, kopfH / 2, -d / 2 + kt / 2);
        if (m.knoepfe) {
          // zwei versetzte Knopfreihen im oberen Kopfteil
          for (let r = 0; r < 2; r++) {
            const n = r === 0 ? 5 : 4, yy = kopfH - 0.18 - r * 0.12;
            for (let k = 0; k < n; k++) {
              const x = -w / 2 + (w * (k + (r === 0 ? 0.5 : 1))) / (r === 0 ? n : n + 1);
              const kn = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), knopfM);
              kn.position.set(x, yy, -d / 2 + kt + 0.002);
              g.add(kn);
            }
          }
        }
        b(w - 0.04, 0.06, d * 0.62, decke, 0, mOben - 0.02, d * 0.17);
        const nK = w > 1.2 ? 2 : 1;
        for (let i3 = 0; i3 < nK; i3++) b(w / nK - 0.15, 0.12, 0.4, kissen, -w / 2 + (w / nK) * (i3 + 0.5), mOben + 0.05, -d / 2 + kt + 0.24);
      }
      break;
    }
    case "faecherregal": {
      // Würfelregal (z. B. KALLAX): faecher_x × faecher_y Fächer, kräftiger Außenrahmen, dünnere Zwischenböden
      const nx = Math.max(1, Math.round(Number(m.faecher_x) || 2)), ny = Math.max(1, Math.round(Number(m.faecher_y) || 2));
      const ti = 0.016, to = Math.max(ti, Math.min(0.06, (Math.min(w - (nx - 1) * ti - nx * 0.25, h - (ny - 1) * ti - ny * 0.25)) / 2, 0.042));
      const fw = (w - 2 * to - (nx - 1) * ti) / nx, fh = (h - 2 * to - (ny - 1) * ti) / ny;
      b(to, h, d, haupt, -w / 2 + to / 2, h / 2, 0);
      b(to, h, d, haupt, w / 2 - to / 2, h / 2, 0);
      b(w - 2 * to, to, d, haupt, 0, to / 2, 0);
      b(w - 2 * to, to, d, haupt, 0, h - to / 2, 0);
      for (let i6 = 1; i6 < nx; i6++) b(ti, h - 2 * to, d - 0.004, haupt, -w / 2 + to + i6 * (fw + ti) - ti / 2, h / 2, -0.002);
      for (let j6 = 1; j6 < ny; j6++) b(w - 2 * to, ti, d - 0.004, haupt, 0, to + j6 * (fh + ti) - ti / 2, -0.002);
      if (m.rueckwand) b(w - 2 * to, h - 2 * to, 0.004, haupt, 0, h / 2, -d / 2 + 0.002);
      break;
    }
    case "tagesbett": {
      // Tagesbett (z. B. BRIMNES): Kasten mit Schubladen vorn (+Z), Seitenteile an den Enden, zwei Matratzen,
      // Kissen an der Rückseite; Breite = Länge des Betts (rot 0: Rückseite zur Wand)
      const sock = 0.04, kasten = Number(m.kasten_hoehe) || 0.36, sw = 0.03;
      b(w - 2 * sw, kasten, d - 0.02, haupt, 0, sock + kasten / 2, -0.01);
      b(w - 2 * sw - 0.02, sock, d - 0.06, haupt, 0, sock / 2, -0.03);
      for (const sx of [-1, 1]) b(sw, h, d, haupt, sx * (w / 2 - sw / 2), h / 2, 0);
      const nS = Math.max(1, Math.round(Number(m.schubladen) || 2));
      const fb = (w - 2 * sw - 0.02 - (nS - 1) * 0.006) / nS;
      const griffM = mat(m.griff_farbe ?? heller(farbe, 0.92), "glatt", { name: "Griff" });
      for (let i4 = 0; i4 < nS; i4++) {
        const x = -w / 2 + sw + 0.01 + fb / 2 + i4 * (fb + 0.006);
        b(fb, kasten - 0.04, 0.018, haupt, x, sock + 0.02 + (kasten - 0.04) / 2, d / 2 - 0.009 + 0.004);
        b(0.12, 0.018, 0.025, griffM, x, sock + kasten - 0.07, d / 2 + 0.012);
      }
      const matrM = mat("#f3f1ec", "stoff", { name: "Matratze" });
      const mU = sock + kasten;
      b(w - 2 * sw - 0.01, 0.1, d - 0.08, matrM, 0, mU + 0.05, 0);
      b(w - 2 * sw - 0.01, 0.1, d - 0.08, matrM, 0, mU + 0.15, 0);
      for (let i5 = 0; i5 < 3; i5++) {
        const k = b(0.48, 0.42, 0.14, kissen, -w * 0.25 + i5 * w * 0.25, mU + 0.2 + 0.21, -d / 2 + 0.1);
        k.rotation.x = -0.18;
      }
      break;
    }
    case "nachttisch":
    case "nachttisch_haengend":
    case "kommode":
    case "sideboard":
    case "regal_niedrig":
    case "tv_board_haengend":
    case "tv_board": {
      const fuss = typ.includes("haengend") || m.z ? 0 : 0.08;
      if (fuss) beine(fuss, 0.04, 0.03);
      b(w, h - fuss, d, haupt, 0, fuss + (h - fuss) / 2, 0);
      // Fugen in der Front
      const fuge = mat("#141414", "glatt", { name: "Fuge" });
      const n = Math.max(1, Math.round(w / 0.45));
      for (let i = 1; i < n; i++) b(0.006, h - fuss - 0.02, 0.005, fuge, -w / 2 + (w * i) / n, fuss + (h - fuss) / 2, d / 2 + 0.002);
      if (typ === "regal_niedrig") {
        b(w - 0.04, 0.02, 0.01, fuge, 0, fuss + (h - fuss) / 2, d / 2 + 0.002);
      }
      // TV-Board: Fernseher an der Wand darüber (Zoll aus tv_zoll oder aus dem Namen, 0 = keiner)
      if (typ.startsWith("tv_board")) {
        const zoll = tvZoll(m);
        if (zoll > 0) fernseher(g, zoll, h + (m.tv_abstand ?? 0.15), -d / 2 + 0.03);
      }
      break;
    }
    case "tv": {
      // Wandfernseher: Breite × Höhe aus masse_bth, Unterkante = z
      fernseher(g, 0, 0, 0, w, h);
      break;
    }
    case "kleiderschrank":
    case "schrank": {
      b(w, h - 0.05, d, haupt, 0, 0.05 + (h - 0.05) / 2, 0);
      b(w - 0.04, 0.05, d - 0.04, dunkel, 0, 0.025, 0);
      const n = Math.max(2, Math.round(w / 0.5));
      const fuge = mat("#9b958b", "glatt", { name: "Fuge" });
      for (let i = 1; i < n; i++) b(0.004, h - 0.08, 0.004, fuge, -w / 2 + (w * i) / n, 0.05 + (h - 0.05) / 2, d / 2 + 0.002);
      for (let i = 0; i < n; i++) b(0.012, 0.3, 0.02, dunkel, -w / 2 + (w * (i + 0.5)) / n + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 1.05, d / 2 + 0.012);
      break;
    }
    case "wandregal": {
      b(w, Math.max(h, 0.025), d, haupt, 0, Math.max(h, 0.025) / 2, 0);
      for (const s of [-1, 1]) b(0.02, 0.12, d * 0.8, dunkel, s * (w / 2 - 0.12), -0.06, -d * 0.1);
      // ein paar Dinge darauf
      const deko = [mat("#e8e2d6", "glatt"), mat("#6d7a5a", "glatt"), mat("#b8694a", "glatt")];
      for (let i = 0; i < Math.min(4, Math.floor(w / 0.18)); i++) {
        rund(g, 0.04 + (i % 2) * 0.02, 0.1 + (i % 3) * 0.05, deko[i % 3], -w / 2 + 0.15 + i * (w - 0.3) / Math.max(1, Math.min(3, Math.floor(w / 0.18) - 1)), h + 0.05 + (i % 3) * 0.025, 0, 16);
      }
      break;
    }
    case "garderobe_lamellen": {
      b(w, h, 0.02, haupt, 0, h / 2, -d / 2 + 0.01);
      const n = Math.floor(w / 0.08);
      for (let i = 0; i < n; i++) b(0.04, h, 0.03, haupt, -w / 2 + 0.04 + i * (w - 0.08) / Math.max(1, n - 1), h / 2, -d / 2 + 0.035);
      for (let i = 0; i < 4; i++) rund(g, 0.012, 0.08, dunkel, -w / 2 + 0.15 + i * (w - 0.3) / 3, h * 0.75, -d / 2 + 0.09, 8).rotation.x = Math.PI / 2;
      break;
    }
    case "spiegel":
    case "spiegel_rund":
    case "bild": {
      const rahmen = typ === "bild" ? mat("#2a2a2a", "glatt") : dunkel;
      if (typ === "spiegel_rund") {
        const r = Math.min(w, h) / 2;
        const c = rund(g, r, d, rahmen, 0, h / 2, 0, 48);
        c.rotation.x = Math.PI / 2;
        const s = rund(g, r - 0.015, 0.004, mat("#ffffff", "spiegel"), 0, h / 2, d / 2, 48);
        s.rotation.x = Math.PI / 2;
      } else {
        b(w, h, d, rahmen, 0, h / 2, 0);
        b(w - 0.03, h - 0.03, 0.004, typ === "bild" ? mat(farbe, "glatt", { name: "Bild" }) : mat("#ffffff", "spiegel"), 0, h / 2, d / 2);
      }
      break;
    }
    case "teppich": {
      const me = b(w, Math.max(h, 0.008), d, mat(farbe, "stoff", { name: `Teppich ${farbe}` }), 0, Math.max(h, 0.008) / 2, 0);
      me.castShadow = false;
      break;
    }
    case "pflanze": {
      const topf = mat("#9d9a94", "beton", { name: "Topf Beton" });
      const th = Math.min(0.45, h * 0.3);
      rund(g, Math.min(w, d) * 0.32, th, topf, 0, th / 2, 0, 24, Math.min(w, d) * 0.26);
      rund(g, 0.025, h * 0.5, mat("#6b5844", "holz"), 0, th + h * 0.25, 0, 8);
      const blatt = mat(farbe, "glatt", { name: "Blätter" });
      const zuf = (i: number) => Math.sin(i * 12.9898 + (m.id?.length ?? 1)) * 0.5 + 0.5;
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), blatt);
        const r = Math.min(w, d) * (0.25 + zuf(i) * 0.2);
        s.scale.set(r, r * 0.8, r);
        const a = i * 2.4;
        s.position.set(Math.cos(a) * w * 0.2, th + h * 0.45 + zuf(i + 3) * h * 0.45, Math.sin(a) * d * 0.2);
        s.castShadow = true;
        g.add(s);
      }
      break;
    }
    case "stehleuchte":
    case "tischleuchte": {
      const fuss = typ === "stehleuchte" ? 0.14 : 0.08;
      rund(g, fuss, 0.02, dunkel, 0, 0.01, 0, 24);
      rund(g, 0.012, h - 0.25, dunkel, 0, (h - 0.25) / 2, 0, 8);
      const lm = leuchtMat("#efe6d6", lichtFarbe(m.licht));
      leuchtflaechen.push(lm);
      const schirm = rund(g, Math.min(w, d) / 2 * 0.9, 0.25, lm, 0, h - 0.125, 0, 32, Math.min(w, d) / 2);
      schirm.castShadow = false;
      const pl = new THREE.PointLight(lichtFarbe(m.licht), 0, 8, 2);
      pl.position.set(0, h - 0.15, 0);
      pl.userData = { lumen: m.licht?.lumen ?? (typ === "stehleuchte" ? 800 : 400), kelvin: m.licht?.kelvin ?? 2700 };
      g.add(pl);
      lichter.push(pl);
      break;
    }
    case "wandleuchte_updown":
    case "wandleuchte":
    case "wandleuchte_schwenkarm":
    case "wandspot":
    case "bilderleuchte": {
      const kelvin = m.licht?.kelvin ?? 2700;
      const lumen = m.licht?.lumen ?? 400;
      const hinten = -d / 2;
      const platte = typ === "bilderleuchte" ? 0.05 : 0.09;
      b(platte, platte, 0.012, dunkel, 0, typ === "bilderleuchte" ? h / 2 : Math.min(h / 2, 0.12), hinten + 0.006);
      const spot = (pos: THREE.Vector3, dir: THREE.Vector3, winkel: number, anteil: number) => {
        const sp = new THREE.SpotLight(lichtFarbe({ ...(m.licht ?? {}), kelvin }), 0, 10, (winkel * Math.PI) / 360, 0.6, 2);
        sp.position.copy(pos);
        sp.target.position.copy(pos).addScaledVector(dir.normalize(), 2);
        sp.userData = { lumen, kelvin, anteil };
        g.add(sp, sp.target);
        lichter.push(sp);
      };
      const lm = leuchtMat("#fff3df", lichtFarbe({ ...(m.licht ?? {}), kelvin }));
      leuchtflaechen.push(lm);
      if (typ === "wandleuchte_updown") {
        const r = Math.min(w, d) / 2;
        const k = rund(g, r, h, haupt, 0, h / 2, hinten + r + 0.01, 24);
        k.castShadow = true;
        rund(g, r * 0.8, 0.004, lm, 0, h + 0.002, hinten + r + 0.01, 24);
        rund(g, r * 0.8, 0.004, lm, 0, -0.002, hinten + r + 0.01, 24);
        spot(new THREE.Vector3(0, h + 0.02, hinten + r + 0.01), new THREE.Vector3(0, 1, 0), m.licht?.abstrahlwinkel ?? 30, 0.5);
        spot(new THREE.Vector3(0, -0.02, hinten + r + 0.01), new THREE.Vector3(0, -1, 0), m.licht?.abstrahlwinkel ?? 30, 0.5);
      } else if (typ === "wandleuchte") {
        b(0.015, 0.015, d * 0.45, dunkel, 0, h * 0.45, hinten + d * 0.225);
        const schirm = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.4, w * 0.5, h * 0.7, 32, 1, true), lm);
        (schirm.material as THREE.Material).side = THREE.DoubleSide;
        schirm.position.set(0, h * 0.5, hinten + d * 0.55);
        g.add(schirm);
        const pl = new THREE.PointLight(lichtFarbe({ ...(m.licht ?? {}), kelvin }), 0, 8, 2);
        pl.position.set(0, h * 0.5, hinten + d * 0.55);
        pl.userData = { lumen, kelvin, anteil: 1 };
        g.add(pl);
        lichter.push(pl);
      } else if (typ === "wandleuchte_schwenkarm") {
        const armH = h * 0.85;
        b(0.012, 0.012, d - 0.08, dunkel, 0, armH, hinten + (d - 0.08) / 2);
        const kopf = rund(g, 0.035, 0.12, dunkel, 0, armH - 0.06, d / 2 - 0.06, 24, 0.07);
        kopf.castShadow = true;
        rund(g, 0.06, 0.004, lm, 0, armH - 0.121, d / 2 - 0.06, 24);
        spot(new THREE.Vector3(0, armH - 0.13, d / 2 - 0.06), new THREE.Vector3(0, -1, 0.1), m.licht?.abstrahlwinkel ?? 60, 1);
      } else if (typ === "wandspot") {
        // Kopf geneigt: winkel_grad 0 = nach unten, 90 = waagrecht nach vorn, 180 = nach oben
        const wg = ((m.licht?.winkel_grad ?? 45) * Math.PI) / 180;
        const dir = new THREE.Vector3(0, -Math.cos(wg), Math.sin(wg));
        const mitte = new THREE.Vector3(0, Math.min(h / 2, 0.12), hinten + d * 0.6);
        b(0.015, 0.015, d * 0.5, dunkel, 0, mitte.y, hinten + d * 0.25);
        const kopf = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 20), dunkel);
        kopf.position.copy(mitte);
        kopf.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
        kopf.castShadow = true;
        g.add(kopf);
        spot(mitte.clone().addScaledVector(dir, 0.06), dir, m.licht?.abstrahlwinkel ?? 36, 1);
      } else {
        // Bilderleuchte: Leiste über dem Bild, strahlt schräg nach unten auf die Wand
        b(0.012, 0.012, d, dunkel, 0, h / 2, hinten + d / 2);
        b(w, 0.03, 0.05, dunkel, 0, h / 2, hinten + d);
        b(w * 0.95, 0.004, 0.03, lm, 0, h / 2 - 0.016, hinten + d);
        spot(new THREE.Vector3(0, h / 2 - 0.03, hinten + d), new THREE.Vector3(0, -1, -0.45), m.licht?.abstrahlwinkel ?? 60, 1);
      }
      break;
    }
    case "kleiderstange": {
      for (const s of [-1, 1]) b(0.025, h, 0.025, dunkel, s * (w / 2 - 0.02), h / 2, 0);
      b(w, 0.025, 0.025, dunkel, 0, h - 0.02, 0);
      b(w, 0.02, d, holz, 0, 0.1, 0);
      break;
    }
    default:
      b(w, h, d, haupt, 0, h / 2, 0);
  }
  return { gruppe: g, lichter, leuchtflaechen };
}

/** Zoll eines TV-Boards: Feld tv_zoll, sonst aus dem Namen („+ TV 55"“), sonst 55 wenn „TV“ im Namen steht. */
export function tvZoll(m: any): number {
  if (m.tv_zoll !== undefined && m.tv_zoll !== null) return Number(m.tv_zoll) || 0;
  const n = String(m.name ?? "");
  const t = n.match(/(\d{2,3})\s*(?:"|''|”|zoll)/i);
  if (t) return Number(t[1]);
  return /\btv\b|fernseh/i.test(n) ? 55 : 0;
}

/** Flacher Fernseher 16:9 (schwarzer Rahmen, glänzendes Display); unten = Unterkante, z = Mitte der Tiefe. */
function fernseher(g: THREE.Group, zoll: number, unten: number, z: number, breite?: number, hoehe?: number) {
  const diag = zoll * 0.0254;
  const w = breite ?? diag * 0.8716, h = hoehe ?? diag * 0.4903;
  const rahmen = mat("#111214", "glatt", { name: "TV Rahmen" });
  const display = new THREE.MeshStandardMaterial({ name: "TV Display", color: 0x050607, roughness: 0.12, metalness: 0.3 });
  const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), rahmen);
  k.position.set(0, unten + h / 2, z);
  k.castShadow = true;
  g.add(k);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.012, h - 0.012), display);
  s.position.set(0, unten + h / 2, z + 0.0155);
  g.add(s);
}

/** Grundriss-Rechteck (Ecken in Modellkoordinaten) eines Möbels. */
export function ecken(m: any): [number, number][] {
  const [w, d] = m.masse_bth ?? [0.5, 0.5];
  const a = ((m.rot_grad ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [
    m.pos[0] + x * c - y * s,
    m.pos[1] + x * s + y * c,
  ]);
}

/** Ecksofa: Recamiere von vorn gesehen links? (Feld recamiere, sonst aus dem Namen „Recamiere links“) */
export function recamiereLinks(m: any): boolean {
  if (m.recamiere) return String(m.recamiere).toLowerCase() === "links";
  return /recamiere\s+links|links\s*recamiere/i.test(String(m.name ?? ""));
}

/** Grundflächen für die Kollisionsprüfung (Ecksofa als L aus zwei Rechtecken). */
export function fussflaechen(m: any): [number, number][][] {
  if (m.typ !== "ecksofa") return [ecken(m)];
  const [w, d] = m.masse_bth ?? [2.5, 1.6];
  const sitzT = Math.min(0.95, d * 0.6), rb = Math.min(1.0, w * 0.38);
  const a = ((m.rot_grad ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const rechteck = (x0: number, y0: number, x1: number, y1: number): [number, number][] =>
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [m.pos[0] + x * c - y * s, m.pos[1] + x * s + y * c]);
  const rec = recamiereLinks(m) ? rechteck(-w / 2, -d / 2 + sitzT, -w / 2 + rb, d / 2) : rechteck(w / 2 - rb, -d / 2 + sitzT, w / 2, d / 2);
  return [rechteck(-w / 2, -d / 2, w / 2, -d / 2 + sitzT), rec];
}

/** Möbel, die nicht kollidieren (liegen flach oder hängen über anderem). */
export function istFlach(m: any): boolean {
  return m.typ === "teppich" || (m.masse_bth?.[2] ?? 1) < 0.03;
}
