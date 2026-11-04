// Rendering-Ansicht: Live-Ansicht links (three.js), Cycles-Renderings rechts, Aufträge und Bildergalerie
import * as THREE from "three";
import { api } from "./api";
import { h, leeren, toast, zeitText } from "./dom";

const QUALITAET: Record<string, { name: string; kante: number; samples: number; info: string }> = {
  vorschau: { name: "Vorschau", kante: 1280, samples: 48, info: "ca. 2–5 min" },
  standard: { name: "Standard", kante: 1920, samples: 128, info: "ca. 8–20 min" },
  hoch: { name: "Hoch", kante: 2560, samples: 320, info: "ca. 30–60 min" },
};
const FORMATE: Record<string, number> = { "16:9": 16 / 9, "3:2": 3 / 2, "4:5 (Instagram)": 4 / 5, "9:16 (Story)": 9 / 16, "1:1": 1 };

export class RenderAnsicht {
  private einst = { titel: "", qualitaet: "vorschau", format: "16:9", ansicht: "" };
  private auftraege: any[] = [];
  private bilder: any[] = [];
  private filter = "rendering";
  private gezeigt: any = null;
  private timer = 0;
  private rahmen: HTMLElement;
  private sichtbar = false;
  private kopf!: HTMLElement;
  private betrachter!: HTMLElement;
  private liste!: HTMLElement;
  private galerie!: HTMLElement;

  constructor(private wurzel: HTMLElement, private app: any) {
    this.rahmen = h("div", { id: "formatRahmen" });
    document.getElementById("ansicht3d")!.append(this.rahmen);
    this.aufbauen();
    new ResizeObserver(() => this.rahmenSetzen()).observe(document.getElementById("ansicht3d")!);
  }

  private aufbauen() {
    leeren(this.wurzel);
    this.kopf = h("div", { class: "renderKopf" });
    this.betrachter = h("div", { class: "betrachter" }, h("div", { class: "leer" }, "Noch kein Rendering ausgewählt. Links die Ansicht einrichten und „In Cycles rendern“ klicken."));
    this.liste = h("div", { class: "auftraege" });
    this.galerie = h("div", { class: "galerie" });
    this.wurzel.append(this.kopf, this.betrachter, this.liste, this.galerie);
    this.kopfNeu();
  }

  private kopfNeu() {
    leeren(this.kopf);
    const e = this.einst;
    const ansichten = this.app.modell?.ansichten ?? [];
    this.kopf.append(
      h("input", { placeholder: "Titel (optional)", value: e.titel, oninput: (ev: Event) => (e.titel = (ev.target as HTMLInputElement).value) }),
      h("select", { title: "Kamera", onchange: (ev: Event) => { e.ansicht = (ev.target as HTMLSelectElement).value; const a = ansichten.find((x: any) => x.id === e.ansicht); if (a) this.app.ansichtZeigen(a); } },
        h("option", { value: "" }, "Kamera: aktuelle Live-Ansicht"),
        ...ansichten.map((a: any) => h("option", { value: a.id, selected: a.id === e.ansicht }, `Ansicht: ${a.name}`))),
      h("select", { title: "Qualität", onchange: (ev: Event) => (e.qualitaet = (ev.target as HTMLSelectElement).value) },
        ...Object.entries(QUALITAET).map(([k, q]) => h("option", { value: k, selected: k === e.qualitaet }, `${q.name} (${q.info})`))),
      h("select", { title: "Format", onchange: (ev: Event) => { e.format = (ev.target as HTMLSelectElement).value; this.rahmenSetzen(); } },
        ...Object.keys(FORMATE).map((k) => h("option", { value: k, selected: k === e.format }, k))),
      h("button", { class: "haupt", onclick: () => this.starten() }, "In Cycles rendern"),
    );
  }

