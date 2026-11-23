import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";
import { subscribeMedia, getMedia } from "./store";

/**
 * Espectro real do áudio para as barras do visualizador.
 *
 * O Rust captura a saída de som (loopback) e manda ~30 quadros/s com
 * `BARS` alturas 0..100 (grave → agudo). Aqui elas vão direto para o
 * `transform` de cada barra registrada, sem passar pelo React; a transição
 * curta no CSS preenche os quadros intermediários no compositor.
 *
 * A captura só fica ligada com música tocando, alguma barra montada, a
 * janela visível e as animações contínuas permitidas.
 */
export const BARS = 5;

type Target = { bars: HTMLElement[]; map: number[] } | { line: HTMLElement };

const targets = new Set<Target>();
let levels: number[] = new Array(BARS).fill(0);
let watching = false;
let started = false;
let demoTimer: number | undefined;

/** Barra parada nunca some: fica um tracinho, como no player do iPhone. */
const MIN = 0.16;

function paint() {
  for (const t of targets) {
    if ("line" in t) {
      const avg = levels.reduce((a, b) => a + b, 0) / BARS;
      t.line.style.transform = `scaleX(${0.25 + 0.75 * Math.min(1, avg * 1.6)})`;
      continue;
    }
    for (let i = 0; i < t.bars.length; i++) {
      const v = levels[t.map[i]] ?? 0;
      t.bars[i].style.transform = `scaleY(${MIN + (1 - MIN) * v})`;
    }
  }
}

function setLevels(next: number[]) {
  levels = next;
  paint();
}

const loopsOn = () => document.documentElement.dataset.loops !== "off";

function shouldWatch() {
  return targets.size > 0 && (getMedia()?.playing ?? false) && !document.hidden && loopsOn();
}

/** Fora do app (navegador/demonstração): ondas sintéticas para a vitrine. */
function demo(on: boolean) {
  window.clearInterval(demoTimer);
  demoTimer = undefined;
  if (!on) return;
  let t = 0;
  demoTimer = window.setInterval(() => {
    t += 1;
    setLevels(levels.map((v, i) => {
      const beat = t % 15 < 3 && i < 2 ? 0.9 : 0;
      const target = Math.max(beat, 0.25 + 0.45 * Math.abs(Math.sin(t * 0.21 + i * 1.7)) * Math.random());
      return v + (target - v) * (target > v ? 0.6 : 0.25);
    }));
  }, 33);
}

function sync() {
  const want = shouldWatch();
  if (want === watching) return;
  watching = want;
  if (isTauri) void invoke("spectrum_watch", { on: want }).catch(() => {});
  else demo(want);
  if (!want) setLevels(new Array(BARS).fill(0));
}

function ensureStarted() {
  if (started) return;
  started = true;
  if (isTauri) {
    void listen<number[]>("island://spectrum", (e) => {
      if (watching) setLevels(e.payload.map((v) => v / 100));
    });
  }
  subscribeMedia(sync);
  document.addEventListener("visibilitychange", sync);
  // Ajuste "animações contínuas" muda o atributo no <html>.
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-loops"] });
}

/** Faixas usadas quando a vista tem menos barras (ex.: 3 na gota). */
const MAPS: Record<number, number[]> = {
  3: [0, 2, 3],
  4: [0, 1, 2, 3],
  5: [0, 1, 2, 3, 4],
};

export function registerBars(bars: HTMLElement[]) {
  ensureStarted();
  const t: Target = { bars, map: MAPS[bars.length] ?? MAPS[5] };
  targets.add(t);
  paint();
  sync();
  return () => {
    targets.delete(t);
    sync();
  };
}

/** Trecho do fio: largura acompanha o volume médio. */
export function registerLine(line: HTMLElement) {
  ensureStarted();
  const t: Target = { line };
  targets.add(t);
  paint();
  sync();
  return () => {
    targets.delete(t);
    sync();
  };
}
