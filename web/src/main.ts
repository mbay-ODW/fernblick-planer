// Fernblick-Planer – Oberfläche: Plan 2D / 3D / Rendering
import "./stil.css";
import { api, KonfliktFehler } from "./api";
import { h, leeren, toast, zahl, zeitText, frage } from "./dom";
import { Szene, Geschossfilter, Bauteil } from "./szene";
import { bauteilFinden, bauteilVerschieben } from "./bauteile";
import { Plan } from "./plan2d";
import { pruefen, Hinweis } from "./pruefung";
import { seitenName, P2, lamellenMasse } from "./haus";
import { sonnenstand, spotWinkel } from "./licht";
import { RenderAnsicht } from "./rendern";
import { tvZoll, recamiereLinks } from "./moebel";
import { SCHMAL } from "./geraet";

type Modus = "2d" | "3d" | "render";
type Art = "moebel" | "haus" | "licht" | "einstellungen";

const PALETTE: [string, string][] = [
  ["Weiß", "#f1efea"], ["Altweiß", "#ece6da"], ["Kalk", "#e8e2d4"], ["Greige", "#cdbfa8"], ["Sand", "#d9c9a8"],
  ["Salbei", "#9eae86"], ["Olivgrün", "#5f6b3c"], ["Terrakotta", "#b8694a"], ["Taubenblau", "#7d8fa0"],
  ["Anthrazit", "#3e4043"], ["Sichtholz Fichte", "#d9b98a"], ["Eiche", "#b98c55"],
];
const MATERIALIEN = ["Rollputz", "Glattputz", "Kalkputz", "Sichtholz", "Aluverbundplatte", "Fliese", "Beton", "Tapete"];
const BODEN_MAT = ["Klickvinyl", "Parkett", "Dielen", "Fliese", "Beton", "Teppich"];
const BODEN_DEKORE: [string, string, string][] = [
  ["Eiche natur", "Klickvinyl", "#c8a274"], ["Eiche hell", "Klickvinyl", "#ddc29a"], ["Eiche gekalkt", "Klickvinyl", "#e2d6c3"],
  ["Eiche grau", "Klickvinyl", "#a99c8a"], ["Eiche geräuchert", "Klickvinyl", "#7d6248"], ["Nussbaum", "Klickvinyl", "#6b4a33"],
  ["Steinoptik hellgrau", "Fliese", "#c9c4bb"], ["Steinoptik anthrazit", "Fliese", "#5d5b58"], ["Beton-Optik", "Beton", "#a8a49c"],
];
const WANDTYPEN = /^(haengeschrank|wandleuchte|wandspot|bilderleuchte|wandregal|spiegel|bild|garderobe_lamellen|tv_board_haengend|tv$)/;
const TYPEN = ["waschmaschinen_unterbau", "mehrzweckschrank", "waschmaschinenschrank", "haengeschrank", "waschmaschine", "trockner", "apothekerschrank", "tv", "wandleuchte_updown", "wandleuchte", "wandleuchte_schwenkarm", "wandspot", "bilderleuchte", "sofa", "ecksofa", "sessel", "esssofa", "bank", "schuhbank", "stuhl", "sitzsack", "esstisch", "esstisch_rund",
  "couchtisch", "couchtisch_rund", "schreibtisch", "bett", "bett_einzel", "nachttisch", "nachttisch_haengend", "kleiderschrank",
  "kleiderstange", "kommode", "sideboard", "regal_niedrig", "tv_board_haengend", "wandregal", "garderobe_lamellen", "spiegel",
  "spiegel_rund", "bild", "teppich", "pflanze", "stehleuchte", "tischleuchte"];

class App {
  modell: any = null;
  basis: number | null = null;
  stand = ""; // JSON des zuletzt übernommenen Stands (für Rückgängig)
  rueckListe: string[] = [];
  vorListe: string[] = [];
  modus: Modus = "3d";
  planGeschoss: "EG" | "OG" = "EG";
  auswahl: string | null = null;
  bauteil: Bauteil | null = null;
  hinweise: Hinweis[] = [];
  tab = "moebel";
  ich = "";
  speichernTimer = 0;
  speichertGerade = false;
  ungespeichert = false;
  notizen: string[] = [];
  szene!: Szene;
  plan!: Plan;
  render!: RenderAnsicht;
  pinsel = { aktiv: false, farbe: "#9eae86", name: "Salbei", material: "Rollputz" };
  katalogFilter = { suche: "", kategorie: "" };
  tauschModus = false;
  zeitAnimation = 0;
  offeneSchienen = new Set<string>();

  async start() {
    const ich = await api.ich().catch(() => ({ benutzer: "?" }));
    this.ich = ich.benutzer ?? ich.wer ?? "";
    document.getElementById("benutzer")!.textContent = this.ich;
    this.szene = new Szene(document.getElementById("ansicht3d")!, {
      auswahl: (id) => this.waehlen(id),
      verschoben: (id, pos) => this.aendern((m) => this.lage(m, id, pos), "moebel", "Möbel verschoben"),
      wandKlick: (w, s) => this.wandMalen(w, s),
      bodenKlick: (r) => this.bodenMalen(r),
      kamera: () => this.render?.kameraGeaendert(),
      bauteil: (b) => this.bauteilWaehlen(b),
      bauteilVerschoben: (b, dx, dy) => this.aendern((m) => bauteilVerschieben(m, b, dx, dy), "haus", `${b.id} verschoben`),
    });
    this.plan = new Plan(document.getElementById("ansicht2d")!, {
      auswahl: (id) => this.waehlen(id),
      live: (id, pos, rot) => {
        const x = this.modell.moebel.find((y: any) => y.id === id);
        if (x) this.szene.moebelLage({ ...x, pos, rot_grad: rot });
      },
      fertig: (id, pos, rot) => this.aendern((m) => this.lage(m, id, pos, rot), "moebel", "Möbel im Plan verschoben"),
      wandKlick: (w, s) => this.wandMalen(w, s),
      bodenKlick: (r) => this.bodenMalen(r),
      bauteil: (b) => this.bauteilWaehlen(b),
      bauteilFertig: (b) => this.aendern(() => {}, "haus", `${b.id} verschoben`),
    });
    this.render = new RenderAnsicht(document.getElementById("ansichtRender")!, this);
    // Schmale Bildschirme (Handy): Seitenleiste zu Beginn geschlossen, Bühne sichtbar
    if (SCHMAL) document.getElementById("app")!.classList.add("ohneSeite");
    this.modell = await api.modell();
    this.basis = this.modell.meta.version;
    this.stand = JSON.stringify(this.modell);
    this.szene.laden(this.modell);
    this.szene.begehen(this.modell.ansichten?.[0]?.kamera);
    this.szene.umschauen();
    this.kopfLeiste();
    this.modusSetzen("3d");
    this.allesNeu();
    this.tasten();
    window.setInterval(() => this.abgleich(), 4000);
    window.addEventListener("beforeunload", (e) => {
      if (this.ungespeichert) e.preventDefault();
    });
    this.status();
  }

  // ---------------------------------------------------------------------------
  // Änderungen, Rückgängig, Speichern, Abgleich mit MCP-Änderungen
  // ---------------------------------------------------------------------------
  aendern(fn: (m: any) => void, art: Art, notiz: string, rueckgaengig = true) {
    if (rueckgaengig) {
      this.rueckListe.push(this.stand);
      if (this.rueckListe.length > 120) this.rueckListe.shift();
      this.vorListe = [];
    }
    fn(this.modell);
    this.stand = JSON.stringify(this.modell);
    this.notizen.push(notiz);
    this.neuZeichnen(art);
    this.speichernPlanen();
  }

  neuZeichnen(art: Art) {
    if (art === "haus") {
      this.szene.laden(this.modell);
      if (this.bauteil) this.szene.markierenBauteil(this.bauteil);
    }
    else if (art === "moebel") this.szene.moebelNeu(this.modell);
    else if (art === "licht") this.szene.leuchtenNeu(this.modell);
    if (art !== "haus") this.szene.einstellungen(this.modell.einstellungen ?? {});
    this.hinweise = pruefen(this.modell);
    this.planNeu();
    this.seiteNeu();
    this.eigenschaftenNeu();
  }

  allesNeu() {
    this.hinweise = pruefen(this.modell);
    this.planNeu();
    this.seiteNeu();
    this.eigenschaftenNeu();
  }

  planNeu() {
    if (this.modus === "2d") this.plan.setzen(this.modell, this.planGeschoss, this.auswahl, new Set(this.hinweise.flatMap((x) => x.ids)), this.bauteil);
  }

  rueckgaengig() {
    const s = this.rueckListe.pop();
    if (!s) return toast("Nichts mehr rückgängig zu machen");
    this.vorListe.push(this.stand);
    this.zustandSetzen(s, "Rückgängig");
  }

  wiederholen() {
    const s = this.vorListe.pop();
    if (!s) return;
    this.rueckListe.push(this.stand);
    this.zustandSetzen(s, "Wiederholt");
  }

  private zustandSetzen(json: string, notiz: string) {
    const v = this.modell.meta.version;
    this.modell = JSON.parse(json);
    this.modell.meta.version = v;
    this.stand = JSON.stringify(this.modell);
    if (this.auswahl && !this.modell.moebel.some((x: any) => x.id === this.auswahl)) this.auswahl = null;
    if (!bauteilFinden(this.modell, this.bauteil)) this.bauteil = null;
    this.szene.laden(this.modell);
    this.szene.markieren(this.auswahl);
    if (this.bauteil) this.szene.markierenBauteil(this.bauteil);
    this.notizen.push(notiz);
    this.allesNeu();
    this.speichernPlanen();
  }

  speichernPlanen() {
    this.ungespeichert = true;
    this.status();
    window.clearTimeout(this.speichernTimer);
    this.speichernTimer = window.setTimeout(() => this.speichern(), 1100);
  }

  async speichern(erzwingen = false) {
    if (this.speichertGerade) {
      this.speichernPlanen();
      return;
    }
    this.speichertGerade = true;
    const notiz = [...new Set(this.notizen)].slice(-4).join(", ").slice(0, 190) || "Planer";
    const json = this.stand;
    try {
      const r = await api.speichern(JSON.parse(json), erzwingen ? null : this.basis, notiz);
      this.basis = r.version;
      this.modell.meta.version = r.version;
      this.notizen = [];
      if (this.stand === json) this.ungespeichert = false;
      document.getElementById("banner")!.hidden = true;
    } catch (e) {
      if (e instanceof KonfliktFehler) this.konflikt(e.aktuell);
      else toast(`Speichern fehlgeschlagen: ${(e as Error).message}`, "fehler");
    } finally {
      this.speichertGerade = false;
      this.status();
    }
  }

  private konflikt(aktuell: number) {
    const b = document.getElementById("banner")!;
    leeren(b);
    b.append(
      h("span", {}, `Das Modell wurde inzwischen geändert (Version ${aktuell}, z. B. über den MCP). Deine letzten Änderungen sind noch nicht gespeichert.`),
      h("button", { onclick: () => this.neuLaden(true) }, "Neu laden (meine Änderungen verwerfen)"),
      h("button", { class: "warn", onclick: () => this.speichern(true) }, "Meinen Stand trotzdem speichern"),
    );
    b.hidden = false;
  }

