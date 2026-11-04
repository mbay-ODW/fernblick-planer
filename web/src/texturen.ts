// Prozedurale Graustufen-Texturen (werden mit der Materialfarbe multipliziert)
import * as THREE from "three";

function leinwand(n: number, zeichnen: (c: CanvasRenderingContext2D, n: number) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const c = cv.getContext("2d")!;
  zeichnen(c, n);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rauschen(c: CanvasRenderingContext2D, n: number, staerke: number, basis = 235) {
  const img = c.getImageData(0, 0, n, n);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * staerke;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + v));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + v));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + v));
  }
  c.putImageData(img, 0, 0);
  void basis;
}

const cache = new Map<string, THREE.Texture>();

/** Dielen-Kachel: 4 Dielen nebeneinander, 2 Reihen versetzt → Kachel = 4·breite × 2·laenge (m) */
export function dielenTextur(breite: number, laenge: number): THREE.CanvasTexture {
  const n = 1024;
  return leinwand(n, (c) => {
    const bw = n / 4, bl = n / 2;
    for (let s = 0; s < 4; s++) {
      const versatz = ((s * 0.37) % 1) * bl;
      for (let r = -1; r < 3; r++) {
        const y = r * bl + versatz;
        const g = 212 + ((s * 7 + r * 13) % 5) * 8;
        c.fillStyle = `rgb(${g},${g * 0.97},${g * 0.93})`;
        c.fillRect(s * bw, y, bw, bl);
        for (let i = 0; i < 16; i++) {
          const x0 = s * bw + ((i * 37 + s * 11 + r * 5) % 97) / 97 * bw;
          c.strokeStyle = `rgba(90,65,40,${0.05 + ((i * 7) % 10) / 100})`;
          c.lineWidth = 0.8 + (i % 3) * 0.6;
          c.beginPath();
          for (let yy = y; yy <= y + bl; yy += 12) c.lineTo(x0 + Math.sin(yy * 0.012 + i + s) * 3, yy);
          c.stroke();
        }
        c.fillStyle = "rgba(55,38,24,0.4)";
        c.fillRect(s * bw, y, bw, 2);
      }
      c.fillStyle = "rgba(55,38,24,0.35)";
      c.fillRect(s * bw, 0, 2, n);
    }
    rauschen(c, n, 8);
    void breite; void laenge;
  });
}
function gemerkt(k: string, f: () => THREE.Texture) {
  if (!cache.has(k)) cache.set(k, f());
  return cache.get(k)!;
}

