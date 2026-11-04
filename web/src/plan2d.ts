// 2D-Grundriss (SVG, Norden oben): Räume, Wände mit Öffnungen, Einbauten, Möbel zum Ziehen und Drehen, Maßketten
import { masse, wandInfos, WandInfo, P2, treppenWeg, Masse, flaecheLage, leuchtePfad, lamellenMasse } from "./haus";
import type { Bauteil } from "./szene";
import { bauteilFinden, bauteilVerschieben, mitlaeuferKopie } from "./bauteile";
import { ecken, istFlach, recamiereLinks } from "./moebel";
import { wandPoly } from "./pruefung";

function inPoly(x: number, y: number, poly: P2[]) {
  let rein = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) rein = !rein;
  }
  return rein;
}

/** Seite (+1 = Wandnormale, −1 = Gegenseite), zu der eine Drehflügeltür aufschlägt. */
export function tuerSeite(d: any, w: WandInfo, m: any, A: P2, B: P2): number {
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, a = w.dicke / 2 + 0.3;
  const raumAn = (s: number) => (m.raeume ?? []).find((r: any) => (r.geschoss ?? "EG") === (d.geschoss ?? "EG") && inPoly(mx + w.nx * s * a, my + w.ny * s * a, r.polygon ?? []));
  const plus = raumAn(1), minus = raumAn(-1);
  if (d.aufschlag) return plus?.id === d.aufschlag ? 1 : minus?.id === d.aufschlag ? -1 : 1;
  const flur = (r: any) => !r || /diele|flur/.test(r.id);
  if (flur(plus) && !flur(minus)) return -1;
  if (flur(minus) && !flur(plus)) return 1;
  return d.anschlag === "in den Raum" ? -1 : 1;
}

const NS = "http://www.w3.org/2000/svg";

export interface PlanRueckrufe {
  auswahl: (id: string | null) => void;
  live: (id: string, pos: P2, rot: number) => void;
  fertig: (id: string, pos: P2, rot: number) => void;
  wandKlick: (wand: string, seite: "plus" | "minus") => void;
  bodenKlick: (raum: string) => void;
  bauteil: (b: Bauteil) => void;
  bauteilFertig: (b: Bauteil) => void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attr: Record<string, any> = {}, eltern?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attr)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  eltern?.appendChild(e);
  return e;
}

const pts = (p: P2[]) => p.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ");

export class Plan {
  svg: SVGSVGElement;
  private ansicht = { x: -1.5, y: -1.5, w: 11, h: 15 };
  private modell: any;
  private geschoss: "EG" | "OG" = "EG";
  private auswahl: string | null = null;
  private bauteil: Bauteil | null = null;
  private warnIds = new Set<string>();
  private waende: WandInfo[] = [];
  private M!: Masse;
  pinsel = false;
  private ziehen: any = null;
  private zeiger = new Map<number, { x: number; y: number }>();
  private eingepasst = false;

  constructor(private behaelter: HTMLElement, private rueck: PlanRueckrufe) {
    this.svg = el("svg", { class: "plan", xmlns: NS });
    behaelter.appendChild(this.svg);
    this.ereignisse();
    new ResizeObserver(() => this.einpassen(false)).observe(behaelter);
  }

  setzen(m: any, geschoss: "EG" | "OG", auswahl: string | null, warnIds: Set<string>, bauteil: Bauteil | null = null) {
    this.modell = m;
    this.bauteil = bauteil;
    this.geschoss = geschoss;
    this.auswahl = auswahl;
    this.warnIds = warnIds;
    this.M = masse(m);
    this.waende = wandInfos(m, this.M);
    if (!this.eingepasst) this.einpassen(true);
    this.zeichnen();
  }

  einpassen(erzwingen: boolean) {
    const r = this.behaelter.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (!erzwingen && this.eingepasst) {
      // Seitenverhältnis halten
      const s = this.ansicht.w / r.width;
      this.ansicht.h = r.height * s;
    } else {
      const bw = 7.78 + 3.2, bh = 11.1 + 5.2;
      const s = Math.max(bw / r.width, bh / r.height);
      this.ansicht = { w: r.width * s, h: r.height * s, x: 3.89 - (r.width * s) / 2, y: 5.9 - (r.height * s) / 2 };
      this.eingepasst = true;
    }
    this.svg.setAttribute("viewBox", `${this.ansicht.x} ${this.ansicht.y} ${this.ansicht.w} ${this.ansicht.h}`);
  }

