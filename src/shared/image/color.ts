import type { RawImage } from "./raw";

/**
 * Same result as Jimp's `color([{ apply: "saturate" | "desaturate" | "hue" }])`, which goes through tinycolor for every
 * pixel and takes seconds for a photo. Each step rounds to integer RGB like tinycolor's `toRgb()`, and saturation and
 * lightness are truncated to 0.01 % like tinycolor's percentage parsing.
 */
export function adjustColor(image: RawImage, saturation: number, hue: number): void {
  if (saturation === 0 && hue === 0) return;
  const data = image.data;
  const hsl = new Float64Array(3);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;
    if (saturation !== 0) {
      rgbToHsl(r, g, b, hsl);
      hsl[1] = Math.min(1, Math.max(0, hsl[1]! + saturation / 100));
      [r, g, b] = hslToRgb(hsl[0]!, hsl[1]!, hsl[2]!);
    }
    if (hue !== 0) {
      rgbToHsl(r, g, b, hsl);
      const h = (hsl[0]! * 360 + hue) % 360;
      [r, g, b] = hslToRgb((h < 0 ? 360 + h : h) / 360, hsl[1]!, hsl[2]!);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

function rgbToHsl(red: number, green: number, blue: number, out: Float64Array): void {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    out[0] = 0;
    out[1] = 0;
    out[2] = l;
    return;
  }
  const d = max - min;
  out[1] = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  out[0] = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  out[2] = l;
}

const percent = (v: number) => (v >= 1 ? 1 : Math.trunc(v * 100 * 100) / 10000);

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = hue >= 1 ? 0 : hue;
  const s = percent(saturation);
  const l = percent(lightness);
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
