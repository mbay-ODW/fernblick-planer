// REST-Zugriff auf das Planer-Backend (gleiche Origin, Authelia-Session per Cookie)

export class KonfliktFehler extends Error {
  constructor(public aktuell: number) {
    super(`Modell wurde inzwischen geändert (Version ${aktuell})`);
  }
}

async function antwort(r: Response): Promise<any> {
  if (r.status === 409) {
    const d = await r.json().catch(() => ({}));
    throw new KonfliktFehler(d.aktuell ?? 0);
  }
  if (r.status === 401) {
    location.reload();
    throw new Error("Nicht angemeldet");
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.detail ?? `${r.status} ${r.statusText}`);
  }
  return r.json();
}

/** Freigabe-Link (/teilen/<id>/): Nur-Lese-Ansicht, Daten kommen über die Freigabe-Endpunkte */
export const TEILEN: string | null = location.pathname.match(/^\/teilen\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
const T = TEILEN ? `/teilen/${TEILEN}` : "";
/** Pfad-Präfix für Lesezugriffe (leer oder /teilen/<id>) */
export const BASIS = T;

export const api = {
  ich: () => (TEILEN ? Promise.resolve({ benutzer: "" }) : fetch("/api/ich").then(antwort)),
  modell: () => fetch(`${T}/api/modell`).then(antwort),
  version: () => fetch(`${T}/api/modell/version`).then(antwort),
  speichern: (modell: any, basis_version: number | null, notiz = "") =>
    fetch("/api/modell", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modell, basis_version, notiz }),
    }).then(antwort),
  versionen: () => fetch("/api/versionen").then(antwort),
  versionLesen: (n: number) => fetch(`/api/versionen/${n}`).then(antwort),
  varianten: () => fetch("/api/varianten").then(antwort),
  varianteSpeichern: (name: string, notiz: string, modell: any) =>
    fetch("/api/varianten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notiz, modell }),
    }).then(antwort),
  varianteLesen: (slug: string) => fetch(`/api/varianten/${encodeURIComponent(slug)}`).then(antwort),
  varianteLoeschen: (slug: string) =>
    fetch(`/api/varianten/${encodeURIComponent(slug)}`, { method: "DELETE" }).then(antwort),
  bilder: (art?: string) => fetch("/api/bilder" + (art ? `?art=${art}` : "")).then(antwort),
  bildHochladen: (blob: Blob, titel: string, art: string, modus: string, kamera: any) => {
    const f = new FormData();
    f.append("datei", blob, blob.type === "image/jpeg" ? "bild.jpg" : "bild.png");
    f.append("titel", titel);
    f.append("art", art);
    f.append("modus", modus);
    f.append("kamera", JSON.stringify(kamera ?? {}));
    return fetch("/api/bilder", { method: "POST", body: f }).then(antwort);
  },
  bildAendern: (id: string, felder: any) =>
    fetch(`/api/bilder/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(felder),
    }).then(antwort),
  bildLoeschen: (id: string) => fetch(`/api/bilder/${id}`, { method: "DELETE" }).then(antwort),
  bildUrl: (id: string, download = false) => `/api/bilder/${id}${download ? "?download=true" : ""}`,
  renderStarten: (glb: ArrayBuffer, params: any) => {
    const f = new FormData();
    f.append("szene", new Blob([glb], { type: "model/gltf-binary" }), "szene.glb");
    f.append("params", JSON.stringify(params));
    return fetch("/api/render", { method: "POST", body: f }).then(antwort);
  },
  renderListe: () => fetch("/api/render").then(antwort),
  renderAbbrechen: (id: string) => fetch(`/api/render/${id}`, { method: "DELETE" }).then(antwort),
  spielwelt: () => fetch("/api/spielwelt").then(antwort),
  spielweltUebergeben: (glb: ArrayBuffer, welt: any) => {
    const f = new FormData();
    f.append("haus", new Blob([glb], { type: "model/gltf-binary" }), "haus.glb");
    f.append("welt", JSON.stringify(welt));
    return fetch("/api/spielwelt", { method: "POST", body: f }).then(antwort);
  },
  panoramaHochladen: (datei: Blob) => {
    const f = new FormData();
    f.append("datei", datei, "panorama.jpg");
    return fetch("/api/umgebung/panorama", { method: "POST", body: f }).then(antwort);
  },
  freigaben: () => fetch("/api/freigaben").then(antwort),
  freigabeNeu: (d: any) =>
    fetch("/api/freigaben", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(antwort),
  freigabeAendern: (id: string, d: any) =>
    fetch(`/api/freigaben/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(antwort),
  freigabeLoeschen: (id: string) => fetch(`/api/freigaben/${id}`, { method: "DELETE" }).then(antwort),
};