export const tex = {
  holz: () =>
    gemerkt("holz", () =>
      leinwand(512, (c, n) => {
        c.fillStyle = "#ececec";
        c.fillRect(0, 0, n, n);
        for (let i = 0; i < 90; i++) {
          const y0 = Math.random() * n;
          const a = 2 + Math.random() * 6;
          const f = 0.004 + Math.random() * 0.01;
          c.strokeStyle = `rgba(90,70,50,${0.05 + Math.random() * 0.12})`;
          c.lineWidth = 0.6 + Math.random() * 2.2;
          c.beginPath();
          for (let x = 0; x <= n; x += 8) c.lineTo(x, y0 + Math.sin(x * f + i) * a);
          c.stroke();
        }
        rauschen(c, n, 10);
      }),
    ),
  parkett: () =>
    gemerkt("parkett", () =>
      leinwand(1024, (c, n) => {
        // 1 Kachel = 1 m: Dielen 0,2 m breit, versetzte Stöße
        const breite = n / 5;
        for (let s = 0; s < 5; s++) {
          let y = -Math.random() * n;
          while (y < n) {
            const l = n * (0.6 + Math.random() * 0.8);
            const g = 215 + Math.random() * 30;
            c.fillStyle = `rgb(${g},${g * 0.97},${g * 0.93})`;
            c.fillRect(s * breite, y, breite, l);
            for (let i = 0; i < 14; i++) {
              const x0 = s * breite + Math.random() * breite;
              c.strokeStyle = `rgba(90,65,40,${0.05 + Math.random() * 0.1})`;
              c.lineWidth = 0.8 + Math.random() * 1.6;
              c.beginPath();
              for (let yy = y; yy <= y + l; yy += 10) c.lineTo(x0 + Math.sin(yy * 0.01 + i) * 3, yy);
              c.stroke();
            }
            c.fillStyle = "rgba(60,40,25,0.35)";
            c.fillRect(s * breite, y, breite, 2);
            y += l;
          }
          c.fillStyle = "rgba(60,40,25,0.3)";
          c.fillRect(s * breite, 0, 2, n);
        }
        rauschen(c, n, 8);
      }),
    ),
  stoff: () =>
    gemerkt("stoff", () =>
      leinwand(256, (c, n) => {
        c.fillStyle = "#e6e6e6";
        c.fillRect(0, 0, n, n);
        for (let i = 0; i < n; i += 2) {
          c.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.03})`;
          c.fillRect(0, i, n, 1);
          c.fillRect(i, 0, 1, n);
        }
        rauschen(c, n, 22);
      }),
    ),
  putz: () =>
    gemerkt("putz", () =>
      leinwand(512, (c, n) => {
        c.fillStyle = "#f2f2f2";
        c.fillRect(0, 0, n, n);
        rauschen(c, n, 9);
      }),
    ),
  beton: () =>
    gemerkt("beton", () =>
      leinwand(512, (c, n) => {
        c.fillStyle = "#dedede";
        c.fillRect(0, 0, n, n);
        for (let i = 0; i < 400; i++) {
          c.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
          const r = Math.random() * 18;
          c.beginPath();
          c.arc(Math.random() * n, Math.random() * n, r, 0, 7);
          c.fill();
        }
        rauschen(c, n, 16);
      }),
    ),
  schalung: () =>
    gemerkt("schalung", () =>
      leinwand(512, (c, n) => {
        // senkrechte Boden-Deckel-/Rhombusschalung, 8 Bretter je Meter
        const b = n / 8;
        for (let i = 0; i < 8; i++) {
          const g = 200 + ((i * 29) % 5) * 9;
          c.fillStyle = `rgb(${g},${g},${g})`;
          c.fillRect(i * b, 0, b, n);
          for (let k = 0; k < 10; k++) {
            const x0 = i * b + ((k * 31 + i * 17) % 50) / 50 * b;
            c.strokeStyle = `rgba(40,30,20,${0.05 + (k % 4) * 0.03})`;
            c.lineWidth = 0.7 + (k % 3) * 0.5;
            c.beginPath();
            for (let y = 0; y <= n; y += 8) c.lineTo(x0 + Math.sin(y * 0.02 + k + i) * 1.5, y);
            c.stroke();
          }
          c.fillStyle = "rgba(20,14,8,0.55)";
          c.fillRect(i * b, 0, 3, n);
        }
        rauschen(c, n, 10);
      }),
    ),
  gras: () =>
    gemerkt("gras", () =>
      leinwand(512, (c, n) => {
        c.fillStyle = "#c8c8c8";
        c.fillRect(0, 0, n, n);
        for (let i = 0; i < 6000; i++) {
          const g = 150 + Math.random() * 100;
          c.fillStyle = `rgba(${g},${g},${g},0.5)`;
          c.fillRect(Math.random() * n, Math.random() * n, 1, 3 + Math.random() * 4);
        }
      }),
    ),
  fliese: () =>
    gemerkt("fliese", () =>
      leinwand(512, (c, n) => {
        c.fillStyle = "#e8e8e8";
        c.fillRect(0, 0, n, n);
        rauschen(c, n, 12);
        c.fillStyle = "rgba(0,0,0,0.18)";
        // 1 m Kachel, Fliesen 0,6 × 0,3
        for (let x = 0; x <= n; x += n / 1.6667) c.fillRect(x, 0, 2, n);
        for (let y = 0; y <= n; y += n / 3.333) c.fillRect(0, y, n, 2);
      }),
    ),
};
