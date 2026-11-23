/**
 * Aviso sonoro sintetizado (Web Audio): sem arquivos de áudio no pacote.
 * O contexto de áudio só pode começar após um gesto do usuário, então ele é
 * criado/retomado quando o Pomodoro é iniciado por um clique.
 */
let ctx: AudioContext | null = null;

export function primeAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Três notas suaves: subindo para "pausa", descendo para "volta ao foco". */
export function playChime(kind: "break" | "focus") {
  if (!ctx) primeAudio();
  if (!ctx) return;
  const notes = kind === "break" ? [659.25, 783.99, 1046.5] : [1046.5, 783.99, 659.25];
  const t0 = ctx.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + i * 0.16;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start);
    osc.stop(start + 0.95);
  });
}
