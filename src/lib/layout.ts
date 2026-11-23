import type { IslandSize, IslandStyle } from "./settings";

/**
 * Dimensões de cada estado em "unidades" (1u = 1px na escala 1).
 * A fonte raiz do documento é 16u × escala, então no CSS 16u = 1rem e
 * tudo cresce/encolhe junto.
 *
 * `compactActive` é o compacto com uma atividade ao vivo (ex.: Pomodoro
 * rodando): alarga para caber o tempo. O expandido é paginado e tem um
 * tamanho só para todas as páginas, então trocar de página não mexe na
 * cápsula — só no conteúdo.
 */
export const MODE_SIZE = {
  // Medidas do Nusa: fechada 195×39 (raio 14), aberta 546×182 (raio 32).
  compact: { w: 195, h: 39, r: 14 },
  compactActive: { w: 236, h: 39, r: 14 },
  expanded: { w: 546, h: 182, r: 32 },
  /** Aberta na música com a letra ligada: alarga como no Nusa. */
  lyrics: { w: 676, h: 182, r: 32 },
  /** Ajustes com barra lateral de seções. */
  settings: { w: 600, h: 440, r: 28 },
  /** Paleta de comandos (Ctrl+K / atalho global). */
  palette: { w: 520, h: 344, r: 26 },
  pomodoro: { w: 420, h: 372, r: 30 },
  claude: { w: 456, h: 440, r: 30 },
  todo: { w: 440, h: 340, r: 30 },
  /** Quadro de uma pasta de tarefas (colunas lado a lado). */
  board: { w: 720, h: 420, r: 30 },
  /** Pílula de aviso (carregador, fone, volume...), 403×78 como no Nusa. */
  pill: { w: 403, h: 78, r: 24 },
  /** Repouso em gota: notch baixinho, cobre só a beirada das abas. */
  restDrop: { w: 68, h: 16, r: 10 },
  /** Repouso em fio: linha fina na borda. */
  restLine: { w: 120, h: 5, r: 5 },
} as const;

/** Forma da ilha em repouso (sem mouse em cima). */
export type RestShape = "drop" | "line";

export type IslandMode = "rest" | "compact" | "expanded" | "settings" | "pomodoro" | "claude" | "todo" | "pill" | "palette";

export interface IslandBox {
  w: number;
  h: number;
  r: number;
}

/** Gota com várias atividades: alarga para caber um sinal a mais por atividade. */
const REST_DROP_STEP = 20;
const restDrops = [0, 1, 2, 3].map((n) => ({ ...MODE_SIZE.restDrop, w: MODE_SIZE.restDrop.w + Math.max(0, n - 1) * REST_DROP_STEP }));

export function islandSize(mode: IslandMode, active: boolean, lyrics = false, rest: RestShape = "drop", restCount = 0, board = false): IslandBox {
  if (mode === "todo" && board) return MODE_SIZE.board;
  if (mode === "rest") return rest === "line" ? MODE_SIZE.restLine : restDrops[Math.min(3, restCount)];
  if (mode === "compact") return active ? MODE_SIZE.compactActive : MODE_SIZE.compact;
  if (mode === "expanded" && lyrics) return MODE_SIZE.lyrics;
  return MODE_SIZE[mode];
}

export const toRem = (u: number) => `${u / 16}rem`;

/** Notch: topo reto (colado na borda da tela) e só os cantos de baixo arredondados. */
export function radiusCss(box: IslandBox, style: IslandStyle) {
  const r = toRem(box.r);
  return style === "notch" ? `0 0 ${r} ${r}` : r;
}

const SIZE_FACTOR: Record<IslandSize, number> = {
  compact: 0.9,
  default: 1,
  wide: 1.12,
};

/** Margem transparente ao redor da cápsula para a sombra e as "orelhas" não serem cortadas. */
const SHADOW_PAD_X = 28;
const SHADOW_PAD_BOTTOM = 40;

const ALL = Object.values(MODE_SIZE);
const MAX_W = Math.max(...ALL.map((s) => s.w));
const MAX_H = Math.max(...ALL.map((s) => s.h));

/**
 * Escala final: preferência do usuário × ajuste pela largura do monitor
 * (telas maiores ganham um pouco mais de presença), limitada para que o
 * maior estado nunca passe de 92% da largura disponível.
 */
export function computeScale(displayWidth: number, size: IslandSize) {
  const byDisplay = Math.min(1.15, Math.max(0.9, 0.85 + displayWidth / 12800));
  let scale = byDisplay * SIZE_FACTOR[size];
  scale = Math.min(scale, (displayWidth * 0.92) / (MAX_W + SHADOW_PAD_X * 2));
  return Math.round(scale * 1000) / 1000;
}

export function windowSize(scale: number) {
  return {
    width: Math.ceil(MAX_W * scale + SHADOW_PAD_X * 2),
    height: Math.ceil(MAX_H * scale + SHADOW_PAD_BOTTOM),
  };
}
