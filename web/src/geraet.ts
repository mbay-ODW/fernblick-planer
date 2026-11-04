// Gerätemerkmale: Touch-Geräte (iPhone/iPad/Android) bekommen ein sparsameres Grafikprofil
export const MOBIL =
  (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches) ||
  /iPhone|iPad|iPod|Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
export const SCHMAL = typeof matchMedia !== "undefined" && matchMedia("(max-width: 900px)").matches;
