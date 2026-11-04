// Kleine DOM-Helfer
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attr: Record<string, any> = {},
  ...kinder: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k in e && typeof v !== "string") (e as any)[k] = v;
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kinder) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export function leeren(e: Element) {
  while (e.firstChild) e.removeChild(e.firstChild);
}

let toastZeit = 0;
export function toast(text: string, art: "ok" | "fehler" | "info" = "info") {
  const t = document.getElementById("toast")!;
  t.textContent = text;
  t.className = `zeigen ${art}`;
  window.clearTimeout(toastZeit);
  toastZeit = window.setTimeout(() => (t.className = ""), art === "fehler" ? 7000 : 3200);
}

export function zahl(v: any, d = 2): string {
  return Number(v).toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function zeitText(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function frage(text: string, vorgabe = ""): string | null {
  const a = window.prompt(text, vorgabe);
  return a === null ? null : a.trim();
}
