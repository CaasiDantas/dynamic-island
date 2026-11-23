import { useEffect, useState } from "react";

/**
 * Três cores da capa (esquerda, meio, direita) para o degradê da ilha.
 * A capa é reduzida para 24×24 num canvas uma única vez por faixa; as cores
 * ganham saturação e luminosidade fixas para o brilho não ficar sujo nem
 * apagado em capas escuras.
 */
export type Palette = [string, string, string];

const cache = new Map<string, Palette | null>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function tone(r: number, g: number, b: number) {
  const [h, s] = rgbToHsl(r, g, b);
  // Capa quase cinza: mantém cinza-azulado discreto em vez de inventar cor.
  const sat = s < 0.12 ? 18 : Math.min(85, 45 + s * 50);
  return `hsl(${Math.round(h)} ${Math.round(sat)}% 46%)`;
}

async function extract(src: string): Promise<Palette | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const N = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;

  const cols = [0, 1, 2].map((third) => {
    let r = 0, g = 0, b = 0, w = 0;
    for (let y = 0; y < N; y++) {
      for (let x = Math.floor((third * N) / 3); x < Math.floor(((third + 1) * N) / 3); x++) {
        const i = (y * N + x) * 4;
        const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        // Pixels coloridos e de meia-luz pesam mais que preto/branco.
        const weight = 0.15 + s * (1 - Math.abs(l - 0.5) * 1.6);
        r += data[i] * weight;
        g += data[i + 1] * weight;
        b += data[i + 2] * weight;
        w += weight;
      }
    }
    return tone(r / w, g / w, b / w);
  });
  return cols as Palette;
}

export function useArtPalette(src: string | null | undefined): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(() => (src ? cache.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setPalette(null);
      return;
    }
    if (cache.has(src)) {
      setPalette(cache.get(src) ?? null);
      return;
    }
    let alive = true;
    extract(src)
      .catch(() => null)
      .then((p) => {
        if (cache.size > 30) cache.clear();
        cache.set(src, p);
        if (alive) setPalette(p);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  return palette;
}