  private nachModell(e: { clientX: number; clientY: number }): P2 {
    const r = this.svg.getBoundingClientRect();
    return [this.ansicht.x + ((e.clientX - r.left) / r.width) * this.ansicht.w, this.ansicht.y + ((e.clientY - r.top) / r.height) * this.ansicht.h];
  }

  zeichnen() {
    const m = this.modell;
    if (!m) return;
    const svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = el("defs", {}, svg);
    const pat = el("pattern", { id: "schraffur", width: 0.15, height: 0.15, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 0.15, stroke: "#9aa3ad", "stroke-width": 0.012 }, pat);
    const ge = this.geschoss;
    const M = this.M;

    // Raster 1 m
    const raster = el("g", { class: "raster" }, svg);
    for (let x = -2; x <= 11; x++) el("line", { x1: x, y1: -3, x2: x, y2: 17 }, raster);
    for (let y = -3; y <= 17; y++) el("line", { x1: -2, y1: y, x2: 11, y2: y }, raster);

    // Außenanlage: Terrasse
    if (ge === "EG") {
      el("rect", { x: -0.36, y: M.L + 0.36, width: M.W + 0.72, height: 4, class: "terrasse" }, svg);
      el("text", { x: M.W / 2, y: M.L + 2.5, class: "raumname klein" }, svg).textContent = "Terrasse (ca. 4 m)";
    }

    // Räume
    const raeume = el("g", {}, svg);
    for (const r of m.raeume.filter((r: any) => r.geschoss === ge)) {
      const p = el("polygon", { points: pts(r.polygon), class: "raum", "data-raum": r.id }, raeume);
      const boden = (m.oberflaechen?.flaechen ?? []).find((f: any) => f.art === "boden" && f.raum === r.id);
      if (boden?.farbe_hex) p.setAttribute("style", `fill:${boden.farbe_hex};fill-opacity:.35`);
      const xs = r.polygon.map((q: P2) => q[0]), ys = r.polygon.map((q: P2) => q[1]);
      let cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      if (r.id === "wohnen") { cx = 1.6; cy = 10.3; }
      if (r.id === "galerie") cy = 3.2;
      const t = el("text", { x: cx, y: cy, class: "raumname" }, raeume);
      t.textContent = r.name;
      if (r.flaeche_plan) {
        const t2 = el("text", { x: cx, y: cy + 0.28, class: "raumname klein" }, raeume);
        t2.textContent = `${String(r.flaeche_plan).replace(".", ",")} m²`;
      }
    }
    if (ge === "OG") {
      el("polygon", { points: pts([[0, 6.525], [M.W, 6.525], [M.W, M.L], [0, M.L]]), fill: "url(#schraffur)", class: "luftraum" }, svg);
      el("text", { x: M.W / 2, y: 8.9, class: "raumname" }, svg).textContent = "Luftraum";
      // Kopfhöhe 2,00 m unter der Schräge
      const x2 = (2.0 + M.ogZ - M.traufe) / M.tan;
      for (const x of [x2, M.W - x2]) el("line", { x1: x, y1: 0, x2: x, y2: 6.525, class: "schraege" }, svg);
      el("text", { x: x2 + 0.05, y: 6.35, class: "mass links" }, svg).textContent = "Höhe 2,00 m";
      el("text", { x: M.W - x2 - 0.05, y: 6.35, class: "mass rechts" }, svg).textContent = "Höhe 2,00 m";
    }

    // Einbauten und Treppe
    const ein = el("g", { class: "einbau" }, svg);
    const gw = (f: any) => (this.bauteil?.art === "fest" && this.bauteil.id === f.id ? " gewaehlt" : "");
    for (const f of m.feste_elemente) {
      if ((f.geschoss ?? "EG") !== ge || !f.rechteck) continue;
      const [[x0, y0], [x1, y1]] = f.rechteck;
      el("rect", { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), "data-fest": f.id, class: "fest" + gw(f) }, ein);
      if (f.typ === "backofen_kochfeld") {
        for (const [dx, dy] of [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]])
          el("circle", { cx: x0 + (x1 - x0) * dx, cy: y0 + (y1 - y0) * dy, r: 0.09, class: "kochfeld" }, ein);
      }
      if (f.typ === "spuelenschrank") el("rect", { x: x0 + 0.1, y: y0 + 0.12, width: x1 - x0 - 0.2, height: y1 - y0 - 0.24, rx: 0.05, class: "spuele" }, ein);
    }
    for (const f of m.feste_elemente) {
      if (f.typ === "wc_wandhaengend" && ge === "EG" && f.pos) {
        if (f.vorwand) {
          const [[x0, y0], [x1, y1]] = f.vorwand;
          el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, "data-fest": f.id, class: "fest" + gw(f) }, ein);
        }
        el("ellipse", { cx: f.pos[0] - 0.08, cy: f.pos[1], rx: 0.28, ry: 0.19, "data-fest": f.id, class: "fest" + gw(f) }, ein);
      }
      if (f.glaswand && ge === "EG") {
        const [[x0, y0], [x1, y1]] = f.glaswand;
        el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "glas", "data-fest": f.id }, svg);
      }
      if (f.typ === "klimageraet_innen" && f.pos && ge === "EG") {
        const b = f.masse?.[0] ?? 0.9, t = f.masse?.[1] ?? 0.22;
        el("rect", { x: f.pos[0] + 0.08 - t, y: f.pos[1] - b / 2, width: t, height: b, "data-fest": f.id, class: "fest klima" + gw(f) }, ein);
      }
    }
    if (ge === "EG") {
      const weg = treppenWeg(m, M);
      const tg = el("g", { class: "treppe" }, svg);
      weg.stufen.forEach((s) => el("polygon", { points: pts(s.poly) }, tg));
      el("text", { x: 1.85, y: 5.7, class: "mass" }, svg).textContent = "↑ OG";
    } else {
      const weg = treppenWeg(m, M);
      const tg = el("g", { class: "treppe og" }, svg);
      weg.stufen.slice(-7).forEach((s) => el("polygon", { points: pts(s.poly) }, tg));
    }

    // Wände
    const wg = el("g", { class: "waende" }, svg);
    for (const w of this.waende.filter((w) => w.geschoss === ge)) {
      if (w.typ === "glasbruestung") {
        el("line", { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], class: "glas" }, wg);
        continue;
      }
      if (w.typ === "lamellen") {
        const gew = this.bauteil?.art === "wand" && this.bauteil.id === w.id;
        const g = el("g", { class: "lamellen" + (gew ? " gewaehlt" : ""), "data-lamellen": w.id }, wg);
        const lm = lamellenMasse(w.daten, w.laenge);
        // Klickfläche über die ganze Wand
        el("polygon", { points: pts([[w.a[0] + w.nx * lm.t / 2, w.a[1] + w.ny * lm.t / 2], [w.b[0] + w.nx * lm.t / 2, w.b[1] + w.ny * lm.t / 2],
          [w.b[0] - w.nx * lm.t / 2, w.b[1] - w.ny * lm.t / 2], [w.a[0] - w.nx * lm.t / 2, w.a[1] - w.ny * lm.t / 2]]), class: "lamellen-flaeche", "data-lamellen": w.id }, g);
        for (let i = 0; i < lm.n; i++) {
          const u0 = lm.start + i * (lm.b + lm.a), u1 = u0 + lm.b, h = lm.t / 2;
          const P = (u: number, s: number): P2 => [w.a[0] + w.ux * u + w.nx * s, w.a[1] + w.uy * u + w.ny * s];
          el("polygon", { points: pts([P(u0, h), P(u1, h), P(u1, -h), P(u0, -h)]), "data-lamellen": w.id }, g);
        }
        continue;
      }
      const p = el("polygon", { points: pts(wandPoly(w)), class: `wand ${w.typ}`, "data-wand": w.id }, wg);
      void p;
      for (const o of w.oeffnungen) {
        const h = w.dicke / 2 + 0.005;
        const A: P2 = [w.a[0] + w.ux * o.u0, w.a[1] + w.uy * o.u0], B: P2 = [w.a[0] + w.ux * o.u1, w.a[1] + w.uy * o.u1];
        el("polygon", { points: pts([[A[0] + w.nx * h, A[1] + w.ny * h], [B[0] + w.nx * h, B[1] + w.ny * h], [B[0] - w.nx * h, B[1] - w.ny * h], [A[0] - w.nx * h, A[1] - w.ny * h]]), class: "oeffnung" }, wg);
        if (["fenster", "festverglasung", "hebeschiebetuer", "haustuer"].includes(o.typ)) {
          for (const s of [-0.03, 0.03]) el("line", { x1: A[0] + w.nx * s, y1: A[1] + w.ny * s, x2: B[0] + w.nx * s, y2: B[1] + w.ny * s, class: "fensterlinie" }, wg);
        }
        if (o.typ === "tuer") {
          // Türschwenk: in den Raum aus „aufschlag“ (Raum-ID), sonst in den Raum, der nicht Diele/Flur ist
          const r = o.u1 - o.u0;
          const s = tuerSeite(o.daten, w, m, A, B);
          const nx = w.nx * s * (w.dicke / 2), ny = w.ny * s * (w.dicke / 2);
          const P: P2 = [A[0] + nx, A[1] + ny];
          const E: P2 = [P[0] + w.nx * s * r, P[1] + w.ny * s * r];
          const Q: P2 = [B[0] + nx, B[1] + ny];
          el("line", { x1: P[0], y1: P[1], x2: E[0], y2: E[1], class: "tuerblatt" }, wg);
          el("path", { d: `M ${E[0]} ${E[1]} A ${r} ${r} 0 0 ${s * (w.ux * w.ny - w.uy * w.nx) > 0 ? 0 : 1} ${Q[0]} ${Q[1]}`, class: "tuerschwenk" }, wg);
        }
      }
    }

    // Wand-Teilflächen und Farbflächen als Streifen an der Wandseite
    const fg = el("g", { class: "flaechen" }, svg);
    for (const f of m.oberflaechen?.flaechen ?? []) {
      if (!f.wand) continue;
      const w = this.waende.find((x) => x.id === f.wand && x.geschoss === ge);
      if (!w) continue;
      const lg = flaecheLage(f, w, m);
      const s = lg.seite === "plus" ? 1 : -1;
      const o0 = s * (w.dicke / 2 + 0.005), o1 = s * (w.dicke / 2 + 0.045);
      const P = (u: number, o: number): P2 => [w.a[0] + w.ux * u + w.nx * o, w.a[1] + w.uy * u + w.ny * o];
      const gew = this.bauteil?.art === "flaeche" && this.bauteil.id === f.id ? " gewaehlt" : "";
      el("polygon", { points: pts([P(lg.uA, o0), P(lg.uB, o0), P(lg.uB, o1), P(lg.uA, o1)]), style: `fill:${f.farbe_hex ?? "#bbb"}`,
        class: "flaeche" + (lg.teil ? " teil" : "") + gew, "data-flaeche": f.id }, fg);
    }

    // Geländer
    const gl = el("g", { class: "gelaender" }, svg);
    for (const f of m.feste_elemente) {
      if (!String(f.typ).startsWith("gelaender") || (f.geschoss ?? "EG") !== ge || !Array.isArray(f.punkte)) continue;
      el("polyline", { points: pts(f.punkte), "data-fest": f.id, class: gw(f) }, gl);
      for (const p of f.punkte) el("rect", { x: p[0] - 0.03, y: p[1] - 0.03, width: 0.06, height: 0.06, "data-fest": f.id }, gl);
    }

    // Möbel
    const mg = el("g", { class: "moebel" }, svg);
    const liste = (m.moebel ?? []).filter((x: any) => x.geschoss === ge);
    liste.sort((a: any, b: any) => (istFlach(b) ? 1 : 0) - (istFlach(a) ? 1 : 0));
    for (const x of liste) this.moebelZeichnen(x, mg);

    // Leuchten
    const lg = el("g", { class: "leuchten" }, svg);
    for (const le of m.leuchten ?? []) {
      const pf = !le.pos && !le.punkte ? leuchtePfad(le, this.M, this.waende) : null;
      if (pf) {
        const zeigen = ge === "OG" ? pf.punkte.some((p) => p[2] > this.M.ogZ) : pf.punkte.some((p) => p[2] < this.M.ogZ + 0.5) || le.geschoss === "EG";
        if (!zeigen) continue;
        el("polyline", { points: pts(pf.punkte.map((p) => [p[0], p[1]] as P2)), class: le.typ === "stromschiene" ? "schiene" : "streifen" }, lg);
        if (le.typ === "stromschiene") {
          const n = Math.max(1, le.anzahl ?? 4);
          const a = pf.punkte[0], b = pf.punkte[pf.punkte.length - 1];
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            el("circle", { cx: a[0] + (b[0] - a[0]) * t, cy: a[1] + (b[1] - a[1]) * t, r: 0.05 }, lg);
          }
        }
        continue;
      }
      if ((le.geschoss ?? "EG") !== ge) continue;
      const orte: P2[] = Array.isArray(le.punkte) && le.punkte.length ? le.punkte : le.pos ? [le.pos] : [];
      for (const [px, py] of orte) {
        el("circle", { cx: px, cy: py, r: le.bauform === "aufbau" ? 0.06 : 0.09, class: le.bauform === "aufbau" ? "aufbau" : "" }, lg);
        el("line", { x1: px - 0.12, y1: py, x2: px + 0.12, y2: py }, lg);
        el("line", { x1: px, y1: py - 0.12, x2: px, y2: py + 0.12 }, lg);
      }
    }

    // Maße für Auswahl
    const sel = liste.find((x: any) => x.id === this.auswahl);
    if (sel) this.masseZeichnen(sel, svg);

    // Nordpfeil und Maßstab
    const n = el("g", { class: "nord", transform: `translate(${M.W + 1.0}, -0.6)` }, svg);
    el("path", { d: "M 0 -0.35 L 0.14 0.15 L 0 0.06 L -0.14 0.15 Z" }, n);
    el("text", { x: 0, y: -0.45, class: "mass" }, n).textContent = "N";
    const sb = el("g", { class: "massstab", transform: `translate(0, ${ge === "EG" ? M.L + 4.8 : M.L + 1})` }, svg);
    el("line", { x1: 0, y1: 0, x2: 2, y2: 0 }, sb);
    for (const x of [0, 1, 2]) el("line", { x1: x, y1: -0.06, x2: x, y2: 0.06 }, sb);
    el("text", { x: 1, y: -0.12, class: "mass" }, sb).textContent = "2 m";
  }

  private moebelZeichnen(x: any, g: Element) {
    const [w, d] = x.masse_bth;
    const t = el("g", { transform: `translate(${x.pos[0]} ${x.pos[1]}) rotate(${x.rot_grad ?? 0})`, class: "stueck" + (x.id === this.auswahl ? " gewaehlt" : "") + (this.warnIds.has(x.id) ? " warnung" : "") + (istFlach(x) ? " flach" : "") + (x.z ? " haengend" : ""), "data-id": x.id }, g);
    el("rect", { x: -w / 2, y: -d / 2, width: w, height: d, rx: Math.min(0.04, w / 4), style: `fill:${x.farbe_hex}` }, t);
    if (!istFlach(x)) el("line", { x1: -w / 2, y1: -d / 2, x2: w / 2, y2: -d / 2, class: "ruecken" }, t);
    if (x.typ === "ecksofa") {
      const rb = Math.min(1.0, w * 0.38), sitzT = Math.min(0.95, d * 0.6);
      const sx = recamiereLinks(x) ? -1 : 1;
      el("polyline", { points: pts([[sx * (-w / 2), -d / 2 + sitzT], [sx * (w / 2 - rb), -d / 2 + sitzT], [sx * (w / 2 - rb), d / 2]]), class: "kontur" }, t);
    }
    if (/couchtisch_rund|esstisch_rund/.test(x.typ)) {
      t.removeChild(t.firstChild!);
      el("ellipse", { cx: 0, cy: 0, rx: w / 2, ry: d / 2, style: `fill:${x.farbe_hex}` }, t);
    }
    const gross = Math.min(w, d) > 0.35 && w > 0.6;
    if (gross || x.id === this.auswahl) {
      const lab = el("text", { x: 0, y: 0.05, class: "moebelname", transform: `rotate(${-(x.rot_grad ?? 0)})` }, t);
      lab.textContent = (x.name ?? x.typ).replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 26);
    }
    if (x.id === this.auswahl) {
      el("line", { x1: 0, y1: d / 2, x2: 0, y2: d / 2 + 0.28, class: "griffstiel" }, t);
      el("circle", { cx: 0, cy: d / 2 + 0.32, r: 0.09, class: "drehgriff", "data-drehen": x.id }, t);
    }
  }

  private masseZeichnen(x: any, svg: Element) {
    const c = ecken(x);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const kanten: [P2, P2][] = [];
    for (const w of this.waende.filter((w) => w.geschoss === x.geschoss)) {
      const p = wandPoly(w);
      for (let i = 0; i < 4; i++) kanten.push([p[i], p[(i + 1) % 4]]);
    }
    const strahl = (o: P2, d: P2): number => {
      let best = Infinity;
      for (const [a, b] of kanten) {
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const den = d[0] * ey - d[1] * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den;
        const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
        if (t > -0.001 && u >= 0 && u <= 1) best = Math.min(best, t);
      }
      return best;
    };
    const g = el("g", { class: "masskette" }, svg);
    const ziehe = (o: P2, d: P2) => {
      const t = strahl(o, d);
      if (!isFinite(t) || t > 6 || t < 0.005) return;
      const e: P2 = [o[0] + d[0] * t, o[1] + d[1] * t];
      el("line", { x1: o[0], y1: o[1], x2: e[0], y2: e[1] }, g);
      const lab = el("text", { x: (o[0] + e[0]) / 2 + (d[1] ? 0.06 : 0), y: (o[1] + e[1]) / 2 - (d[0] ? 0.05 : 0), class: d[1] ? "mass links" : "mass" }, g);
      lab.textContent = `${Math.round(t * 100)}`;
    };
    ziehe([box.x1, cy], [1, 0]);
    ziehe([box.x0, cy], [-1, 0]);
    ziehe([cx, box.y1], [0, 1]);
    ziehe([cx, box.y0], [0, -1]);
  }

  // ---------------------------------------------------------------------------
  private ereignisse() {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [mx, my] = this.nachModell(e);
      const f = Math.exp(e.deltaY * 0.0012);
      this.zoomen(mx, my, f);
    }, { passive: false });
    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      this.zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.zeiger.size === 2) {
        this.ziehen = { art: "pinch" };
        return;
      }
      const ziel = e.target as Element;
      const p = this.nachModell(e);
      const dreh = ziel.getAttribute?.("data-drehen");
      if (dreh) {
        const x = this.modell.moebel.find((y: any) => y.id === dreh);
        this.ziehen = { art: "drehen", id: dreh, x };
        return;
      }
      const stueck = ziel.closest?.(".stueck") as Element | null;
      const flId = ziel.getAttribute?.("data-flaeche");
      const festId = ziel.getAttribute?.("data-fest");
      const lamId = ziel.getAttribute?.("data-lamellen");
      if (this.pinsel) {
        const wand = ziel.getAttribute?.("data-wand");
        if (wand) {
          const w = this.waende.find((v) => v.id === wand)!;
          const s = (p[0] - w.a[0]) * w.nx + (p[1] - w.a[1]) * w.ny;
          this.rueck.wandKlick(wand, s >= 0 ? "plus" : "minus");
          return;
        }
        const raum = (ziel.closest?.("[data-raum]") as Element | null)?.getAttribute("data-raum");
        if (raum) this.rueck.bodenKlick(raum);
        return;
      }
      if (!stueck && (flId || festId || lamId)) {
        const b: Bauteil = flId ? { art: "flaeche", id: flId } : lamId ? { art: "wand", id: lamId } : { art: "fest", id: festId! };
        this.rueck.bauteil(b);
        const f = bauteilFinden(this.modell, b);
        if (!f) return;
        const w = flId ? this.waende.find((x) => x.id === f.wand) : undefined;
        const beweglich = !flId || !!(f.x || f.y);
        this.ziehen = beweglich ? { art: "bauteil", b, orig: structuredClone(f), mit: mitlaeuferKopie(this.modell, b), start: p, w, aktiv: false } : null;
        return;
      }
      if (stueck) {
        const id = stueck.getAttribute("data-id")!;
        if (id !== this.auswahl) this.rueck.auswahl(id);
        const x = this.modell.moebel.find((y: any) => y.id === id);
        this.ziehen = { art: "moebel", id, x, start: p, pos0: [...x.pos], aktiv: false };
        return;
      }
      this.ziehen = { art: "pan", start: [e.clientX, e.clientY], ansicht: { ...this.ansicht }, bewegt: false };
    });
    svg.addEventListener("pointermove", (e) => {
      const alt = this.zeiger.get(e.pointerId);
      if (alt) this.zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const z = this.ziehen;
      if (!z) return;
      if (z.art === "pinch" && this.zeiger.size === 2 && alt) {
        const [a, b] = [...this.zeiger.values()];
        const andere = [...this.zeiger.entries()].find(([k]) => k !== e.pointerId)![1];
        const d0 = Math.hypot(alt.x - andere.x, alt.y - andere.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
        const [mx, my] = this.nachModell({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        if (d1 > 0) this.zoomen(mx, my, d0 / d1);
        return;
      }
      if (z.art === "pan") {
        const r = svg.getBoundingClientRect();
        const s = this.ansicht.w / r.width;
        const dx = e.clientX - z.start[0], dy = e.clientY - z.start[1];
        if (Math.hypot(dx, dy) > 3) z.bewegt = true;
        this.ansicht.x = z.ansicht.x - dx * s;
        this.ansicht.y = z.ansicht.y - dy * s;
        svg.setAttribute("viewBox", `${this.ansicht.x} ${this.ansicht.y} ${this.ansicht.w} ${this.ansicht.h}`);
        return;
      }
      const p = this.nachModell(e);
      if (z.art === "bauteil") {
        let dx = p[0] - z.start[0], dy = p[1] - z.start[1];
        if (!z.aktiv && Math.hypot(dx, dy) < 0.03) return;
        z.aktiv = true;
        if (z.w) {
          const d = dx * z.w.ux + dy * z.w.uy;
          dx = z.w.ux * d;
          dy = z.w.uy * d;
        }
        const rr = e.altKey ? 0.01 : 0.05;
        dx = Math.round(dx / rr) * rr;
        dy = Math.round(dy / rr) * rr;
        bauteilVerschieben(this.modell, z.b, dx, dy, z.orig, z.mit);
        this.zeichnen();
        return;
      }
      if (z.art === "moebel") {
        if (!z.aktiv && Math.hypot(p[0] - z.start[0], p[1] - z.start[1]) < 0.03) return;
        z.aktiv = true;
        const r = e.altKey ? 0.01 : 0.05;
        const nx = Math.round((z.pos0[0] + p[0] - z.start[0]) / r) * r, ny = Math.round((z.pos0[1] + p[1] - z.start[1]) / r) * r;
        z.x.pos = [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000];
        this.rueck.live(z.id, z.x.pos, z.x.rot_grad ?? 0);
        this.zeichnen();
      } else if (z.art === "drehen") {
        let a = (Math.atan2(p[1] - z.x.pos[1], p[0] - z.x.pos[0]) * 180) / Math.PI - 90;
        a = ((a % 360) + 360) % 360;
        if (!e.shiftKey) a = Math.round(a / 15) * 15 % 360;
        z.x.rot_grad = Math.round(a);
        z.aktiv = true;
        this.rueck.live(z.id, z.x.pos, z.x.rot_grad);
        this.zeichnen();
      }
    });
    const ende = (e: PointerEvent) => {
      this.zeiger.delete(e.pointerId);
      const z = this.ziehen;
      if (this.zeiger.size > 0 && z?.art === "pinch") return;
      this.ziehen = null;
      if (!z) return;
      if ((z.art === "moebel" || z.art === "drehen") && z.aktiv) this.rueck.fertig(z.id, z.x.pos, z.x.rot_grad ?? 0);
      if (z.art === "bauteil" && z.aktiv) this.rueck.bauteilFertig(z.b);
      if (z.art === "pan" && !z.bewegt) this.rueck.auswahl(null);
    };
    svg.addEventListener("pointerup", ende);
    svg.addEventListener("pointercancel", ende);
  }

  private zoomen(mx: number, my: number, f: number) {
    const a = this.ansicht;
    const nw = Math.max(1.5, Math.min(60, a.w * f));
    const k = nw / a.w;
    a.x = mx - (mx - a.x) * k;
    a.y = my - (my - a.y) * k;
    a.w = nw;
    a.h *= k;
    this.svg.setAttribute("viewBox", `${a.x} ${a.y} ${a.w} ${a.h}`);
  }

  async alsPng(): Promise<Blob> {
    const klon = this.svg.cloneNode(true) as SVGSVGElement;
    const stil = document.createElementNS(NS, "style");
    stil.textContent = [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules].map((r) => r.cssText).filter((t) => t.includes(".plan") || t.startsWith(".")); } catch { return []; }
    }).join("\n");
    klon.insertBefore(stil, klon.firstChild);
    const r = this.svg.getBoundingClientRect();
    const breite = Math.round(r.width * 2), hoehe = Math.round(r.height * 2);
    klon.setAttribute("width", String(breite));
    klon.setAttribute("height", String(hoehe));
    const daten = new XMLSerializer().serializeToString(klon);
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(daten);
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = breite;
    cv.height = hoehe;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, breite, hoehe);
    c.drawImage(img, 0, 0);
    return new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  }
}