  async neuLaden(hinweis = false) {
    const kam = this.szene.kameraDaten();
    const m = await api.modell();
    this.modell = m;
    this.basis = m.meta.version;
    this.stand = JSON.stringify(m);
    this.ungespeichert = false;
    this.notizen = [];
    window.clearTimeout(this.speichernTimer);
    if (this.auswahl && !m.moebel.some((x: any) => x.id === this.auswahl)) this.auswahl = null;
    this.szene.laden(m);
    this.szene.markieren(this.auswahl);
    if (!kam.begehen) this.szene.ansicht(kam, false);
    document.getElementById("banner")!.hidden = true;
    this.allesNeu();
    this.status();
    if (hinweis) toast(`Stand ${m.meta.version} geladen (${m.meta.geaendert_von ?? ""}${m.meta.notiz ? ": " + m.meta.notiz : ""})`, "info");
  }

  private async abgleich() {
    if (document.hidden) return;
    try {
      const v = await api.version();
      if (this.basis !== null && v.version > this.basis && !this.speichertGerade) {
        if (!this.ungespeichert) await this.neuLaden(true);
        else this.konflikt(v.version);
      }
    } catch {
      /* offline – nächster Versuch */
    }
  }

  status() {
    const s = document.getElementById("status")!;
    s.textContent = this.speichertGerade ? "speichert …" : this.ungespeichert ? "ungespeichert" : `gespeichert · v${this.basis}`;
    s.className = this.ungespeichert ? "offen" : "";
  }

