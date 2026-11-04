// Verschieben von festen Einbauten und Wand-Teilflächen (gemeinsam für Plan und 3D)
import type { Bauteil } from "./szene";

const r = (v: number) => Math.round(v * 1000) / 1000;
const PUNKTLISTEN = ["rechteck", "vorwand", "glaswand", "punkte", "parkbereich", "oeffnung"];

export function bauteilFinden(m: any, b: Bauteil | null): any {
  if (!b) return null;
  if (b.art === "fest") return (m.feste_elemente ?? []).find((f: any) => f.id === b.id) ?? null;
  if (b.art === "wand") return (m.waende ?? []).find((f: any) => f.id === b.id) ?? null;
  return (m.oberflaechen?.flaechen ?? []).find((f: any) => f.id === b.id) ?? null;
}

export function festVerschieben(f: any, orig: any, dx: number, dy: number) {
  for (const k of PUNKTLISTEN) if (Array.isArray(orig[k])) f[k] = orig[k].map(([x, y]: number[]) => [r(x + dx), r(y + dy)]);
  if (Array.isArray(orig.pos)) f.pos = [r(orig.pos[0] + dx), r(orig.pos[1] + dy)];
}

export function flaecheVerschieben(f: any, orig: any, dx: number, dy: number) {
  if (Array.isArray(orig.x)) f.x = orig.x.map((v: number) => r(v + dx));
  if (Array.isArray(orig.y)) f.y = orig.y.map((v: number) => r(v + dy));
}

/** Verschiebt ein Bauteil; Teilflächen mit gehoert_zu = Einbau-ID wandern mit (entlang ihrer Wand). */
export function bauteilVerschieben(m: any, b: Bauteil, dx: number, dy: number, orig?: any, origMit?: Map<string, any>) {
  const f = bauteilFinden(m, b);
  if (!f) return;
  if (b.art === "flaeche") return flaecheVerschieben(f, orig ?? structuredClone(f), dx, dy);
  if (b.art === "wand") {
    const o = orig ?? structuredClone(f);
    f.von = [r(o.von[0] + dx), r(o.von[1] + dy)];
    f.bis = [r(o.bis[0] + dx), r(o.bis[1] + dy)];
    return;
  }
  festVerschieben(f, orig ?? structuredClone(f), dx, dy);
  for (const fl of m.oberflaechen?.flaechen ?? []) {
    if (fl.gehoert_zu !== b.id) continue;
    const o = origMit?.get(fl.id) ?? structuredClone(fl);
    flaecheVerschieben(fl, o, dx, dy);
  }
}

export function mitlaeuferKopie(m: any, b: Bauteil): Map<string, any> {
  const out = new Map<string, any>();
  for (const fl of m.oberflaechen?.flaechen ?? []) if (b.art === "fest" && fl.gehoert_zu === b.id) out.set(fl.id, structuredClone(fl));
  return out;
}
