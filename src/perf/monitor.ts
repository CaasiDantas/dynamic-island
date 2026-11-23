/**
 * Diagnóstico de desempenho (temporário).
 *
 * O que mede: a cadência de quadros do thread principal do WebView via
 * requestAnimationFrame (intervalo entre callbacks consecutivos), o tempo de
 * cada transição da cápsula, commits dos componentes principais e quadros
 * longos (Long Animation Frames API).
 *
 * O que NÃO mede: o rAF não enxerga a composição/apresentação final da janela
 * pelo DWM do Windows. Uma animação feita só no compositor pode ficar lisa com
 * o thread principal travado (e vice-versa). Para isso use as métricas do
 * processo (CPU/GPU) e o perfil do WebView2 (DevTools/ETW).
 *
 * Desligado, o custo é um `if (!enabled)` nos pontos instrumentados.
 */

const RING = 2048;

export interface TransitionRecord {
  from: string;
  to: string;
  trigger: string;
  /** Evento de origem (hover/clique) → setMode. Inclui o timer de hover. */
  requestDelayMs: number | null;
  /** setMode → início real da transição CSS (render + estilo). */
  startLatencyMs: number | null;
  /** Início → fim da transição de altura da cápsula. */
  durationMs: number | null;
  cancelled: boolean;
  frames: number;
  avgFps: number;
  worstFrameMs: number;
  p95FrameMs: number;
  /** Quadros com intervalo > 1,5× o intervalo de atualização da tela. */
  droppedFrames: number;
}

interface PendingTransition {
  from: string;
  to: string;
  trigger: string;
  eventAt: number | null;
  requestedAt: number;
  startedAt: number | null;
}

type Listener = () => void;

class PerfMonitor {
  enabled = false;

  // Anel de timestamps de quadros (rAF).
  private stamps = new Float64Array(RING);
  private head = 0;
  private count = 0;
  private rafId = 0;
  private sessionStart = 0;
  private sessionFrames = 0;
  private sessionDropped = 0;
  private worstSession: number[] = [];

  renders: Record<string, number> = {};
  transitions: TransitionRecord[] = [];
  loafCount = 0;
  loafMaxMs = 0;
  loafBlockingMs = 0;
  private loafObserver: PerformanceObserver | null = null;

  private lastEvent: { kind: string; at: number } | null = null;
  private pending: PendingTransition | null = null;
  private listeners = new Set<Listener>();

