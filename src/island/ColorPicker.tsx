import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { hsvToRgb, parseHex, rgbToHsv, toHex, type Hsv, type Rgb } from "../lib/color";
import { focusIsland } from "../features/claude/store";

interface Props {
  value: string;
  /** Durante o arraste: aplica a cor na interface sem salvar. */
  onPreview: (hex: string) => void;
  /** Ao soltar / confirmar: salva. */
  onCommit: (hex: string) => void;
}

const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));

/**
 * Seletor de cor: área saturação × brilho, faixa de matiz, HEX e R/G/B.
 * O HSV fica guardado aqui para a matiz não se perder ao chegar no cinza.
 * Durante o arraste só o necessário é atualizado, uma vez por quadro.
 */
export function ColorPicker({ value, onPreview, onCommit }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(parseHex(value) ?? { r: 124, g: 131, b: 255 }));
  const [hexDraft, setHexDraft] = useState(value);
  const lastEmitted = useRef(value);

  // Cor mudou por fora (predefinição, tema salvo, restaurar): sincroniza.
  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current.toLowerCase()) return;
    lastEmitted.current = value;
    const rgb = parseHex(value);
    if (rgb) setHsv(rgbToHsv(rgb));
    setHexDraft(value);
  }, [value]);

  const rgb = hsvToRgb(hsv);
  const hex = toHex(rgb);

  const emit = (next: Hsv, commit: boolean) => {
    setHsv(next);
    const h = toHex(hsvToRgb(next));
    setHexDraft(h);
    lastEmitted.current = h;
    if (commit) onCommit(h);
    else onPreview(h);
  };

  const setRgb = (patch: Partial<Rgb>) => {
    const next = { ...rgb, ...patch };
    const nextHsv = rgbToHsv(next);
    // Cinza não tem matiz: mantém a anterior.
    emit(nextHsv.s === 0 ? { ...nextHsv, h: hsv.h } : nextHsv, true);
  };

  const hueColor = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return (
    <div className="cpk" style={{ "--cpk-hue": hueColor, "--cpk-color": hex } as CSSProperties}>
      <Area2D
        hsv={hsv}
        onChange={(s, v, commit) => emit({ ...hsv, s, v }, commit)}
      />
      <div className="cpk-side">
        <Hue hue={hsv.h} onChange={(h, commit) => emit({ ...hsv, h }, commit)} />
        <div className="cpk-fields">
          <label className="cpk-hex">
            <span className="cpk-swatch" aria-hidden />
            <input
              className="input input--mono"
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              aria-label="Cor em HEX"
              onPointerDown={focusIsland}
              onChange={(e) => {
                const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                setHexDraft(v);
                const parsed = parseHex(v);
                if (parsed && v.length === 7) {
                  const next = rgbToHsv(parsed);
                  emit(next.s === 0 ? { ...next, h: hsv.h } : next, true);
                }
              }}
              onBlur={() => setHexDraft(hex)}
            />
          </label>
          <div className="cpk-rgb">
            {(["r", "g", "b"] as const).map((k) => (
              <Channel key={k} label={k.toUpperCase()} value={Math.round(rgb[k])} onChange={(n) => setRgb({ [k]: n })} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Channel({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    onChange(Math.round(clamp(n, 0, 255)));
  };
  return (
    <label className="cpk-ch">
      <span>{label}</span>
      <input
        className="input input--mono"
        inputMode="numeric"
        value={draft}
        aria-label={`Canal ${label} (0 a 255)`}
        onPointerDown={focusIsland}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
          setDraft(v);
          if (v !== "" && Number(v) <= 255) onChange(Number(v));
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 255));
          }
        }}
      />
    </label>
  );
}

/** Arraste genérico: mede o retângulo uma vez no início e agrupa as mudanças por quadro. */
function useDrag(onMove: (x: number, y: number, commit: boolean) => void) {
  const st = useRef<{ rect: DOMRect; x: number; y: number; raf: number } | null>(null);
  const at = (e: PointerEvent, rect: DOMRect) => [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)] as const;
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const [x, y] = at(e, rect);
      st.current = { rect, x, y, raf: 0 };
      onMove(x, y, false);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const s = st.current;
      if (!s) return;
      [s.x, s.y] = at(e, s.rect);
      if (!s.raf)
        s.raf = requestAnimationFrame(() => {
          if (!st.current) return;
          st.current.raf = 0;
          onMove(st.current.x, st.current.y, false);
        });
    },
    onPointerUp() {
      const s = st.current;
      if (!s) return;
      cancelAnimationFrame(s.raf);
      st.current = null;
      onMove(s.x, s.y, true);
    },
    onPointerCancel() {
      const s = st.current;
      if (s) cancelAnimationFrame(s.raf);
      st.current = null;
    },
  };
}

function Area2D({ hsv, onChange }: { hsv: Hsv; onChange: (s: number, v: number, commit: boolean) => void }) {
  const drag = useDrag((x, y, commit) => onChange(x, 1 - y, commit));
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(clamp(hsv.s + d[0]), clamp(hsv.v + d[1]), true);
  };
  return (
    <div
      className="cpk-area"
      role="slider"
      tabIndex={0}
      aria-label="Saturação e brilho"
      aria-valuetext={`Saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
      onKeyDown={onKey}
      {...drag}
    >
      <span className="cpk-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
  );
}

function Hue({ hue, onChange }: { hue: number; onChange: (h: number, commit: boolean) => void }) {
  const drag = useDrag((x, _y, commit) => onChange(Math.min(359.9, x * 360), commit));
  return (
    <div
      className="cpk-hue"
      role="slider"
      tabIndex={0}
      aria-label="Matiz"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onChange((hue + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 15 : 3) + 360) % 360, true);
      }}
      {...drag}
    >
      <span className="cpk-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
    </div>
  );
}
