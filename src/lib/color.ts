/**
 * Conversões de cor e geração da paleta da interface.
 *
 * A cor escolhida pelo usuário vira um conjunto de tons derivados em OKLCH
 * (espaço perceptual: mudar só a luminosidade não muda a "cor" percebida).
 * Cada tom é ajustado até ter contraste suficiente contra a superfície da
 * ilha, então qualquer cor escolhida continua legível no modo claro e no escuro.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));

/* ───────── HEX / RGB / HSV ───────── */

export function parseHex(input: string): Rgb | null {
  let s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb) {
  const h = (x: number) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export const rgbTriple = ({ r, g, b }: Rgb) => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
}

/* ───────── OKLCH ───────── */

const toLinear = (c: number) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** OKLCH → RGB linear (sem limitar ao gamut). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (lin: number[]) => lin.every((x) => x >= -0.0001 && x <= 1.0001);

/** OKLCH → sRGB, reduzindo o croma até caber (mantém luminosidade e matiz). */
function oklchToRgb(color: Oklch): Rgb {
  let lin = oklchToLinear(color);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear({ ...color, c: lo });
  }
  const [r, g, b] = lin.map((x) => fromLinear(clamp(x)));
  return { r, g, b };
}

/* ───────── Contraste (WCAG 2) ───────── */

function luminance({ r, g, b }: Rgb) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: Rgb, b: Rgb) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Move a luminosidade (mantendo matiz/croma) até atingir o contraste pedido contra `bg`. */
function withContrast(base: Oklch, bg: Rgb, target: number, lighter: boolean): Rgb {
  let color = { ...base };
  for (let i = 0; i < 40; i++) {
    const rgb = oklchToRgb(color);
    if (contrast(rgb, bg) >= target) return rgb;
    color = { ...color, l: clamp(color.l + (lighter ? 0.015 : -0.015)) };
  }
  return oklchToRgb(color);
}

/* ───────── Paleta da interface ───────── */

export type ColorMode = "dark" | "light";

export interface Palette {
  /** CSS custom properties prontas para aplicar no :root. */
  vars: Record<string, string>;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Superfícies fixas por modo: a cor de destaque tinge, não pinta. */
const SHELL: Record<ColorMode, Rgb> = {
  dark: { r: 0, g: 0, b: 0 },
  light: { r: 247, g: 247, b: 249 },
};

const INK: Record<ColorMode, Rgb> = {
  dark: { r: 255, g: 255, b: 255 },
  light: { r: 10, g: 10, b: 16 },
};

/**
 * Gera todos os tons a partir da cor escolhida:
 *  - accent: a cor como escolhida (preenchimentos: switch, barras, anel);
 *  - accent-text: versão com contraste ≥ 4,5 contra a ilha (texto e ícones);
 *  - on-accent: preto ou branco, o que tiver mais contraste sobre a cor;
 *  - accent-2/3: vizinhas de matiz para degradês (análogas, nunca aleatórias);
 *  - ok/warn/danger: semânticas, com o croma harmonizado ao da cor escolhida.
 */
/**
 * Modo efetivo com um fundo personalizado: o texto precisa contrastar com o
 * fundo escolhido, então um fundo claro vira modo claro (tinta escura) e vice-versa.
 */
export function modeForSurface(surfaceHex: string, fallback: ColorMode): ColorMode {
  const rgb = parseHex(surfaceHex);
  if (!rgb) return fallback;
  return contrast(rgb, WHITE) >= contrast(rgb, BLACK) ? "dark" : "light";
}

/** `surfaceHex` vazio = fundo padrão do modo (preto / quase branco). */
export function buildPalette(accentHex: string, mode: ColorMode, surfaceHex = ""): Palette {
  const accent = parseHex(accentHex) ?? parseHex("#7c8cff")!;
  const shell = parseHex(surfaceHex) ?? SHELL[mode];
  const ink = INK[mode];
  const base = rgbToOklch(accent);
  const neutral = base.c < 0.03;

  const accentText = withContrast(base, shell, 4.5, mode === "dark");
  // Branco é preferido em cores médias/escuras (lê melhor em texto semibold); preto só em cores claras.
  const onAccent = contrast(accent, WHITE) >= 3 || contrast(accent, BLACK) < contrast(accent, WHITE) ? WHITE : { r: 8, g: 8, b: 12 };

  // Degradê: matizes vizinhas na mesma luminosidade; cor neutra fica neutra.
  const glowL = mode === "dark" ? 0.58 : 0.72;
  const glowC = neutral ? 0.02 : Math.max(0.09, Math.min(0.19, base.c));
  const glow1 = oklchToRgb({ l: glowL, c: glowC, h: base.h - 28 });
  const glow2 = oklchToRgb({ l: glowL - 0.04, c: glowC, h: base.h });
  const glow3 = oklchToRgb({ l: glowL, c: glowC, h: base.h + 32 });

  // Semânticas: matiz fixa (verde / âmbar / vermelho), croma moderado.
  const semC = 0.16;
  const semL = mode === "dark" ? 0.78 : 0.52;
  const ok = withContrast({ l: semL, c: semC, h: 152 }, shell, 3, mode === "dark");
  const warn = withContrast({ l: semL + 0.04, c: semC, h: 75 }, shell, 3, mode === "dark");
  const danger = withContrast({ l: semL - 0.06, c: 0.17, h: 25 }, shell, 4.5, mode === "dark");

  const vars: Record<string, string> = {
    "--accent": toHex(accent),
    "--accent-rgb": rgbTriple(accent),
    "--accent-text": toHex(accentText),
    "--on-accent": toHex(onAccent),
    "--g1": toHex(glow1),
    "--g2": toHex(glow2),
    "--g3": toHex(glow3),
    "--ok": toHex(ok),
    "--ok-rgb": rgbTriple(ok),
    "--warn": toHex(warn),
    "--danger": toHex(danger),
    "--danger-rgb": rgbTriple(danger),
    "--shell-rgb": rgbTriple(shell),
    "--ink": rgbTriple(ink),
    "--fg": toHex(mode === "dark" ? { r: 245, g: 245, b: 247 } : { r: 17, g: 17, b: 22 }),
  };
  return { vars };
}
