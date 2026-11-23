/**
 * Modo demonstração, para gravar o vídeo de apresentação no navegador
 * (`npm run dev` + `?demo=1`). Só existe em desenvolvimento.
 *
 * Este arquivo roda ANTES de qualquer store (é o primeiro import do
 * main.tsx): grava no localStorage do navegador de gravação os dados de
 * exemplo que as stores leem ao carregar (tarefas, letra, ajustes...).
 * A música, as faixas e as letras são fictícias, criadas para o vídeo.
 */

export const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");

export const DEMO_TRACK = {
  title: "Horizonte Elétrico",
  artist: "Aurora Lane",
  album: "Linhas de Luz",
  durationMs: 208_000,
  startMs: 38_500,
};

/** Letra original (escrita para o vídeo), sincronizada a partir de 0:40. */
const LYRICS: [number, string][] = [
  [40.0, "Acendo a cidade no fim da tarde"],
  [43.6, "cada janela é um sinal de partida"],
  [47.2, "o céu desenha o que a gente não diz"],
  [50.8, "e a noite chega devagar"],
  [54.4, "eu sigo a luz que mora no alto"],
  [58.0, "onde o tempo cabe numa linha"],
  [61.6, "e tudo que importa fica à vista"],
  [65.2, "no topo da tela, no topo do dia"],
  [68.8, "horizonte elétrico"],
  [72.4, "brilha quando eu chego"],
  [76.0, "horizonte elétrico"],
  [79.6, "acende o que eu quero"],
];

const DAY = 86_400_000;

function at(h: number, m: number, plusDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function seed() {
  localStorage.clear();
  const now = Date.now();

  localStorage.setItem(
    "island.settings.v1",
    JSON.stringify({ size: "default", style: "notch", compactFace: "clock", accent: "#7c83ff", expandOnHover: true, alwaysOnTop: true, reduceMotion: false }),
  );
  localStorage.setItem("island.page.v1", "media");
  localStorage.setItem("island.lyricsOn.v1", "0");

  const key = `${DEMO_TRACK.artist.toLowerCase()}|${DEMO_TRACK.title.toLowerCase()}`;
  localStorage.setItem(
    "island.lyrics.v2",
    JSON.stringify([[key, { synced: LYRICS.map(([t, text]) => ({ t: Math.round(t * 1000), text })), plain: null, instrumental: false }]]),
  );

  const task = (id: string, text: string, remindAt: number | null, doneAt: number | null = null) => ({
    id,
    text,
    done: doneAt != null,
    createdAt: now - 3 * 3600_000,
    doneAt,
    remindAt,
    notified: remindAt != null && remindAt < now,
  });
  localStorage.setItem(
    "island.todo.v1",
    JSON.stringify([
      task("t1", "Enviar proposta para o cliente", now + 50 * 60_000),
      task("t2", "Revisar o layout da landing", now + 3 * 3600_000),
      task("t3", "Treino às sete", at(19, 0)),
      task("t4", "Responder os e-mails da manhã", null, now - 2 * 3600_000),
      task("t5", "Reunião de alinhamento", null, now - 3600_000),
      task("t6", "Consulta no dentista", at(10, 30, 2)),
      task("t7", "Aniversário da Bia", at(9, 0, 5)),
      task("t8", "Entregar o relatório do mês", null, now - DAY - 3600_000),
    ]),
  );

  document.documentElement.dataset.demo = "1";
}

/** Capa fictícia: gradiente abstrato gerado no canvas (sem arte de terceiros). */
export function demoArtwork() {
  const c = document.createElement("canvas");
  c.width = c.height = 400;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, 400, 400);
  bg.addColorStop(0, "#ff7a3d");
  bg.addColorStop(0.5, "#e8336d");
  bg.addColorStop(1, "#5b2bd6");
  g.fillStyle = bg;
  g.fillRect(0, 0, 400, 400);
  const sun = g.createRadialGradient(250, 170, 10, 250, 170, 150);
  sun.addColorStop(0, "rgba(255,236,190,0.95)");
  sun.addColorStop(0.35, "rgba(255,170,90,0.55)");
  sun.addColorStop(1, "rgba(255,120,80,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, 400, 400);
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.moveTo(0, 250 + i * 18);
    g.bezierCurveTo(130, 230 + i * 14, 270, 280 + i * 16, 400, 245 + i * 18);
    g.stroke();
  }
  return c.toDataURL("image/jpeg", 0.92);
}

if (DEMO) seed();