  zeigen() {
    this.sichtbar = true;
    this.kopfNeu();
    this.rahmen.hidden = false;
    this.rahmenSetzen();
    this.listenNeu();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.listenNeu(), 3000);
  }

  verstecken() {
    this.sichtbar = false;
    this.rahmen.hidden = true;
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.listenNeu(true), 15000);
  }

  kameraGeaendert() {
    /* Kamera bewegt: Auswahl „gespeicherte Ansicht“ gilt nicht mehr */
    if (this.sichtbar && this.einst.ansicht) {
      this.einst.ansicht = "";
      this.kopfNeu();
    }
  }

  private seitenverhaeltnis() {
    return FORMATE[this.einst.format] ?? 16 / 9;
  }

  private rahmenSetzen() {
    const c = document.getElementById("ansicht3d")!;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    const ra = this.seitenverhaeltnis(), ca = W / H;
    let w = W, hh = H;
    if (ra < ca) w = H * ra;
    else hh = W / ra;
    Object.assign(this.rahmen.style, { width: `${w}px`, height: `${hh}px`, left: `${(W - w) / 2}px`, top: `${(H - hh) / 2}px` });
  }

  /** Vertikaler Öffnungswinkel für das Renderformat, so dass der Rahmen genau getroffen wird. */
  private fovFuer(ra: number): number {
    const sz = this.app.szene;
    const ca = sz.kamera.aspect, fov = (sz.kamera.fov * Math.PI) / 180;
    if (ra <= ca) return sz.kamera.fov;
    const fovH = 2 * Math.atan(Math.tan(fov / 2) * ca);
    return (2 * Math.atan(Math.tan(fovH / 2) / ra) * 180) / Math.PI;
  }

  private params(titel: string): { params: any; breite: number; hoehe: number; fovV: number } {
    const sz = this.app.szene;
    const q = QUALITAET[this.einst.qualitaet];
    const ra = this.seitenverhaeltnis();
    const breite = ra >= 1 ? q.kante : Math.round(q.kante * ra / 2) * 2;
    const hoehe = ra >= 1 ? Math.round(q.kante / ra / 2) * 2 : q.kante;
    const k = sz.kameraDaten();
    const nachModell = (v: number[]) => [v[0], v[2], v[1]];
    const fovV = this.fovFuer(ra);
    const e = this.app.modell.einstellungen ?? {};
    const st = sz.licht.stand;
    const leuchten: any[] = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    for (const { eintrag, dimm } of sz.aktiveLeuchten()) {
      for (const l of eintrag.lichter) {
        if (l.userData.reflex) continue; // Reflexionshilfe nur für die Live-Ansicht, Cycles rechnet echte Reflexion
        l.getWorldPosition(p);
        const anteil = l.userData.anteil ?? 1;
        const d: any = { id: eintrag.id, pos: [p.x, p.z, p.y], lumen: eintrag.lumen * anteil * dimm, kelvin: eintrag.kelvin, typ: "punkt", radius: 0.05 };
        const ld = eintrag.daten?.licht ?? eintrag.daten;
        if (ld?.farbmodus === "farbe" && ld.farbe_licht) d.farbe = ld.farbe_licht;
        if ((l as THREE.SpotLight).isSpotLight) {
          const s = l as THREE.SpotLight;
          s.target.getWorldPosition(t);
          d.typ = "spot";
          d.richtung = [t.x - p.x, t.z - p.z, t.y - p.y];
          d.winkel = (s.angle * 2 * 180) / Math.PI;
          d.weich = s.penumbra;
        }
        leuchten.push(d);
      }
    }
    return {
      breite, hoehe, fovV,
      params: {
        titel, aufloesung: [breite, hoehe], samples: q.samples, qualitaet: this.einst.qualitaet,
        kamera: { pos: nachModell(k.pos), ziel: nachModell(k.ziel), fov_v: fovV, begehen: k.begehen },
        sonne: { azimut: st.azimut, hoehe: st.hoehe, richtung: st.modell }, tag_faktor: sz.licht.tagFaktor,
        datum: e.datum, uhrzeit: e.uhrzeit, szenario: e.szenario, belichtung_ev: Math.log2(e.belichtung ?? 1),
        leuchten, modell_version: this.app.modell.meta.version,
      },
    };
  }

  async starten(titelVorgabe?: string) {
    const sz = this.app.szene;
    const ansicht = (this.app.modell.ansichten ?? []).find((a: any) => a.id === this.einst.ansicht);
    const titel = titelVorgabe ?? (this.einst.titel || `${ansicht?.name ?? "Live-Ansicht"} · ${this.app.einstellungsText()}`);
    try {
      toast("Szene wird exportiert …");
      const { params, breite, hoehe, fovV } = this.params(titel);
      const fovAlt = sz.kamera.fov;
      sz.kamera.fov = fovV;
      sz.kamera.updateProjectionMatrix();
      const vorschau = await sz.bildschirmfoto(Math.round(breite / 2), Math.round(hoehe / 2));
      sz.kamera.fov = fovAlt;
      sz.kamera.updateProjectionMatrix();
      const vb = await api.bildHochladen(vorschau, `Vorschau: ${titel}`, "vorschau", "3d", params.kamera);
      params.vorschau_id = vb.id;
      const glb = await sz.exportGlb();
      const a = await api.renderStarten(glb, params);
      toast(`Rendering in der Warteschlange (${(glb.byteLength / 1e6).toFixed(1)} MB Szene)`, "ok");
      this.einst.titel = "";
      this.auftraege.unshift(a);
      this.listenNeu();
      return a;
    } catch (e) {
      toast(`Rendering konnte nicht gestartet werden: ${(e as Error).message}`, "fehler");
    }
  }

  async alleAnsichtenRendern() {
    const ansichten = this.app.modell.ansichten ?? [];
    if (!ansichten.length) return toast("Keine gespeicherten Ansichten");
    if (!confirm(`${ansichten.length} Ansichten in Qualität „${QUALITAET[this.einst.qualitaet].name}“ rendern?`)) return;
    this.app.modusSetzen("render");
    for (const a of ansichten) {
      this.app.ansichtZeigen(a);
      await new Promise((r) => setTimeout(r, 300));
      await this.starten(`${a.name} · ${this.app.einstellungsText()}`);
    }
  }

  async listenNeu(nurWennLaeuft = false) {
    if (nurWennLaeuft && !this.auftraege.some((a) => ["wartet", "laeuft"].includes(a.status))) return;
    try {
      const [auf, bil] = await Promise.all([api.renderListe(), this.sichtbar || !nurWennLaeuft ? api.bilder() : Promise.resolve(this.bilder)]);
      const vorher = new Set(this.auftraege.filter((a) => a.status === "fertig").map((a) => a.id));
      this.auftraege = auf;
      this.bilder = bil;
      const neuFertig = auf.filter((a: any) => a.status === "fertig" && !vorher.has(a.id) && vorher.size);
      for (const a of neuFertig) toast(`Rendering fertig: ${a.titel}`, "ok");
      if (this.sichtbar) {
        this.auftraegeZeichnen();
        this.galerieZeichnen();
        if (!this.gezeigt) {
          const erstes = this.bilder.find((b) => b.art === "rendering");
          if (erstes) this.zeigeBild(erstes);
        } else if (neuFertig.length) {
          const b = this.bilder.find((x) => x.id === neuFertig[0].bild_id);
          if (b) this.zeigeBild(b);
        }
      }
    } catch {
      /* später erneut */
    }
  }

  private auftraegeZeichnen() {
    leeren(this.liste);
    const offen = this.auftraege.filter((a) => ["wartet", "laeuft"].includes(a.status) || (a.status === "fehler" && Date.now() - new Date(a.zeit).getTime() < 86400000));
    for (const a of offen) {
      const pz = Math.round((a.fortschritt ?? 0) * 100);
      this.liste.append(h("div", { class: `auftrag ${a.status}` },
        h("span", { class: "name" }, a.titel || a.id),
        h("span", { class: "dezent" }, a.status === "laeuft" ? `${a.phase ?? "rendert"} · ${pz} %${a.rest_sek ? ` · noch ca. ${Math.ceil(a.rest_sek / 60)} min` : ""}` : a.status === "wartet" ? "wartet" : `Fehler: ${a.fehler ?? ""}`),
        h("div", { class: "balken" }, h("div", { style: { width: `${pz}%` } })),
        ["wartet", "laeuft"].includes(a.status) ? h("button", { class: "x", title: "Abbrechen", onclick: async () => { await api.renderAbbrechen(a.id); this.listenNeu(); } }, "×") : null));
    }
  }

  private galerieZeichnen() {
    leeren(this.galerie);
    const chips = h("div", { class: "chips" },
      ...[["rendering", "Renderings"], ["screenshot", "Screenshots"], ["", "Alle"]].map(([k, n]) =>
        h("button", { class: this.filter === k ? "an" : "", onclick: () => { this.filter = k; this.galerieZeichnen(); } }, n)));
    this.galerie.append(chips);
    const raster = h("div", { class: "kacheln" });
    for (const b of this.bilder.filter((x) => x.art !== "vorschau" && (!this.filter || x.art === this.filter))) {
      raster.append(h("figure", { class: this.gezeigt?.id === b.id ? "an" : "", onclick: () => this.zeigeBild(b) },
        h("img", { src: api.bildUrl(b.id), loading: "lazy", alt: b.titel ?? "" }),
        h("figcaption", {}, b.titel || b.id, h("small", {}, ` ${zeitText(b.zeit)}`))));
    }
    this.galerie.append(raster);
  }

  private zeigeBild(b: any) {
    this.gezeigt = b;
    leeren(this.betrachter);
    const vor = b.vorschau_id ? this.bilder.find((x) => x.id === b.vorschau_id) : null;
    const buehne = h("div", { class: "vergleich" });
    const img = h("img", { src: api.bildUrl(b.id), alt: b.titel ?? "" });
    buehne.append(img);
    if (vor) {
      const oben = h("div", { class: "oben" }, h("img", { src: api.bildUrl(vor.id) }));
      const linie = h("div", { class: "linie" });
      buehne.append(oben, linie, h("span", { class: "etikett links" }, "Live (three.js)"), h("span", { class: "etikett rechts" }, "Cycles"));
      const setze = (x: number) => {
        const r = buehne.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
        oben.style.clipPath = `inset(0 ${100 - f * 100}% 0 0)`;
        linie.style.left = `${f * 100}%`;
      };
      setze(-1e9);
      buehne.addEventListener("pointermove", (e) => setze(e.clientX));
      buehne.addEventListener("pointerleave", () => setze(-1e9));
    }
    this.betrachter.append(buehne,
      h("div", { class: "bildleiste" },
        h("input", { value: b.titel ?? "", onchange: async (e: Event) => { await api.bildAendern(b.id, { titel: (e.target as HTMLInputElement).value }); this.listenNeu(); } }),
        h("span", { class: "dezent" }, `${zeitText(b.zeit)} · ${b.wer ?? ""}${b.dauer_sek ? ` · ${Math.round(b.dauer_sek / 60)} min` : ""}${b.samples ? ` · ${b.samples} Samples` : ""}`),
        b.kamera ? h("button", { class: "klein", onclick: () => this.kameraUebernehmen(b) }, "Kamera übernehmen") : null,
        h("a", { class: "knopf", href: api.bildUrl(b.id, true) }, "Herunterladen"),
        h("button", { class: "x", title: "Löschen", onclick: async () => { if (confirm("Bild löschen?")) { await api.bildLoeschen(b.id); this.gezeigt = null; this.listenNeu(); } } }, "×")));
    this.galerieZeichnen();
  }

  private kameraUebernehmen(b: any) {
    let k = b.kamera;
    if (typeof k === "string") try { k = JSON.parse(k); } catch { return; }
    if (!k?.pos) return;
    // Renderings speichern Modellkoordinaten, Screenshots three-Koordinaten
    const istModell = b.art === "rendering";
    const zu = (v: number[]) => (istModell ? [v[0], v[2], v[1]] : v);
    this.app.szene.ansicht({ pos: zu(k.pos), ziel: zu(k.ziel), fov: k.fov_v ?? k.fov }, !!k.begehen);
    this.app.kopfLeiste();
  }
}