  // ---------------------------------------------------------------------------
  // Möbel-Operationen
  // ---------------------------------------------------------------------------
  raumAn(m: any, pos: P2, geschoss: string): string | undefined {
    const innen = (poly: P2[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > pos[1] !== yj > pos[1] && pos[0] < ((xj - xi) * (pos[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    return m.raeume.find((r: any) => r.geschoss === geschoss && innen(r.polygon))?.id;
  }

  lage(m: any, id: string, pos: P2, rot?: number) {
    const x = m.moebel.find((y: any) => y.id === id);
    if (!x) return;
    x.pos = pos;
    if (rot !== undefined) x.rot_grad = rot;
    x.raum = this.raumAn(m, pos, x.geschoss) ?? x.raum;
  }

  bauteilWaehlen(b: Bauteil | null) {
    this.auswahl = null;
    this.bauteil = b;
    this.szene.markieren(null);
    this.szene.markierenBauteil(b);
    this.planNeu();
    this.eigenschaftenNeu();
    if (this.tab === "moebel") this.seiteNeu();
  }

  waehlen(id: string | null) {
    this.auswahl = id;
    this.bauteil = null;
    this.szene.markieren(id);
    if (id) {
      const x = this.modell.moebel.find((y: any) => y.id === id);
      if (x && this.modus === "2d" && x.geschoss !== this.planGeschoss) this.planGeschoss = x.geschoss;
    }
    this.planNeu();
    this.eigenschaftenNeu();
    if (this.tab === "moebel") this.seiteNeu();
    this.kopfLeiste();
  }

  gewaehlt(): any {
    return this.auswahl ? this.modell.moebel.find((y: any) => y.id === this.auswahl) : null;
  }

  drehen(grad: number) {
    const x = this.gewaehlt();
    if (!x) return;
    this.aendern((m) => {
      const y = m.moebel.find((z: any) => z.id === x.id);
      y.rot_grad = (((y.rot_grad ?? 0) + grad) % 360 + 360) % 360;
    }, "moebel", "Möbel gedreht");
  }

  schieben(dx: number, dy: number) {
    const x = this.gewaehlt();
    if (!x) return;
    this.aendern((m) => this.lage(m, x.id, [Math.round((x.pos[0] + dx) * 1000) / 1000, Math.round((x.pos[1] + dy) * 1000) / 1000]), "moebel", "Möbel verschoben");
  }

  loeschen() {
    const x = this.gewaehlt();
    if (!x) return;
    this.aendern((m) => (m.moebel = m.moebel.filter((y: any) => y.id !== x.id)), "moebel", `${x.name ?? x.id} entfernt`);
    this.waehlen(null);
    toast(`${x.name ?? x.id} entfernt – Strg+Z holt es zurück`);
  }

  duplizieren() {
    const x = this.gewaehlt();
    if (!x) return;
    const neu = { ...structuredClone(x), id: `m-${Math.random().toString(16).slice(2, 8)}`, pos: [x.pos[0] + 0.3, x.pos[1] + 0.3] };
    this.aendern((m) => m.moebel.push(neu), "moebel", `${x.name ?? x.id} dupliziert`);
    this.waehlen(neu.id);
  }

  einfuegePunkt(): { pos: P2; geschoss: string } {
    if (this.modus === "2d") {
      const vb = this.plan.svg.viewBox.baseVal;
      return { pos: [Math.round((vb.x + vb.width / 2) * 20) / 20, Math.round((vb.y + vb.height / 2) * 20) / 20], geschoss: this.planGeschoss };
    }
    const k = this.szene.kameraDaten();
    if (k.begehen) {
      const dx = k.ziel[0] - k.pos[0], dz = k.ziel[2] - k.pos[2];
      const l = Math.hypot(dx, dz) || 1;
      const f = this.szene.fuss;
      return { pos: [Math.round((f.x + (dx / l) * 1.5) * 20) / 20, Math.round((f.y + (dz / l) * 1.5) * 20) / 20], geschoss: f.z > 1.5 ? "OG" : "EG" };
    }
    const t = this.szene.orbit.target;
    return { pos: [Math.round(t.x * 20) / 20, Math.round(t.z * 20) / 20], geschoss: this.szene.geschoss === "OG" ? "OG" : t.y > 2.6 ? "OG" : "EG" };
  }

  ausVorlage(v: any) {
    const { pos, geschoss } = this.einfuegePunkt();
    const neu: any = {
      id: `m-${Math.random().toString(16).slice(2, 8)}`, vorlage_id: v.vorlage_id, typ: v.typ, name: v.name, masse_bth: [...v.masse_bth],
      farbe: v.farbe, farbe_hex: v.farbe_hex, material: v.material, pos, rot_grad: 0, geschoss, raum: this.raumAn(this.modell, pos, geschoss) ?? "",
      verschiebbar: true, quelle: `Planer (${this.ich})`,
    };
    for (const k of ["z", "licht", "preis_eur", "link", "recamiere", "tv_zoll", "front", "griff", "tueren", "offen_unten", "teilung", "nische_breite", "nische", "platte_farbe"]) if (v[k] !== undefined) neu[k] = structuredClone(v[k]);
    if (WANDTYPEN.test(v.typ)) this.anWand(neu);
    this.aendern((m) => m.moebel.push(neu), "moebel", `${v.name} hinzugefügt`);
    this.waehlen(neu.id);
  }

  /** Wandmontiertes Teil an die nächste Wandseite setzen, Rückseite zur Wand */
  anWand(x: any) {
    const waende = (this.szene.haus?.waende ?? []).filter((w) => w.geschoss === x.geschoss && !["glasbruestung", "lamellen"].includes(w.typ));
    const [px, py] = x.pos;
    let best: { d: number; fx: number; fy: number; nx: number; ny: number } | null = null;
    for (const w of waende) {
      const u = Math.max(0, Math.min(w.laenge, (px - w.a[0]) * w.ux + (py - w.a[1]) * w.uy));
      for (const s of [1, -1]) {
        const fx = w.a[0] + w.ux * u + w.nx * s * (w.dicke / 2), fy = w.a[1] + w.uy * u + w.ny * s * (w.dicke / 2);
        // nur die Seite, auf der der Einfügepunkt liegt
        if (((px - fx) * w.nx + (py - fy) * w.ny) * s < -0.01) continue;
        const d = Math.hypot(px - fx, py - fy);
        if (!best || d < best.d) best = { d, fx, fy, nx: w.nx * s, ny: w.ny * s };
      }
    }
    if (!best || best.d > 3) return;
    const t = x.masse_bth[1];
    x.pos = [Math.round((best.fx + best.nx * (t / 2 + 0.002)) * 1000) / 1000, Math.round((best.fy + best.ny * (t / 2 + 0.002)) * 1000) / 1000];
    // Rückseite zeigt zur Wand (−Normale): 0 = Rückseite Nord, 90 = Ost, 180 = Süd, 270 = West
    const bx = -best.nx, by = -best.ny;
    x.rot_grad = Math.abs(bx) > Math.abs(by) ? (bx > 0 ? 90 : 270) : by > 0 ? 180 : 0;
    x.raum = this.raumAn(this.modell, x.pos, x.geschoss) ?? x.raum;
  }

  tauschen(v: any) {
    const x = this.gewaehlt();
    if (!x) return;
    this.aendern((m) => {
      const y = m.moebel.find((z: any) => z.id === x.id);
      for (const k of ["z", "licht", "preis_eur", "link", "recamiere", "tv_zoll", "front", "griff", "tueren", "offen_unten", "teilung", "nische_breite", "nische", "platte_farbe"]) delete y[k];
      Object.assign(y, { vorlage_id: v.vorlage_id, typ: v.typ, name: v.name, masse_bth: [...v.masse_bth], farbe: v.farbe, farbe_hex: v.farbe_hex, material: v.material });
      for (const k of ["z", "licht", "preis_eur", "link", "recamiere", "tv_zoll", "front", "griff", "tueren", "offen_unten", "teilung", "nische_breite", "nische", "platte_farbe"]) if (v[k] !== undefined) y[k] = structuredClone(v[k]);
    }, "moebel", `${x.name} → ${v.name}`);
    this.tauschModus = false;
  }

  // ---------------------------------------------------------------------------
  // Oberflächen
  // ---------------------------------------------------------------------------
  wandMalen(wandId: string, seite: "plus" | "minus") {
    if (!this.pinsel.aktiv) return;
    const w = this.szene.haus.waende.find((x) => x.id === wandId);
    if (!w) return;
    const sname = seitenName(w, seite);
    const id = `wand-${wandId}-${sname}`.toLowerCase().replace(/[^a-z0-9äöüß-]+/g, "-");
    this.aendern((m) => {
      const fl = (m.oberflaechen.flaechen ??= []);
      const alt = fl.findIndex((f: any) => f.wand === wandId && (f.seite ?? "").toLowerCase().startsWith(sname.toLowerCase()) && !f.x && !f.y && !f.z);
      const neu = { id: alt >= 0 ? fl[alt].id : id, geschoss: w.geschoss, wand: wandId, seite: sname, material: this.pinsel.material, farbe: this.pinsel.name, farbe_hex: this.pinsel.farbe, quelle: `Planer (${this.ich})` };
      if (alt >= 0) fl[alt] = { ...fl[alt], ...neu };
      else fl.push(neu);
    }, "haus", `Wand ${wandId} (${sname}) ${this.pinsel.name}`);
    toast(`${wandId}, Seite ${sname}: ${this.pinsel.name} / ${this.pinsel.material}`);
  }

  bodenMalen(raum: string) {
    if (!this.pinsel.aktiv) return;
    const mat = BODEN_MAT.includes(this.pinsel.material) ? this.pinsel.material : "Parkett";
    this.aendern((m) => {
      const fl = (m.oberflaechen.flaechen ??= []);
      const i = fl.findIndex((f: any) => f.art === "boden" && f.raum === raum);
      const neu = { id: `boden-${raum}`, art: "boden", raum, material: mat, farbe: this.pinsel.name, farbe_hex: this.pinsel.farbe, quelle: `Planer (${this.ich})` };
      if (i >= 0) fl[i] = neu;
      else fl.push(neu);
    }, "haus", `Boden ${raum} ${this.pinsel.name}`);
    toast(`Boden ${raum}: ${this.pinsel.name} / ${mat}`);
  }

  // ---------------------------------------------------------------------------
  // Kopfleiste und Modi
  // ---------------------------------------------------------------------------
  kopfLeiste() {
    for (const b of document.querySelectorAll<HTMLButtonElement>("#modi button")) b.classList.toggle("an", b.dataset.modus === this.modus);
    const g = this.modus === "2d" ? this.planGeschoss : this.szene.geschoss;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#geschosse button")) {
      b.classList.toggle("an", b.dataset.g === g);
      b.hidden = this.modus === "2d" && b.dataset.g === "alle";
    }
    document.getElementById("geschosse")!.hidden = this.modus === "render" || (this.modus === "3d" && this.szene.modus === "begehen");
    document.getElementById("kameramodus")!.hidden = this.modus === "2d";
    for (const b of document.querySelectorAll<HTMLButtonElement>("#kameramodus button")) b.classList.toggle("an", b.dataset.k === this.szene.modus);
    document.getElementById("dachSchalter")!.hidden = this.modus === "2d" || this.szene.modus === "begehen";
    this.hilfe();
  }

  modusSetzen(m: Modus) {
    this.modus = m;
    const b = document.getElementById("buehne")!;
    b.dataset.modus = m;
    this.szene.aktiv = m !== "2d";
    if (m === "2d") this.plan.setzen(this.modell, this.planGeschoss, this.auswahl, new Set(this.hinweise.flatMap((x) => x.ids)));
    if (m === "render") this.render.zeigen();
    else this.render.verstecken();
    this.kopfLeiste();
  }

  hilfe() {
    const t = document.getElementById("hilfe")!;
    if (this.pinsel.aktiv) t.textContent = "Pinsel aktiv: Wandseite oder Boden anklicken · Esc beendet";
    else if (this.messen) t.textContent = this.modus === "2d"
      ? "Messen: Anfangs- und Endpunkt anklicken · rastet an Ecken/Kanten ein (Alt = frei, Umschalt = waagrecht/senkrecht) · ziehen = verschieben · Esc löscht/beendet"
      : "Messen: zwei Punkte auf Flächen anklicken · rastet an Ecken ein (Alt = frei) · ziehen = drehen · Esc löscht/beendet";
    else if (this.modus === "2d") t.textContent = "Ziehen = verschieben (Alt = 1 cm) · Griff = drehen (Umschalt = frei) · R/Q/E drehen · Entf löschen · Strg+D duplizieren · Mausrad zoomt";
    else if (this.szene.modus === "begehen") t.textContent = "W A S D laufen (Umschalt = schneller) · ziehen = umschauen · Doppelklick = Maus fangen (Esc lösen) · Klick auf Boden = hingehen · Klick auf Möbel = auswählen";
    else t.textContent = "Ziehen = drehen · Rechts/zwei Finger = verschieben · Rad = zoomen · Möbel anklicken und ziehen · R/Q/E drehen";
  }

  private tasten() {
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const strg = e.ctrlKey || e.metaKey;
      if (strg && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.wiederholen() : this.rueckgaengig(); return; }
      if (strg && e.key.toLowerCase() === "y") { e.preventDefault(); this.wiederholen(); return; }
      if (strg && e.key.toLowerCase() === "d") { e.preventDefault(); this.duplizieren(); return; }
      if (strg && e.key.toLowerCase() === "s") { e.preventDefault(); this.speichern(); return; }
      if (!strg && e.key.toLowerCase() === "m" && !(this.modus === "3d" && this.szene.modus === "begehen")) { this.messenSetzen(!this.messen); return; }
      if (e.key === "Escape") {
        if (this.messen) {
          const etwas = this.modus === "2d" ? this.plan.messAbbrechen() : this.szene.messAbbrechen();
          if (!etwas) this.messenSetzen(false);
          return;
        }
        if (this.pinsel.aktiv) this.pinselSetzen(false);
        else this.waehlen(null);
        return;
      }
      const beg = this.modus === "3d" && this.szene.modus === "begehen";
      if (this.bauteil && !beg && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const st = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05;
        const d: Record<string, P2> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
        const b = this.bauteil;
        this.aendern((m) => bauteilVerschieben(m, b, ...d[e.key]), "haus", `${b.id} verschoben`);
        return;
      }
      if (!this.auswahl) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.loeschen(); }
      else if (e.key === "r" || e.key === "R") this.drehen(e.shiftKey ? -90 : 90);
      else if (e.key === "q") this.drehen(-15);
      else if (e.key === "e") this.drehen(15);
      else if (!beg && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const s = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05;
        const d: Record<string, P2> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
        this.schieben(...d[e.key]);
      }
    });
    document.getElementById("modi")!.addEventListener("click", (e) => {
      const m = (e.target as HTMLElement).closest("button")?.dataset.modus as Modus | undefined;
      if (m) this.modusSetzen(m);
    });
    document.getElementById("geschosse")!.addEventListener("click", (e) => {
      const g = (e.target as HTMLElement).closest("button")?.dataset.g;
      if (!g) return;
      if (this.modus === "2d") {
        this.planGeschoss = g as "EG" | "OG";
        this.planNeu();
      } else {
        this.szene.geschoss = g as Geschossfilter;
        this.szene.sichtbarkeit();
      }
      this.kopfLeiste();
    });
    document.getElementById("kameramodus")!.addEventListener("click", (e) => {
      const k = (e.target as HTMLElement).closest("button")?.dataset.k;
      if (k === "begehen") this.szene.begehen();
      else if (k === "orbit") this.szene.umschauen();
      this.kopfLeiste();
    });
    (document.getElementById("dach") as HTMLInputElement).addEventListener("change", (e) => {
      this.szene.dachZeigen = (e.target as HTMLInputElement).checked;
      this.szene.sichtbarkeit();
    });
    document.getElementById("rueck")!.onclick = () => this.rueckgaengig();
    document.getElementById("vor")!.onclick = () => this.wiederholen();
    document.getElementById("foto")!.onclick = () => this.screenshot();
    document.getElementById("messenKnopf")!.onclick = () => this.messenSetzen(!this.messen);
    document.getElementById("seiteSchalter")!.onclick = () => document.getElementById("app")!.classList.toggle("ohneSeite");
    document.getElementById("tabs")!.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("button")?.dataset.tab;
      if (t) {
        this.tab = t;
        this.seiteNeu();
      }
    });
  }

  async screenshot(titel?: string) {
    try {
      let blob: Blob, kamera: any = {};
      if (this.modus === "2d") blob = await this.plan.alsPng();
      else {
        blob = await this.szene.bildschirmfoto();
        kamera = this.szene.kameraDaten();
      }
      const name = titel ?? (this.modus === "2d" ? `Plan ${this.planGeschoss}` : `3D ${this.einstellungsText()}`);
      await api.bildHochladen(blob, name, "screenshot", this.modus, { ...kamera, einstellungen: this.modell.einstellungen });
      toast("Screenshot gespeichert (Rendering → Bilder)", "ok");
      this.render.listenNeu();
    } catch (e) {
      toast(`Screenshot fehlgeschlagen: ${(e as Error).message}`, "fehler");
    }
  }

  einstellungsText(): string {
    const e = this.modell.einstellungen ?? {};
    const sz = (this.modell.szenarien ?? []).find((s: any) => s.id === e.szenario);
    return `${e.datum ?? ""} ${e.uhrzeit ?? ""}${sz ? " · " + sz.name : ""}`;
  }

  messen = false;
  /** Messwerkzeug (Plan und 3D): Klick, Klick = Strecke; aus = Messungen löschen. */
  messenSetzen(an: boolean) {
    if (an && this.pinsel.aktiv) this.pinselSetzen(false);
    this.messen = an;
    this.szene.messen = an;
    this.plan.messen = an;
    if (!an) {
      this.szene.messAbbrechen();
      this.plan.messungen = [];
      this.plan.messAbbrechen();
    }
    if (an) this.waehlen(null);
    document.getElementById("buehne")!.classList.toggle("messen", an);
    document.getElementById("messenKnopf")!.classList.toggle("an", an);
    this.hilfe();
  }

  pinselSetzen(an: boolean) {
    this.pinsel.aktiv = an;
    this.szene.pinsel = an;
    this.plan.pinsel = an;
    document.getElementById("buehne")!.classList.toggle("pinsel", an);
    this.hilfe();
    if (this.tab === "farben") this.seiteNeu();
  }

  // ---------------------------------------------------------------------------
  // Seitenleiste
  // ---------------------------------------------------------------------------
  seiteNeu() {
    for (const b of document.querySelectorAll<HTMLButtonElement>("#tabs button")) b.classList.toggle("an", b.dataset.tab === this.tab);
    const c = document.getElementById("tabinhalt")!;
    const scroll = c.scrollTop;
    leeren(c);
    const f: Record<string, () => void> = {
      moebel: () => this.tabMoebel(c), katalog: () => this.tabKatalog(c), farben: () => this.tabFarben(c), licht: () => this.tabLicht(c),
      ansichten: () => this.tabAnsichten(c), staende: () => this.tabStaende(c),
    };
    f[this.tab]?.();
    c.scrollTop = scroll;
  }

  private tabMoebel(c: HTMLElement) {
    const raeume = new Map<string, any>(this.modell.raeume.map((r: any) => [r.id, r]));
    const gruppen = new Map<string, any[]>();
    for (const x of this.modell.moebel) {
      const k = x.raum || "ohne Raum";
      if (!gruppen.has(k)) gruppen.set(k, []);
      gruppen.get(k)!.push(x);
    }
    c.append(h("div", { class: "zeile" },
      h("button", { class: "haupt", onclick: () => { this.tab = "katalog"; this.tauschModus = false; this.seiteNeu(); } }, "+ Möbel aus Katalog"),
      h("span", { class: "dezent" }, `${this.modell.moebel.length} Stück`)));
    if (this.hinweise.length) {
      const hw = h("div", { class: "hinweise" }, h("h4", {}, `⚠ ${this.hinweise.length} Hinweis${this.hinweise.length > 1 ? "e" : ""}`));
      for (const x of this.hinweise.slice(0, 30)) hw.append(h("div", { class: "hinweis", onclick: () => this.waehlen(x.ids[0]) }, x.text));
      c.append(hw);
    }
    const reihenfolge = ["wohnen", "diele", "schlafen", "bad", "hwr", "galerie", "kinder"];
    const schluessel = [...gruppen.keys()].sort((a, b) => (reihenfolge.indexOf(a) + 99) % 99 - (reihenfolge.indexOf(b) + 99) % 99);
    for (const k of schluessel) {
      const r = raeume.get(k);
      c.append(h("h4", {}, `${r?.name ?? k}${r ? ` · ${r.geschoss}` : ""}`));
      for (const x of gruppen.get(k)!) {
        const warn = this.hinweise.some((hw) => hw.ids.includes(x.id));
        c.append(h("div", { class: "eintrag" + (x.id === this.auswahl ? " an" : "") + (warn ? " warnung" : ""), onclick: () => { this.waehlen(x.id); this.szene.fokus(x.id); } },
          h("span", { class: "punkt", style: { background: x.farbe_hex } }),
          h("span", { class: "name" }, x.name ?? x.typ),
          h("span", { class: "dezent" }, x.masse_bth.map((v: number) => Math.round(v * 100)).join("×"))));
      }
    }
  }

  private tabKatalog(c: HTMLElement) {
    const sel = this.gewaehlt();
    const bib = this.modell.bibliothek ?? [];
    const kats = [...new Set(bib.map((v: any) => v.kategorie ?? "Sonstiges"))] as string[];
    if (sel) {
      c.append(h("div", { class: "zeile umschalter klein" },
        h("button", { class: !this.tauschModus ? "an" : "", onclick: () => { this.tauschModus = false; this.seiteNeu(); } }, "Hinzufügen"),
        h("button", { class: this.tauschModus ? "an" : "", onclick: () => { this.tauschModus = true; this.seiteNeu(); } }, `„${(sel.name ?? sel.typ).slice(0, 18)}“ tauschen`)));
    }
    const suche = h("input", { type: "search", placeholder: "Suchen …", value: this.katalogFilter.suche, oninput: (e: Event) => { this.katalogFilter.suche = (e.target as HTMLInputElement).value; liste(); } });
    c.append(suche);
    const chips = h("div", { class: "chips" });
    for (const k of ["", ...kats]) chips.append(h("button", { class: this.katalogFilter.kategorie === k ? "an" : "", onclick: () => { this.katalogFilter.kategorie = k; this.seiteNeu(); } }, k || "Alle"));
    c.append(chips);
    const box = h("div");
    c.append(box);
    const liste = () => {
      leeren(box);
      const s = this.katalogFilter.suche.toLowerCase();
      for (const v of bib) {
        if (this.katalogFilter.kategorie && (v.kategorie ?? "Sonstiges") !== this.katalogFilter.kategorie) continue;
        if (s && !`${v.name} ${v.typ} ${v.material ?? ""} ${v.farbe ?? ""}`.toLowerCase().includes(s)) continue;
        box.append(h("div", { class: "eintrag", onclick: () => (this.tauschModus && sel ? this.tauschen(v) : this.ausVorlage(v)) },
          h("span", { class: "punkt", style: { background: v.farbe_hex } }),
          h("span", { class: "name" }, v.name, v.quelle ? h("small", {}, ` · ${v.quelle}`) : null),
          h("span", { class: "dezent" }, v.masse_bth.map((x: number) => Math.round(x * 100)).join("×")),
          h("span", { class: "aktion" }, this.tauschModus && sel ? "⇄" : "+")));
      }
    };
    liste();
    if (sel) c.append(h("button", { class: "leise", onclick: () => this.alsVorlage(sel) }, "Auswahl als eigene Vorlage speichern"));
    c.append(h("p", { class: "dezent" }, "Neue Möbel aus Fotos, Konzepten oder Renderings ergänzt Claude über den MCP (bibliothek_setzen / moebel_setzen). Sie erscheinen hier automatisch."));
  }

  private alsVorlage(x: any) {
    const name = frage("Name der Vorlage", x.name ?? x.typ);
    if (!name) return;
    const vid = name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").slice(0, 40);
    this.aendern((m) => {
      m.bibliothek = (m.bibliothek ?? []).filter((v: any) => v.vorlage_id !== vid);
      m.bibliothek.push({ vorlage_id: vid, typ: x.typ, name, masse_bth: [...x.masse_bth], farbe: x.farbe, farbe_hex: x.farbe_hex, material: x.material, kategorie: "Eigene", quelle: `Planer (${this.ich})`, ...(x.z ? { z: x.z } : {}) });
    }, "moebel", `Vorlage ${name}`);
  }

  private tabFarben(c: HTMLElement) {
    const p = this.pinsel;
    c.append(h("h4", {}, "Pinsel"));
    const chips = h("div", { class: "palette" });
    for (const [n, hex] of PALETTE)
      chips.append(h("button", { title: n, class: p.farbe === hex ? "an" : "", style: { background: hex }, onclick: () => { p.farbe = hex; p.name = n; if (/fichte|eiche/i.test(n)) p.material = "Sichtholz"; this.seiteNeu(); } }));
    c.append(chips);
    c.append(h("div", { class: "zeile" },
      h("input", { type: "color", value: p.farbe, oninput: (e: Event) => { p.farbe = (e.target as HTMLInputElement).value; p.name = p.farbe; } }),
      h("select", { onchange: (e: Event) => (p.material = (e.target as HTMLSelectElement).value) },
        ...[...MATERIALIEN, ...BODEN_MAT].map((m) => h("option", { value: m, selected: m === p.material }, m))),
      h("button", { class: p.aktiv ? "haupt an" : "haupt", onclick: () => this.pinselSetzen(!p.aktiv) }, p.aktiv ? "🖌 Pinsel aus" : "🖌 Wand/Boden anklicken")));
    c.append(h("p", { class: "dezent" }, "Im Plan oder in 3D eine Wandseite bzw. einen Boden anklicken. Jede Wandseite wird einzeln gespeichert."));

    const ob = this.modell.oberflaechen;
    c.append(h("h4", {}, "Standard für alle Wände"));
    c.append(h("div", { class: "zeile" },
      h("input", { type: "color", value: ob.standard?.farbe_hex ?? "#f1efea", onchange: (e: Event) => this.aendern((m) => { m.oberflaechen.standard.farbe_hex = (e.target as HTMLInputElement).value; m.oberflaechen.standard.farbe = (e.target as HTMLInputElement).value; }, "haus", "Wandfarbe Standard") }),
      h("select", { onchange: (e: Event) => this.aendern((m) => (m.oberflaechen.standard.material = (e.target as HTMLSelectElement).value), "haus", "Wandmaterial Standard") },
        ...MATERIALIEN.map((m) => h("option", { value: m, selected: m === ob.standard?.material }, m))),
      h("span", { class: "dezent" }, ob.standard?.farbe ?? "")));
    // Sockelleisten
    const sl = { farbe_hex: "#161616", hoehe: 0.06, ohne: ["bad"], ...(ob.sockelleiste ?? {}) };
    const setzeSl = (neu: any, notiz: string) => this.aendern((m) => (m.oberflaechen.sockelleiste = { ...(m.oberflaechen.sockelleiste ?? {}), ...neu }), "haus", notiz);
    c.append(h("h4", {}, "Sockelleisten"), h("div", { class: "zeile" },
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: !sl.aus, onchange: (e: Event) => setzeSl({ aus: !(e.target as HTMLInputElement).checked }, "Sockelleisten an/aus") }), h("span", {}, "an")),
      h("input", { type: "color", value: sl.farbe_hex, title: "Farbe", onchange: (e: Event) => setzeSl({ farbe_hex: (e.target as HTMLInputElement).value }, "Sockelleisten Farbe") }),
      h("label", { class: "dezent" }, "Höhe cm"),
      h("input", { type: "number", class: "lumen", min: 2, max: 20, step: 0.5, value: Math.round(sl.hoehe * 1000) / 10,
        onchange: (e: Event) => setzeSl({ hoehe: Math.max(2, Number((e.target as HTMLInputElement).value)) / 100 }, "Sockelleisten Höhe") })),
      h("div", { class: "zeile" }, h("span", { class: "dezent" }, "ohne in:"), ...this.modell.raeume.map((r: any) => h("label", { class: "check" },
        h("input", { type: "checkbox", checked: (sl.ohne ?? []).includes(r.id), onchange: (e: Event) => {
          const an = (e.target as HTMLInputElement).checked;
          const ohne = new Set<string>(sl.ohne ?? []);
          if (an) ohne.add(r.id); else ohne.delete(r.id);
          setzeSl({ ohne: [...ohne] }, `Sockelleisten ${r.name ?? r.id}`);
        } }), h("span", {}, r.name ?? r.id)))));
    // Böden
    c.append(h("h4", {}, "Böden"));
    const bStd = { material: "Klickvinyl", farbe: "Eiche natur", farbe_hex: "#c8a274", dielenbreite: 0.2, dielenlaenge: 1.2, richtung_grad: 0, ...(ob.boden_standard ?? {}) };
    c.append(h("div", { class: "boden" }, h("strong", {}, "Standard (alle Wohnräume)"),
      ...this.bodenSteuerung(bStd, (neu) => this.aendern((m) => (m.oberflaechen.boden_standard = { ...bStd, ...neu }), "haus", "Boden Standard"))));
    for (const r of this.modell.raeume) {
      const eigen = (ob.flaechen ?? []).find((f: any) => f.art === "boden" && f.raum === r.id);
      const setze = (neu: any) => this.aendern((m) => {
        const fl = (m.oberflaechen.flaechen ??= []);
        const i = fl.findIndex((f: any) => f.art === "boden" && f.raum === r.id);
        const alt = i >= 0 ? fl[i] : { id: `boden-${r.id}`, art: "boden", raum: r.id, ...bStd };
        const wert = { ...alt, ...neu, quelle: `Planer (${this.ich})` };
        if (i >= 0) fl[i] = wert;
        else fl.push(wert);
      }, "haus", `Boden ${r.name}`);
      const zeile = h("div", { class: "boden" },
        h("div", { class: "zeile" }, h("strong", {}, `${r.name} · ${r.geschoss}`),
          h("select", { onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === "eigen") setze({});
            else this.aendern((m) => (m.oberflaechen.flaechen = m.oberflaechen.flaechen.filter((f: any) => !(f.art === "boden" && f.raum === r.id))), "haus", `Boden ${r.name} wie Standard`);
          } }, h("option", { value: "std", selected: !eigen }, ["bad", "hwr"].includes(r.id) ? "Vorgabe (Fliese/Estrich)" : "wie Standard"), h("option", { value: "eigen", selected: !!eigen }, "eigener Boden"))));
      if (eigen) zeile.append(...this.bodenSteuerung({ ...bStd, ...eigen }, setze));
      c.append(zeile);
    }

    // Fassade
    const fa = { material: "Holzschalung senkrecht", farbe_hex: "#7a6450", ...(ob.fassade ?? {}) };
    c.append(h("h4", {}, "Fassade"), h("div", { class: "zeile" },
      h("input", { type: "color", value: fa.farbe_hex, onchange: (e: Event) => this.aendern((m) => (m.oberflaechen.fassade = { ...fa, farbe_hex: (e.target as HTMLInputElement).value, farbe: (e.target as HTMLInputElement).value }), "haus", "Fassade Farbe") }),
      h("select", { onchange: (e: Event) => this.aendern((m) => (m.oberflaechen.fassade = { ...fa, material: (e.target as HTMLSelectElement).value }), "haus", "Fassade Material") },
        ...["Holzschalung senkrecht", "Putz", "Beton", "Glatt"].map((x) => h("option", { value: x, selected: x === fa.material }, x)))));

    c.append(h("h4", {}, `Einzelne Flächen (${(ob.flaechen ?? []).length})`));
    for (const f of ob.flaechen ?? []) {
      const titel = f.art === "boden" ? `Boden ${this.modell.raeume.find((r: any) => r.id === f.raum)?.name ?? f.raum}` : `${f.wand ?? f.element ?? f.id}${f.seite ? " · " + f.seite : ""}`;
      c.append(h("div", { class: "eintrag" },
        h("input", { type: "color", value: f.farbe_hex ?? "#ffffff", onchange: (e: Event) => this.aendern((m) => { const g = m.oberflaechen.flaechen.find((y: any) => y.id === f.id); g.farbe_hex = (e.target as HTMLInputElement).value; g.farbe = g.farbe_hex; }, "haus", `Fläche ${f.id}`) }),
        h("span", { class: "name" }, titel, h("small", {}, ` ${f.material ?? ""}${f.x || f.y || f.z ? " (Teilfläche)" : ""}`)),
        h("button", { class: "x", title: "Entfernen", onclick: () => this.aendern((m) => (m.oberflaechen.flaechen = m.oberflaechen.flaechen.filter((y: any) => y.id !== f.id)), "haus", `Fläche ${f.id} entfernt`) }, "×")));
    }
  }

  /** Bedienelemente für einen Bodenbelag: Dekor, Farbe, Verlegerichtung, Dielenformat */
  private bodenSteuerung(b: any, setze: (neu: any) => void): HTMLElement[] {
    const holz = !/fliese|stein|beton|estrich|teppich/i.test(b.material ?? "");
    const deko = h("select", { onchange: (e: Event) => { const d = BODEN_DEKORE.find((x) => x[0] === (e.target as HTMLSelectElement).value); if (d) setze({ material: d[1], farbe: d[0], farbe_hex: d[2] }); } },
      h("option", { value: "" }, "Dekor wählen …"), ...BODEN_DEKORE.map(([n, , hex]) => h("option", { value: n, selected: hex === b.farbe_hex }, n)));
    const out: HTMLElement[] = [
      h("div", { class: "zeile" }, deko,
        h("input", { type: "color", value: b.farbe_hex ?? "#c8a274", title: "Farbe frei wählen", onchange: (e: Event) => setze({ farbe_hex: (e.target as HTMLInputElement).value, farbe: (e.target as HTMLInputElement).value }) }),
        h("select", { title: "Belag", onchange: (e: Event) => setze({ material: (e.target as HTMLSelectElement).value }) },
          ...BODEN_MAT.map((x) => h("option", { value: x, selected: x === b.material }, x)))),
    ];
    if (holz)
      out.push(h("div", { class: "zeile" },
        h("select", { title: "Verlegerichtung", onchange: (e: Event) => setze({ richtung_grad: Number((e.target as HTMLSelectElement).value) }) },
          ...([[0, "Dielen Nord–Süd (zur Glasfront)"], [90, "Dielen Ost–West"], [45, "diagonal 45°"], [135, "diagonal 135°"]] as [number, string][]).map(([v, t]) => h("option", { value: v, selected: Number(b.richtung_grad ?? 0) === v }, t))),
        h("label", { class: "dezent" }, "B×L cm"),
        h("input", { type: "number", class: "lumen", min: 8, max: 40, step: 1, value: Math.round((b.dielenbreite ?? 0.2) * 100), title: "Dielenbreite cm",
          onchange: (e: Event) => setze({ dielenbreite: Number((e.target as HTMLInputElement).value) / 100 }) }),
        h("input", { type: "number", class: "lumen", min: 40, max: 300, step: 5, value: Math.round((b.dielenlaenge ?? 1.2) * 100), title: "Dielenlänge cm",
          onchange: (e: Event) => setze({ dielenlaenge: Number((e.target as HTMLInputElement).value) / 100 }) })));
    return out;
  }

  private einst(fn: (e: any) => void, notiz = "Licht/Zeit") {
    this.aendern((m) => { m.einstellungen ??= {}; fn(m.einstellungen); }, "einstellungen", notiz, false);
  }

  private tabLicht(c: HTMLElement) {
    const e = this.modell.einstellungen ?? {};
    const s = sonnenstand(e.breitengrad ?? 49.654, e.laengengrad ?? 9.077, e.datum ?? "2026-06-21", e.uhrzeit ?? "12:00", e.nordwinkel ?? 0);
    const minuten = (() => { const [a, b] = String(e.uhrzeit ?? "12:00").split(":").map(Number); return a * 60 + (b || 0); })();
    const zeitLabel = h("strong", {}, e.uhrzeit ?? "12:00");
    c.append(h("h4", {}, "Tageszeit und Datum"));
    c.append(h("div", { class: "zeile" },
      h("input", { type: "date", value: e.datum ?? "2026-06-21", onchange: (ev: Event) => this.einst((x) => (x.datum = (ev.target as HTMLInputElement).value), "Datum") }),
      ...[["21.3.", "03-21"], ["21.6.", "06-21"], ["23.9.", "09-23"], ["21.12.", "12-21"]].map(([t, d]) =>
        h("button", { class: "klein", onclick: () => this.einst((x) => (x.datum = `${(x.datum ?? "2026").slice(0, 4)}-${d}`), "Datum") }, t))));
    const regler = h("input", { type: "range", min: 0, max: 1439, step: 5, value: minuten, class: "breit",
      oninput: (ev: Event) => {
        const v = Number((ev.target as HTMLInputElement).value);
        const t = `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
        zeitLabel.textContent = t;
        this.modell.einstellungen.uhrzeit = t;
        this.szene.einstellungen(this.modell.einstellungen);
      },
      onchange: () => this.einst(() => {}, "Uhrzeit") });
    c.append(h("div", { class: "zeile" }, zeitLabel, regler,
      h("button", { class: "klein", title: "Tagesverlauf abspielen", onclick: () => this.tagAbspielen() }, this.zeitAnimation ? "■" : "▶")));
    c.append(h("p", { class: "dezent" }, `Sonne: Azimut ${zahl(s.azimut, 0)}°, Höhe ${zahl(s.hoehe, 0)}° ${s.hoehe < 0 ? "(unter dem Horizont)" : ""}`));
    c.append(h("div", { class: "zeile" }, h("label", {}, "Belichtung"),
      h("input", { type: "range", min: 0.3, max: 3, step: 0.05, value: e.belichtung ?? 1, class: "breit",
        oninput: (ev: Event) => { this.modell.einstellungen.belichtung = Number((ev.target as HTMLInputElement).value); this.szene.einstellungen(this.modell.einstellungen); },
        onchange: () => this.einst(() => {}, "Belichtung") })));

    c.append(h("h4", {}, "Lichtszenario"));
    const sz = this.modell.szenarien ?? [];
    c.append(h("div", { class: "chips" }, ...sz.map((x: any) => h("button", { class: e.szenario === x.id ? "an" : "", onclick: () => this.einst((y) => { y.szenario = x.id; y.dimmer = {}; }, `Szenario ${x.name}`) }, x.name))));
    const werte = { ...((sz.find((x: any) => x.id === e.szenario)?.leuchten) ?? {}), ...(e.dimmer ?? {}) };
    for (const l of this.szene.alleLeuchten()) {
      const v = Math.round((werte[l.id] ?? 0) * 100);
      const kelvins = [...new Set([2200, 2700, 3000, 3500, 4000, l.kelvin])].sort((x, y) => x - y);
      c.append(h("div", { class: "eintrag licht" },
        h("span", { class: "name" }, l.name, h("small", {}, ` ${l.lumen} lm`)),
        ...this.lichtFarbWahl(l, kelvins),
        h("input", { type: "number", class: "lumen", title: "Lichtstrom (Lumen)", min: 0, step: 50, value: l.lumen,
          onchange: (ev: Event) => { const n = Number((ev.target as HTMLInputElement).value); if (n >= 0) this.lichtSetzen(l, { lumen: n }); } }),
        h("input", { type: "range", min: 0, max: 100, step: 5, value: v,
          oninput: (ev: Event) => { this.modell.einstellungen.dimmer = { ...(this.modell.einstellungen.dimmer ?? {}), [l.id]: Number((ev.target as HTMLInputElement).value) / 100 }; this.szene.szenarioAnwenden(); },
          onchange: () => this.einst(() => {}, `Dimmer ${l.name}`) }),
        h("span", { class: "dezent" }, `${v} %`)));
      if (l.daten?.typ === "stromschiene" && (this.modell.leuchten ?? []).some((x: any) => x.id === l.id)) c.append(this.schienenEinstellung(l));
    }
    c.append(h("div", { class: "zeile" },
      h("button", { onclick: () => this.szenarioSpeichern(false) }, "Als neues Szenario"),
      e.szenario ? h("button", { onclick: () => this.szenarioSpeichern(true) }, "Szenario überschreiben") : null));
    c.append(h("p", { class: "dezent" }, "Die Deckenleuchten sind Platzhalter (Annahme), bis die Lichtplanung eingepflegt ist – über den MCP mit leuchten_setzen."));
  }

  /** Lichtfarbe: Weiß (Kelvin) oder Farbe (z. B. Hue) mit Farbwähler */
  private lichtFarbWahl(l: any, kelvins: number[]): HTMLElement[] {
    const d = (this.modell.moebel ?? []).find((x: any) => x.id === l.id)?.licht ?? (this.modell.leuchten ?? []).find((x: any) => x.id === l.id) ?? {};
    const farbig = d.farbmodus === "farbe";
    const wahl = h("select", { class: "kelvin", title: "Weiß (Farbtemperatur) oder Farbe",
      onchange: (ev: Event) => {
        const v = (ev.target as HTMLSelectElement).value;
        if (v === "farbe") this.lichtSetzen(l, { farbmodus: "farbe", farbe_licht: d.farbe_licht ?? "#ff8a3d" });
        else this.lichtSetzen(l, { kelvin: Number(v), farbmodus: "weiss" });
      } },
      ...kelvins.map((k) => h("option", { value: k, selected: !farbig && k === l.kelvin }, `${k} K`)),
      h("option", { value: "farbe", selected: farbig }, "Farbe …"));
    const out: HTMLElement[] = [wahl];
    if (farbig) out.push(h("input", { type: "color", class: "lichtfarbe", value: d.farbe_licht ?? "#ff8a3d", title: "Lichtfarbe",
      onchange: (ev: Event) => this.lichtSetzen(l, { farbmodus: "farbe", farbe_licht: (ev.target as HTMLInputElement).value }) }));
    return out;
  }

  /** Spots einer Stromschiene: Neigung (alle oder einzeln), Seite, Abstrahlwinkel, Anzahl, Reflexion */
  private schienenEinstellung(l: any): HTMLElement {
    const d = l.daten;
    const n = Math.max(1, d.anzahl ?? 4);
    const det = h("details", { class: "schiene", open: this.offeneSchienen.has(l.id) || undefined });
    det.addEventListener("toggle", () => (det.open ? this.offeneSchienen.add(l.id) : this.offeneSchienen.delete(l.id)));
    const seiten: [string, string][] = [["abwechselnd", "abwechselnd"], ["links", "links"], ["rechts", "rechts"], ...(d.wand ? [["raum", "in den Raum"] as [string, string]] : [])];
    const aktSeite = d.spot_seite ?? (d.wand ? "raum" : "abwechselnd");
    const winkelLabel = (w: number) => `${w}° ${w <= 20 ? "(nach unten)" : w >= 160 ? "(nach oben)" : w > 80 && w < 100 ? "(waagrecht)" : w > 100 ? "(schräg nach oben)" : "(schräg nach unten)"}`;
    const regler = (wert: number, fn: (v: number) => void, kurz = false) => {
      const txt = (w: number) => (kurz ? `${w}°` : winkelLabel(w));
      const lab = h("span", { class: kurz ? "dezent kurz" : "dezent" }, txt(wert));
      return [h("input", { type: "range", min: 0, max: 180, step: 5, value: wert, class: "breit",
        oninput: (e: Event) => (lab.textContent = txt(Number((e.target as HTMLInputElement).value))),
        onchange: (e: Event) => fn(Number((e.target as HTMLInputElement).value)) }), lab];
    };
    const w0 = spotWinkel(d, 0);
    const hoeheZeile = d.wand ? [h("div", { class: "zeile" },
      h("label", {}, "Höhe"), h("input", { type: "number", min: 0.5, max: 8, step: 0.05, value: typeof d.hoehe === "number" ? d.hoehe : "", placeholder: "oben", class: "lumen",
        title: "Montagehöhe über Fußboden in m (Schiene waagrecht). Leer = an der Wandoberkante entlang",
        onchange: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value.replace(",", ".")); this.lichtSetzen(l, { hoehe: isNaN(v) ? undefined : v }); } }),
      h("label", {}, "Abstand oben"), h("input", { type: "number", min: 0, max: 3, step: 0.05, value: d.abstand_oben ?? 0.06, class: "lumen",
        title: "Abstand unter der Wandoberkante in m (wenn keine Höhe gesetzt ist)",
        onchange: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value.replace(",", ".")); if (!isNaN(v)) this.lichtSetzen(l, { abstand_oben: Math.max(0, v), hoehe: undefined }); } }))] : [];
    det.append(h("summary", {}, "Spots einstellen"), ...hoeheZeile,
      h("div", { class: "zeile" }, h("label", {}, "Neigung alle"), ...regler(w0, (v) => this.lichtSetzen(l, { winkel_grad: v, spots: [] }))),
      h("div", { class: "zeile" },
        h("label", {}, "Seite"), h("select", { onchange: (e: Event) => this.lichtSetzen(l, { spot_seite: (e.target as HTMLSelectElement).value, spots: (d.spots ?? []).map((x: any) => ({ ...x, seite: undefined })) }) },
          ...seiten.map(([k, t]) => h("option", { value: k, selected: k === aktSeite }, t))),
        h("label", {}, "Kegel"), h("input", { type: "number", min: 10, max: 120, step: 5, value: d.abstrahlwinkel ?? 36, class: "lumen", title: "Abstrahlwinkel in Grad",
          onchange: (e: Event) => this.lichtSetzen(l, { abstrahlwinkel: Number((e.target as HTMLInputElement).value) }) }),
        h("label", {}, "Anzahl"), h("input", { type: "number", min: 1, max: 16, step: 1, value: n, class: "lumen",
          onchange: (e: Event) => this.lichtSetzen(l, { anzahl: Math.max(1, Number((e.target as HTMLInputElement).value)) }) })),
      h("label", { class: "zeile check" }, h("input", { type: "checkbox", checked: d.reflexion ?? w0 > 95,
        onchange: (e: Event) => this.lichtSetzen(l, { reflexion: (e.target as HTMLInputElement).checked }) }),
        h("span", {}, "Reflexion simulieren (angestrahltes Holz hellt den Raum auf; im Rendering physikalisch)")));
    for (let i = 0; i < n; i++) {
      const sp = (d.spots ?? [])[i] ?? {};
      const setzeSpot = (felder: any) => {
        const spots = Array.from({ length: n }, (_, k) => ({ ...((d.spots ?? [])[k] ?? {}) }));
        Object.assign(spots[i], felder);
        this.lichtSetzen(l, { spots });
      };
      det.append(h("div", { class: "zeile spot" }, h("label", {}, `Spot ${i + 1}`), ...regler(spotWinkel(d, i), (v) => setzeSpot({ winkel_grad: v }), true),
        h("select", { onchange: (e: Event) => setzeSpot({ seite: (e.target as HTMLSelectElement).value || undefined }) },
          h("option", { value: "" }, "wie alle"), ...seiten.map(([k, t]) => h("option", { value: k, selected: sp.seite === k }, t)))));
    }
    return det;
  }

  /** Farbtemperatur, Lichtstrom oder weitere Felder einer Leuchte (Modell-Leuchte oder Möbel mit Licht) ändern */
  private lichtSetzen(l: { id: string; name: string; lumen: number; kelvin: number }, felder: Record<string, any>) {
    const istMoebel = (this.modell.moebel ?? []).some((x: any) => x.id === l.id);
    const text = felder.kelvin ? `${felder.kelvin} K` : felder.lumen !== undefined ? `${felder.lumen} lm` : Object.keys(felder).join(", ");
    this.aendern((m) => {
      if (istMoebel) {
        const x = m.moebel.find((y: any) => y.id === l.id);
        x.licht = { lumen: l.lumen, kelvin: l.kelvin, ...(x.licht ?? {}), ...felder };
      } else {
        const le = (m.leuchten ?? []).find((y: any) => y.id === l.id);
        if (le) {
          Object.assign(le, felder);
          for (const k of Object.keys(felder)) if (felder[k] === undefined) delete le[k];
        }
      }
    }, istMoebel ? "moebel" : "licht", `${l.name}: ${text}`);
  }

  private szenarioSpeichern(ueberschreiben: boolean) {
    const e = this.modell.einstellungen;
    const alt = (this.modell.szenarien ?? []).find((x: any) => x.id === e.szenario);
    const werte = { ...(alt?.leuchten ?? {}), ...(e.dimmer ?? {}) };
    for (const k of Object.keys(werte)) if (!werte[k]) delete werte[k];
    if (ueberschreiben && alt) {
      this.aendern((m) => { m.szenarien.find((x: any) => x.id === alt.id).leuchten = werte; m.einstellungen.dimmer = {}; }, "einstellungen", `Szenario ${alt.name}`);
      return;
    }
    const name = frage("Name des Szenarios", "Mein Szenario");
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-");
    this.aendern((m) => { m.szenarien = (m.szenarien ?? []).filter((x: any) => x.id !== id); m.szenarien.push({ id, name, leuchten: werte }); m.einstellungen.szenario = id; m.einstellungen.dimmer = {}; }, "einstellungen", `Szenario ${name}`);
  }

  private tagAbspielen() {
    if (this.zeitAnimation) {
      window.clearInterval(this.zeitAnimation);
      this.zeitAnimation = 0;
      this.einst(() => {}, "Uhrzeit");
      return;
    }
    this.zeitAnimation = window.setInterval(() => {
      const e = this.modell.einstellungen;
      let [a, b] = String(e.uhrzeit ?? "06:00").split(":").map(Number);
      let v = a * 60 + b + 6;
      if (v >= 22 * 60) v = 5 * 60;
      e.uhrzeit = `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
      this.szene.einstellungen(e);
      if (this.tab === "licht") {
        const r = document.querySelector<HTMLInputElement>("#tabinhalt input[type=range]");
        if (r) r.value = String(v);
        const l = document.querySelector("#tabinhalt strong");
        if (l) l.textContent = e.uhrzeit;
      }
    }, 60);
    this.seiteNeu();
  }

  private tabAnsichten(c: HTMLElement) {
    c.append(h("div", { class: "zeile" },
      h("button", { class: "haupt", onclick: () => this.ansichtSpeichern(), disabled: this.modus === "2d" }, "Aktuelle Ansicht speichern")));
    for (const a of this.modell.ansichten ?? []) {
      c.append(h("div", { class: "eintrag" },
        h("span", { class: "name", onclick: () => this.ansichtZeigen(a) }, a.name, h("small", {}, a.begehen ? " · begehbar" : " · Übersicht")),
        h("button", { class: "klein", title: "In Cycles rendern", onclick: () => { this.ansichtZeigen(a); this.modusSetzen("render"); } }, "Rendern"),
        h("button", { class: "x", title: "Löschen", onclick: () => this.aendern((m) => (m.ansichten = m.ansichten.filter((x: any) => x.id !== a.id)), "einstellungen", `Ansicht ${a.name} gelöscht`) }, "×")));
    }
    c.append(h("div", { class: "zeile" },
      h("button", { onclick: () => this.alleAnsichtenFotografieren() }, "Screenshot aller Ansichten"),
      h("button", { onclick: () => this.render.alleAnsichtenRendern() }, "Alle Ansichten rendern")));
    c.append(h("p", { class: "dezent" }, "Ansichten werden mit dem Modell gespeichert. Claude kann über den MCP weitere anlegen (ansicht_setzen)."));
  }

  ansichtZeigen(a: any) {
    if (this.modus === "2d") this.modusSetzen("3d");
    this.szene.ansicht(a.kamera, !!a.begehen);
    this.kopfLeiste();
  }

  private ansichtSpeichern() {
    const name = frage("Name der Ansicht", "Neue Ansicht");
    if (!name) return;
    const k = this.szene.kameraDaten();
    const id = name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").slice(0, 40) || "ansicht";
    this.aendern((m) => {
      m.ansichten = (m.ansichten ?? []).filter((x: any) => x.id !== id);
      m.ansichten.push({ id, name, modus: "3d", begehen: k.begehen, kamera: { pos: k.pos, ziel: k.ziel, fov: Math.round(k.fov) } });
    }, "einstellungen", `Ansicht ${name}`);
  }

  private async alleAnsichtenFotografieren() {
    const alt = this.szene.kameraDaten();
    for (const a of this.modell.ansichten ?? []) {
      this.ansichtZeigen(a);
      await new Promise((r) => setTimeout(r, 250));
      await this.screenshot(`${a.name} · ${this.einstellungsText()}`);
    }
    this.szene.ansicht(alt, alt.begehen);
  }

  private async tabStaende(c: HTMLElement) {
    const name = h("input", { type: "text", placeholder: "Name der Variante, z. B. „Sofa an der Glasfront“" });
    c.append(h("h4", {}, "Varianten"), h("div", { class: "zeile" }, name,
      h("button", { class: "haupt", onclick: async () => {
        if (!name.value.trim()) return toast("Bitte einen Namen eingeben");
        await api.varianteSpeichern(name.value.trim(), "", JSON.parse(this.stand));
        toast("Variante gespeichert", "ok");
        this.seiteNeu();
      } }, "Speichern")));
    const vl = h("div");
    const vs = h("div");
    const fr = h("div");
    c.append(vl, h("h4", {}, "Versionen (automatisch)"), vs, h("h4", {}, "Offene Fragen im Modell"), fr);
    for (const q of this.modell.offene_fragen ?? []) fr.append(h("div", { class: "hinweis" }, typeof q === "string" ? q : JSON.stringify(q)));
    const [varianten, versionen] = await Promise.all([api.varianten(), api.versionen()]);
    for (const v of varianten)
      vl.append(h("div", { class: "eintrag" },
        h("span", { class: "name" }, v.name, h("small", {}, ` · ${zeitText(v.zeit)} · ${v.wer}`)),
        h("button", { class: "klein", onclick: async () => {
          if (!confirm(`Variante „${v.name}“ laden? Der aktuelle Stand bleibt als Version erhalten.`)) return;
          const d = await api.varianteLesen(v.slug);
          const m = d.modell;
          this.aendern((alt) => { const ver = alt.meta.version; Object.keys(alt).forEach((k) => delete alt[k]); Object.assign(alt, structuredClone(m)); alt.meta.version = ver; }, "haus", `Variante ${v.name} geladen`);
        } }, "Laden"),
        h("button", { class: "x", onclick: async () => { if (confirm(`Variante „${v.name}“ löschen?`)) { await api.varianteLoeschen(v.slug); this.seiteNeu(); } } }, "×")));
    if (!varianten.length) vl.append(h("p", { class: "dezent" }, "Noch keine Varianten."));
    for (const v of versionen.slice(0, 40))
      vs.append(h("div", { class: "eintrag" },
        h("span", { class: "name" }, `v${v.version}`, h("small", {}, ` ${zeitText(v.zeit)} · ${v.wer} · ${v.notiz ?? ""}`)),
        v.version !== this.basis ? h("button", { class: "klein", onclick: async () => {
          if (!confirm(`Version ${v.version} wiederherstellen?`)) return;
          const m = await api.versionLesen(v.version);
          this.aendern((alt) => { const ver = alt.meta.version; Object.keys(alt).forEach((k) => delete alt[k]); Object.assign(alt, m); alt.meta.version = ver; }, "haus", `Version ${v.version} wiederhergestellt`);
        } }, "Zurückholen") : h("span", { class: "dezent" }, "aktuell")));
  }

  // ---------------------------------------------------------------------------
  // Eigenschaften der Auswahl
  // ---------------------------------------------------------------------------
  eigenschaftenNeu() {
    const p = document.getElementById("eigenschaften")!;
    const x = this.gewaehlt();
    const bt = bauteilFinden(this.modell, this.bauteil);
    p.hidden = !x && !bt;
    leeren(p);
    if (bt) return this.bauteilEigenschaften(p, bt);
    if (!x) return;
    const setze = (feld: string, wert: any, notiz?: string) =>
      this.aendern((m) => {
        const y = m.moebel.find((z: any) => z.id === x.id);
        if (feld === "pos") this.lage(m, x.id, wert);
        else y[feld] = wert;
        if (feld === "farbe_hex") y.farbe = wert;
        if (feld === "z" && !wert) delete y.z;
      }, "moebel", notiz ?? `${x.name}: ${feld}`);
    const num = (wert: number, fn: (v: number) => void, step = 0.01) =>
      h("input", { type: "number", step, value: Math.round(wert * 1000) / 1000, onchange: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value.replace(",", ".")); if (!isNaN(v)) fn(v); } });
    const warn = this.hinweise.filter((hw) => hw.ids.includes(x.id));
    p.append(
      h("div", { class: "kopf" },
        h("input", { class: "titel", value: x.name ?? "", onchange: (e: Event) => setze("name", (e.target as HTMLInputElement).value) }),
        h("button", { class: "x", onclick: () => this.waehlen(null) }, "×")),
      h("div", { class: "raster2" },
        h("label", {}, "Typ"), h("select", { onchange: (e: Event) => setze("typ", (e.target as HTMLSelectElement).value) }, ...[...new Set([x.typ, ...TYPEN])].map((t) => h("option", { value: t, selected: t === x.typ }, t))),
        h("label", {}, "B × T × H (m)"), h("div", { class: "drei" }, ...[0, 1, 2].map((i) => num(x.masse_bth[i], (v) => { const mm = [...x.masse_bth]; mm[i] = Math.max(0.005, v); setze("masse_bth", mm); }))),
        h("label", {}, "Position x / y"), h("div", { class: "zwei" }, num(x.pos[0], (v) => setze("pos", [v, x.pos[1]]), 0.05), num(x.pos[1], (v) => setze("pos", [x.pos[0], v]), 0.05)),
        h("label", {}, "Drehung °"), h("div", { class: "zwei" }, num(x.rot_grad ?? 0, (v) => setze("rot_grad", ((v % 360) + 360) % 360), 15),
          h("span", {}, h("button", { class: "klein", onclick: () => this.drehen(-90) }, "⟲"), h("button", { class: "klein", onclick: () => this.drehen(90) }, "⟳"))),
        h("label", {}, "Höhe Unterkante"), num(x.z ?? 0, (v) => setze("z", v), 0.05),
        h("label", {}, "Farbe"), h("div", { class: "zwei" }, h("input", { type: "color", value: x.farbe_hex ?? "#a0a0a0", onchange: (e: Event) => setze("farbe_hex", (e.target as HTMLInputElement).value) }),
          h("input", { value: x.farbe ?? "", placeholder: "Farbname", onchange: (e: Event) => setze("farbe", (e.target as HTMLInputElement).value) })),
        h("label", {}, "Material"), h("input", { value: x.material ?? "", onchange: (e: Event) => setze("material", (e.target as HTMLInputElement).value) }),
        ...(x.typ === "ecksofa" ? [h("label", {}, "Recamiere (von vorn)"), h("div", { class: "chips" },
          ...(["links", "rechts"] as const).map((seite) => h("button", { class: (recamiereLinks(x) ? "links" : "rechts") === seite ? "an" : "",
            onclick: () => setze("recamiere", seite, `${x.name}: Recamiere ${seite}`) }, seite)))] : []),
        ...(x.typ === "haengeschrank" ? [
          h("label", {}, "Front"), h("div", { class: "chips" }, ...(["glatt", "riffel"] as const).map((v) => h("button", { class: (x.front ?? "glatt") === v ? "an" : "",
            onclick: () => setze("front", v, `${x.name}: Front ${v}`) }, v === "riffel" ? "geriffelt" : "glatt"))),
          h("label", {}, "Knauf (von vorn)"), h("div", { class: "chips" }, ...(["links", "rechts", "ohne"] as const).map((v) => h("button", { class: (x.griff ?? "links") === v ? "an" : "",
            onclick: () => setze("griff", v, `${x.name}: Knauf ${v}`) }, v))),
          h("label", {}, "Türen / offen unten (m)"), h("div", { class: "zwei" },
            num(x.tueren ?? 1, (v) => setze("tueren", Math.max(1, Math.min(2, Math.round(v))), `${x.name}: Türen`), 1),
            num(x.offen_unten ?? 0, (v) => setze("offen_unten", Math.max(0, v) || undefined, `${x.name}: offenes Fach`), 0.01))] : []),
        ...(String(x.typ).startsWith("tv_board") ? [h("label", {}, "TV Zoll (0 = keiner)"), num(tvZoll(x), (v) => setze("tv_zoll", Math.max(0, Math.round(v)), `${x.name}: TV ${Math.round(v)}"`), 1)] : []),
        ...(x.licht ? [
          h("label", {}, "Licht K / lm"), h("div", { class: "zwei" },
            num(x.licht.kelvin ?? 2700, (v) => setze("licht", { ...x.licht, kelvin: Math.round(v), farbmodus: "weiss" }, `${x.name}: ${Math.round(v)} K`), 100),
            num(x.licht.lumen ?? 400, (v) => setze("licht", { ...x.licht, lumen: Math.max(0, Math.round(v)) }, `${x.name}: ${Math.round(v)} lm`), 50)),
          h("label", {}, "Lichtfarbe"), h("div", { class: "zwei" },
            h("div", { class: "chips" }, ...(["weiss", "farbe"] as const).map((v) => h("button", { class: (x.licht.farbmodus ?? "weiss") === v ? "an" : "",
              onclick: () => setze("licht", { ...x.licht, farbmodus: v, ...(v === "farbe" && !x.licht.farbe_licht ? { farbe_licht: "#ff8a3d" } : {}) }, `${x.name}: Licht ${v}`) }, v === "weiss" ? "weiß" : "Farbe"))),
            x.licht.farbmodus === "farbe" ? h("input", { type: "color", value: x.licht.farbe_licht ?? "#ff8a3d",
              onchange: (e: Event) => setze("licht", { ...x.licht, farbmodus: "farbe", farbe_licht: (e.target as HTMLInputElement).value }, `${x.name}: Lichtfarbe`) }) : h("span", {})),
          ...(x.typ === "wandspot" ? [h("label", {}, "Neigung °"), num(x.licht.winkel_grad ?? 45, (v) => setze("licht", { ...x.licht, winkel_grad: Math.max(0, Math.min(180, v)) }, `${x.name}: Neigung`), 5)] : []),
          ...(x.licht.abstrahlwinkel !== undefined || /spot|leuchte_updown|schwenkarm|bilder/.test(x.typ) ? [h("label", {}, "Kegel °"), num(x.licht.abstrahlwinkel ?? 36, (v) => setze("licht", { ...x.licht, abstrahlwinkel: Math.max(10, Math.min(120, v)) }, `${x.name}: Kegel`), 5)] : []),
        ] : []),
        h("label", {}, "Preis €"), num(x.preis_eur ?? 0, (v) => setze("preis_eur", v || undefined), 1),
        h("label", {}, "Link"), h("input", { value: x.link ?? "", placeholder: "https://…", onchange: (e: Event) => setze("link", (e.target as HTMLInputElement).value) }),
        h("label", {}, "Notiz"), h("input", { value: x.notiz ?? "", onchange: (e: Event) => setze("notiz", (e.target as HTMLInputElement).value) })),
      h("div", { class: "dezent" }, `${this.modell.raeume.find((r: any) => r.id === x.raum)?.name ?? x.raum ?? ""} · ${x.geschoss}${x.quelle ? " · Quelle: " + x.quelle : ""}`),
      ...warn.map((w) => h("div", { class: "hinweis" }, w.text)),
      h("div", { class: "zeile" },
        h("button", { onclick: () => { this.tab = "katalog"; this.tauschModus = true; this.seiteNeu(); } }, "⇄ Tauschen"),
        h("button", { onclick: () => this.duplizieren() }, "Duplizieren"),
        x.link ? h("a", { href: x.link, target: "_blank", rel: "noopener", class: "knopf" }, "Shop ↗") : null,
        h("button", { class: "warn", onclick: () => this.loeschen() }, "Löschen")),
    );
  }

  private bauteilEigenschaften(p: HTMLElement, f: any) {
    const b = this.bauteil!;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const num = (wert: number, fn: (v: number) => void, step = 0.01) =>
      h("input", { type: "number", step, value: r3(wert), onchange: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value.replace(",", ".")); if (!isNaN(v)) fn(v); } });
    const setze = (fn: (g: any) => void, notiz: string) =>
      this.aendern((m) => fn(bauteilFinden(m, b)), "haus", notiz);
    const felder: (HTMLElement | string)[] = [];
    if (b.art === "fest") {
      if (Array.isArray(f.rechteck)) {
        const [[x0, y0], [x1, y1]] = f.rechteck;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = Math.abs(x1 - x0), bt = Math.abs(y1 - y0);
        const rechteck = (ncx: number, ncy: number, nb: number, nt: number) => setze((g) => {
          g.rechteck = [[r3(ncx - nb / 2), r3(ncy - nt / 2)], [r3(ncx + nb / 2), r3(ncy + nt / 2)]];
        }, `${f.id} Maße`);
        felder.push(
          h("label", {}, "Breite x / Tiefe y"), h("div", { class: "zwei" }, num(bw, (v) => rechteck(cx, cy, Math.max(0.02, v), bt)), num(bt, (v) => rechteck(cx, cy, bw, Math.max(0.02, v)))),
          h("label", {}, "Mitte x / y"), h("div", { class: "zwei" }, num(cx, (v) => this.aendern((m) => bauteilVerschieben(m, b, v - cx, 0), "haus", `${f.id} verschoben`), 0.05),
            num(cy, (v) => this.aendern((m) => bauteilVerschieben(m, b, 0, v - cy), "haus", `${f.id} verschoben`), 0.05)),
        );
        if (f.hoehe !== undefined || !f.glaswand) felder.push(h("label", {}, "Höhe"), num(f.hoehe ?? 0.9, (v) => setze((g) => (g.hoehe = v), `${f.id} Höhe`)));
        if (!f.glaswand) felder.push(h("label", {}, "Drehen"), h("span", {}, h("button", { class: "klein", onclick: () => rechteck(cx, cy, bt, bw) }, "⟳ 90°")));
      } else if (Array.isArray(f.pos)) {
        felder.push(h("label", {}, "Position x / y"), h("div", { class: "zwei" },
          num(f.pos[0], (v) => this.aendern((m) => bauteilVerschieben(m, b, v - f.pos[0], 0), "haus", `${f.id} verschoben`), 0.05),
          num(f.pos[1], (v) => this.aendern((m) => bauteilVerschieben(m, b, 0, v - f.pos[1]), "haus", `${f.id} verschoben`), 0.05)));
      }
      if (String(f.typ).startsWith("gelaender")) {
        felder.push(h("label", {}, "Höhe Handlauf"), num(f.hoehe ?? 0.9, (v) => setze((g) => (g.hoehe = v), `${f.id} Höhe`)),
          h("label", {}, "Relingstäbe"), num(f.staebe ?? 4, (v) => setze((g) => (g.staebe = Math.max(0, Math.round(v))), `${f.id} Stäbe`), 1),
          h("label", {}, "Pfosten"), num(f.pfosten ?? 0, (v) => setze((g) => { if (v >= 2) g.pfosten = Math.round(v); else delete g.pfosten; }, `${f.id} Pfosten`), 1));
      }
    } else if (b.art === "wand") {
      // Lamellenwand: Anzahl, Breite, Tiefe, Abstand → Länge ab Wandanfang (Ende wird nachgezogen)
      const laenge0 = Math.hypot(f.bis[0] - f.von[0], f.bis[1] - f.von[1]) || 1;
      const lm = lamellenMasse(f, laenge0);
      const lam = (neu: Record<string, number>, notiz: string) => setze((g) => {
        const L0 = Math.hypot(g.bis[0] - g.von[0], g.bis[1] - g.von[1]) || 1;
        const ux = (g.bis[0] - g.von[0]) / L0, uy = (g.bis[1] - g.von[1]) / L0;
        const alt = lamellenMasse(g, L0);
        // beim ersten Parametrieren die bisherige Lage der ersten Lamelle beibehalten
        const r4 = (v: number) => Math.round(v * 10000) / 10000;
        if (!g.lamellen?.anzahl && alt.start) g.von = [r4(g.von[0] + ux * alt.start), r4(g.von[1] + uy * alt.start)];
        const p = { anzahl: alt.n, breite: alt.b, tiefe: alt.t, abstand: alt.a, ...neu };
        p.anzahl = Math.max(1, Math.round(p.anzahl));
        g.lamellen = { anzahl: p.anzahl, breite: r3(p.breite), tiefe: r3(p.tiefe), abstand: r3(p.abstand) };
        const L = p.anzahl * p.breite + (p.anzahl - 1) * p.abstand;
        g.bis = [r4(g.von[0] + ux * L), r4(g.von[1] + uy * L)];
        g.dicke = r3(p.tiefe);
      }, `${f.id}: ${notiz}`);
      const cm = (v: number) => Math.round(v * 1000) / 10;
      felder.push(
        h("label", {}, "Anzahl Lamellen"), num(lm.n, (v) => lam({ anzahl: Math.max(1, v) }, `Anzahl ${Math.round(v)}`), 1),
        h("label", {}, "Breite / Tiefe (cm)"), h("div", { class: "zwei" },
          num(cm(lm.b), (v) => lam({ breite: Math.max(0.5, v) / 100 }, `Breite ${v} cm`), 0.5),
          num(cm(lm.t), (v) => lam({ tiefe: Math.max(0.5, v) / 100 }, `Tiefe ${v} cm`), 0.5)),
        h("label", {}, "Abstand (cm, licht)"), num(cm(lm.a), (v) => lam({ abstand: Math.max(0, v) / 100 }, `Abstand ${v} cm`), 0.5),
        h("label", {}, "Länge gesamt (m)"), num(lm.laenge, (v) => lam({ abstand: lm.n > 1 ? Math.max(0, (v - lm.n * lm.b) / (lm.n - 1)) : 0 }, `Länge ${v} m`), 0.01),
        h("label", {}, "Höhe (m)"), num(f.hoehe ?? 2.68, (v) => setze((g) => (g.hoehe = Math.max(0.1, v)), `${f.id}: Höhe`), 0.05),
        h("label", {}, "Anfang x / y"), h("div", { class: "zwei" },
          num(f.von[0], (v) => this.aendern((m) => bauteilVerschieben(m, b, v - f.von[0], 0), "haus", `${f.id} verschoben`), 0.05),
          num(f.von[1], (v) => this.aendern((m) => bauteilVerschieben(m, b, 0, v - f.von[1]), "haus", `${f.id} verschoben`), 0.05)),
        h("label", {}, "Farbe"), h("input", { type: "color", value: f.farbe_hex ?? "#a07a4b", onchange: (e: Event) => setze((g) => (g.farbe_hex = (e.target as HTMLInputElement).value), `${f.id}: Farbe`) }),
        h("div", { class: "dezent", style: "grid-column: 1 / -1" }, `Länge = Anzahl × Breite + (Anzahl − 1) × Abstand = ${lm.laenge.toFixed(3).replace(".", ",")} m. Die Wand wächst/schrumpft ab dem Anfang; „Länge“ ändern verteilt den Abstand neu.`),
      );
    } else {
      const quer = !!f.x;
      const ber = f.x ?? f.y;
      felder.push(
        h("label", {}, "Farbe"), h("div", { class: "zwei" }, h("input", { type: "color", value: f.farbe_hex ?? "#bdb7ad", onchange: (e: Event) => setze((g) => { g.farbe_hex = (e.target as HTMLInputElement).value; g.farbe = g.farbe_hex; }, `${f.id} Farbe`) }),
          h("input", { value: f.material ?? "", onchange: (e: Event) => setze((g) => (g.material = (e.target as HTMLInputElement).value), `${f.id} Material`) })),
      );
      if (ber) felder.push(h("label", {}, `Bereich ${quer ? "x" : "y"} von / bis`), h("div", { class: "zwei" },
        num(ber[0], (v) => setze((g) => (g[quer ? "x" : "y"] = [v, ber[1]]), `${f.id} Bereich`), 0.05),
        num(ber[1], (v) => setze((g) => (g[quer ? "x" : "y"] = [ber[0], v]), `${f.id} Bereich`), 0.05)));
      if (f.z) felder.push(h("label", {}, "Höhe von / bis"), h("div", { class: "zwei" },
        num(f.z[0], (v) => setze((g) => (g.z = [v, f.z[1]]), `${f.id} Höhe`), 0.05),
        num(f.z[1], (v) => setze((g) => (g.z = [f.z[0], v]), `${f.id} Höhe`), 0.05)));
      const einbauten = (this.modell.feste_elemente ?? []).filter((e: any) => e.rechteck || e.pos).map((e: any) => e.id);
      felder.push(h("label", {}, "Wandert mit"), h("select", { onchange: (e: Event) => setze((g) => { const v = (e.target as HTMLSelectElement).value; if (v) g.gehoert_zu = v; else delete g.gehoert_zu; }, `${f.id} gehört zu`) },
        h("option", { value: "" }, "–"), ...einbauten.map((id: string) => h("option", { value: id, selected: f.gehoert_zu === id }, id))));
    }
    const titel = b.art === "fest" ? (f.name ?? f.id) : b.art === "wand" ? (f.name ?? "Lamellenwand") : `${f.material ?? "Fläche"} · ${f.wand ?? ""} ${f.seite ?? ""}`;
    p.append(
      h("div", { class: "kopf" }, h("strong", { class: "titel" }, titel), h("button", { class: "x", onclick: () => this.bauteilWaehlen(null) }, "×")),
      h("div", { class: "dezent" }, `${b.art === "fest" ? "Einbau" : b.art === "wand" ? "Wand" : "Wand-Teilfläche"} · ${f.id}${f.typ ? " · " + f.typ : ""}`),
      h("div", { class: "raster2" }, ...felder),
      h("div", { class: "dezent" }, [f.hinweis, f.quelle ? `Quelle: ${f.quelle}` : ""].filter(Boolean).join(" · ")),
      h("p", { class: "dezent" }, b.art !== "flaeche" ? "Im Plan oder in 3D ziehen (5-cm-Raster, Alt = 1 cm), Pfeiltasten schieben." : "Im Plan oder in 3D entlang der Wand ziehen."),
      h("div", { class: "zeile" }, h("button", { class: "warn", onclick: () => {
        if (!confirm(`${titel} aus dem Modell entfernen?`)) return;
        this.aendern((m) => {
          if (b.art === "fest") m.feste_elemente = m.feste_elemente.filter((e: any) => e.id !== b.id);
          else if (b.art === "wand") m.waende = m.waende.filter((e: any) => e.id !== b.id);
          else m.oberflaechen.flaechen = m.oberflaechen.flaechen.filter((e: any) => e.id !== b.id);
        }, "haus", `${b.id} entfernt`);
        this.bauteilWaehlen(null);
      } }, "Entfernen")),
    );
  }
}

const app = new App();
(window as any).planer = app;
app.start().catch((e) => {
  console.error(e);
  toast(`Start fehlgeschlagen: ${e.message}`, "fehler");
});
