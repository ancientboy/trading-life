export type ScarfPalette = {
  wrap: [string, string];
  tail: [string, string];
};

/** NPC 默认：参考图绿红 + 蓝红 */
export const DEFAULT_SCARF: ScarfPalette = {
  wrap: ['#3d9e46', '#d94c4c'],
  tail: ['#4285f4', '#d94c4c'],
};

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padStart(6, '0');
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const t = (n: number) => {
    let x = n;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [t(hk + 1 / 3) * 255, t(hk) * 255, t(hk - 1 / 3) * 255];
}

function hslHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return toHex(r, g, b);
}

/** 由 Agent 主题色生成双色条纹围巾 */
export function scarfColorsFromAccent(accent: string): ScarfPalette {
  const [r, g, b] = parseHex(accent);
  const [h, s, l] = rgbToHsl(r, g, b);
  const primary = accent.startsWith('#') ? accent : toHex(r, g, b);
  const secondary = hslHex(h, Math.min(1, s * 0.9 + 0.05), Math.max(0.18, l * 0.52));
  const tailPrimary = hslHex(h + 38, Math.min(1, s * 0.85), Math.min(0.72, l * 1.05 + 0.08));
  return {
    wrap: [primary, secondary],
    tail: [tailPrimary, secondary],
  };
}

export function scarfPaletteForCharacter(accent: string, isNpc: boolean): ScarfPalette {
  return isNpc ? DEFAULT_SCARF : scarfColorsFromAccent(accent);
}
