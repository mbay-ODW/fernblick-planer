// Kollisions- und Plausibilitätsprüfung im Grundriss (2D, je Geschoss, mit Höhenbereich)
import { fussflaechen, istFlach } from "./moebel";
import { masse, wandInfos, WandInfo, P2 } from "./haus";

export interface Hinweis {
  ids: string[];
  text: string;
  art: "moebel" | "wand" | "einbau";
}

function sat(a: P2[], b: P2[]): number {
  // Eindringtiefe (>0 = Überlappung)
  let min = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      let nx = -(y2 - y1), ny = x2 - x1;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
      const o = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (o <= 0) return 0;
      min = Math.min(min, o);
    }
  }
  return min;
}

export function wandPoly(w: WandInfo): P2[] {
  const h = w.dicke / 2;
  return [
    [w.a[0] + w.nx * h, w.a[1] + w.ny * h],
    [w.b[0] + w.nx * h, w.b[1] + w.ny * h],
    [w.b[0] - w.nx * h, w.b[1] - w.ny * h],
    [w.a[0] - w.nx * h, w.a[1] - w.ny * h],
  ];
}

function zBereich(x: any, ogZ: number): [number, number] {
  const z0 = (x.geschoss === "OG" ? ogZ : 0) + (x.z ?? 0);
  return [z0, z0 + (x.masse_bth?.[2] ?? 0.5)];
}

export function pruefen(m: any): Hinweis[] {
  const M = masse(m);
  const waende = wandInfos(m, M);
  const out: Hinweis[] = [];
  const moebel = (m.moebel ?? []).filter((x: any) => !istFlach(x) && x.pos && x.masse_bth);
  const poly = new Map<string, P2[][]>(moebel.map((x: any) => [x.id, fussflaechen(x) as P2[][]]));
  const tiefe = (a: P2[][], b: P2[][]) => Math.max(0, ...a.flatMap((p) => b.map((q) => sat(p, q))));
  for (let i = 0; i < moebel.length; i++) {
    const a = moebel[i];
    const [a0, a1] = zBereich(a, M.ogZ);
    for (let j = i + 1; j < moebel.length; j++) {
      const b = moebel[j];
      if (a.geschoss !== b.geschoss) continue;
      // Gerät im Überbauschrank ist gewollt
      const typen = [a.typ, b.typ];
      if ((typen.includes("waschmaschinenschrank") || typen.includes("waschmaschinen_unterbau")) && typen.some((t) => t === "waschmaschine" || t === "trockner")) continue;
      const [b0, b1] = zBereich(b, M.ogZ);
      if (a1 <= b0 + 0.01 || b1 <= a0 + 0.01) continue;
      const d = tiefe(poly.get(a.id)!, poly.get(b.id)!);
      if (d > 0.015) out.push({ ids: [a.id, b.id], text: `${a.name ?? a.id} überschneidet ${b.name ?? b.id} (${Math.round(d * 100)} cm)`, art: "moebel" });
    }
    for (const w of waende) {
      if (w.geschoss !== a.geschoss || w.typ === "glasbruestung") continue;
      const wz1 = Math.max(w.oben(0), w.oben(w.laenge));
      if (a0 >= wz1 || a1 <= w.z0) continue;
      const d = tiefe(poly.get(a.id)!, [wandPoly(w)]);
      if (d > 0.02) {
        // in Öffnungen ist das ok, wenn das Möbel unter der Brüstung bleibt
        out.push({ ids: [a.id], text: `${a.name ?? a.id} steckt ${Math.round(d * 100)} cm in der Wand ${w.id}`, art: "wand" });
      }
    }
    for (const f of m.feste_elemente ?? []) {
      if (!f.rechteck || (f.geschoss ?? "EG") !== a.geschoss) continue;
      const [[x0, y0], [x1, y1]] = f.rechteck;
      const h = f.hoehe ?? 0.9;
      if (a0 >= h) continue;
      const d = tiefe(poly.get(a.id)!, [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
      if (d > 0.015) out.push({ ids: [a.id], text: `${a.name ?? a.id} überschneidet ${f.id}`, art: "einbau" });
    }
    // Dachschräge im OG: Höhe am Möbelrand
    if (a.geschoss === "OG") {
      const xs = poly.get(a.id)!.flat().map((p) => p[0]);
      const rand = Math.min(Math.min(...xs), M.W - Math.max(...xs));
      const frei = M.traufe + M.tan * Math.max(0, rand) - M.ogZ;
      if (a1 - M.ogZ > frei + 0.01) out.push({ ids: [a.id], text: `${a.name ?? a.id} ist höher als die Dachschräge an dieser Stelle (${frei.toFixed(2)} m)`, art: "wand" });
    }
  }
  return out;
}
