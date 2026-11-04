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

export const api = {
  ich: () => fetch("/api/ich").then(antwort),
  modell: () => fetch("/api/modell").then(antwort),
  version: () => fetch("/api/modell/version").then(antwort),
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
};