  // ───────── ciclo de vida ─────────

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.reset();
      this.rafId = requestAnimationFrame(this.tick);
      this.observeLongFrames();
    } else {
      cancelAnimationFrame(this.rafId);
      this.loafObserver?.disconnect();
      this.loafObserver = null;
    }
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  reset() {
    this.head = 0;
    this.count = 0;
    this.sessionStart = performance.now();
    this.sessionFrames = 0;
    this.sessionDropped = 0;
    this.worstSession = [];
    this.renders = {};
    this.transitions = [];
    this.loafCount = 0;
    this.loafMaxMs = 0;
    this.loafBlockingMs = 0;
  }

  private tick = (t: number) => {
    if (!this.enabled) return;
    const prev = this.count > 0 ? this.stamps[(this.head - 1 + RING) % RING] : 0;
    this.stamps[this.head] = t;
    this.head = (this.head + 1) % RING;
    this.count = Math.min(this.count + 1, RING);
    if (prev) {
      const dt = t - prev;
      this.sessionFrames++;
      if (dt > this.refreshMs() * 1.5) this.sessionDropped++;
      this.pushWorst(dt);
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private pushWorst(dt: number) {
    const w = this.worstSession;
    if (w.length < 8 || dt > w[w.length - 1]) {
      w.push(dt);
      w.sort((a, b) => b - a);
      if (w.length > 8) w.pop();
    }
  }

  private observeLongFrames() {
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    const type = supported.includes("long-animation-frame") ? "long-animation-frame" : supported.includes("longtask") ? "longtask" : null;
    if (!type) return;
    this.loafObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        this.loafCount++;
        this.loafMaxMs = Math.max(this.loafMaxMs, e.duration);
        const loaf = e as PerformanceEntry & {
          blockingDuration?: number;
          renderStart?: number;
          styleAndLayoutStart?: number;
          scripts?: { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number; forcedStyleAndLayoutDuration: number }[];
        };
        this.loafBlockingMs += loaf.blockingDuration ?? 0;
        // Atribuição: quanto foi script, quanto foi renderização (estilo/layout/pintura).
        const end = e.startTime + e.duration;
        report({
          kind: "loaf",
          durationMs: round(e.duration),
          blockingMs: round(loaf.blockingDuration ?? 0),
          renderMs: loaf.renderStart ? round(end - loaf.renderStart) : null,
          styleLayoutMs: loaf.styleAndLayoutStart ? round(end - loaf.styleAndLayoutStart) : null,
          scripts: (loaf.scripts ?? []).map((s) => ({
            invoker: s.invoker,
            src: s.sourceURL.split("/").slice(-2).join("/"),
            fn: s.sourceFunctionName,
            ms: round(s.duration),
            forcedLayoutMs: round(s.forcedStyleAndLayoutDuration),
          })),
        });
      }
    });
    this.loafObserver.observe({ type, buffered: false });
  }

  // ───────── consultas ─────────

  /** Deltas dos quadros cujo timestamp está em [from, to]. */
  deltasBetween(from: number, to: number) {
    const out: number[] = [];
    let prev = 0;
    for (let i = this.count; i > 0; i--) {
      const t = this.stamps[(this.head - i + RING) % RING];
      if (prev && t >= from && t <= to) out.push(t - prev);
      prev = t;
    }
    return out;
  }

  /** Intervalo de atualização estimado pela mediana dos últimos quadros. */
  refreshMs() {
    const n = Math.min(this.count, 120);
    if (n < 10) return 1000 / 60;
    const d: number[] = [];
    for (let i = n; i > 1; i--) {
      const a = this.stamps[(this.head - i + RING) % RING];
      const b = this.stamps[(this.head - i + 1 + RING) % RING];
      d.push(b - a);
    }
    d.sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)];
  }

  stats(windowMs: number) {
    const now = performance.now();
    const d = this.deltasBetween(now - windowMs, now);
    const sum = d.reduce((a, b) => a + b, 0);
    const sorted = [...d].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    const refresh = this.refreshMs();
    const elapsed = (now - this.sessionStart) / 1000;
    return {
      fps: sum ? (d.length * 1000) / sum : 0,
      frameMs: d.length ? sum / d.length : 0,
      p95: pct(0.95),
      p99: pct(0.99),
      worst: sorted.length ? sorted[sorted.length - 1] : 0,
      dropped: d.filter((x) => x > refresh * 1.5).length,
      refreshHz: 1000 / refresh,
      avgFps: elapsed > 0 ? this.sessionFrames / elapsed : 0,
      sessionDropped: this.sessionDropped,
      worstSession: [...this.worstSession],
    };
  }

  // ───────── instrumentação ─────────

  countRender(name: string) {
    this.renders[name] = (this.renders[name] ?? 0) + 1;
  }

  /** Evento de entrada que pode levar a uma troca de estado (hover/clique). */
  markEvent(kind: string) {
    if (!this.enabled) return;
    this.lastEvent = { kind, at: performance.now() };
  }

  modeRequested(from: string, to: string) {
    if (!this.enabled) return;
    const now = performance.now();
    const ev = this.lastEvent && now - this.lastEvent.at < 2000 ? this.lastEvent : null;
    this.pending = { from, to, trigger: ev?.kind ?? "programático", eventAt: ev?.at ?? null, requestedAt: now, startedAt: null };
    this.lastEvent = null;
  }

  transitionStarted(at: number) {
    if (!this.enabled || !this.pending || this.pending.startedAt !== null) return;
    this.pending.startedAt = at;
  }

  transitionEnded(at: number, cancelled: boolean) {
    const p = this.pending;
    if (!this.enabled || !p) return;
    this.pending = null;
    const start = p.startedAt ?? p.requestedAt;
    const d = this.deltasBetween(start, at);
    const sum = d.reduce((a, b) => a + b, 0);
    const sorted = [...d].sort((a, b) => a - b);
    const refresh = this.refreshMs();
    const record: TransitionRecord = {
      from: p.from,
      to: p.to,
      trigger: p.trigger,
      requestDelayMs: p.eventAt !== null ? round(p.requestedAt - p.eventAt) : null,
      startLatencyMs: p.startedAt !== null ? round(p.startedAt - p.requestedAt) : null,
      durationMs: p.startedAt !== null ? round(at - p.startedAt) : null,
      cancelled,
      frames: d.length,
      avgFps: sum ? round((d.length * 1000) / sum) : 0,
      worstFrameMs: round(sorted[sorted.length - 1] ?? 0),
      p95FrameMs: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      droppedFrames: d.filter((x) => x > refresh * 1.5).length,
    };
    this.transitions.push(record);
    if (this.transitions.length > 50) this.transitions.shift();
    report({ kind: "transition", ...record });
  }
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Identifica a instância da janela nos logs (há casos com mais de um processo aberto). */
const INSTANCE = Math.random().toString(36).slice(2, 7);

export const perf = new PerfMonitor();

/** Envia uma linha ao arquivo de log (só em desenvolvimento, via plugin do Vite). */
export function report(payload: Record<string, unknown>) {
  if (!import.meta.env.DEV || !perf.enabled) return;
  void fetch("/__perf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ t: Date.now(), inst: INSTANCE, ...payload }),
    keepalive: true,
  }).catch(() => {});
}
