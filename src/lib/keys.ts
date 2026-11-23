import type { Hotkey } from "./settings";

/** Modificadores do RegisterHotKey. */
export const MOD = { alt: 0x1, ctrl: 0x2, shift: 0x4, win: 0x8 } as const;

const NAMED: Record<string, [number, string]> = {
  Space: [0x20, "Espaço"],
  Enter: [0x0d, "Enter"],
  Backquote: [0xc0, "'"],
  Minus: [0xbd, "-"],
  Equal: [0xbb, "="],
  Comma: [0xbc, ","],
  Period: [0xbe, "."],
  Slash: [0xc1, "/"],
  Semicolon: [0xbf, ";"],
  BracketLeft: [0xdb, "["],
  BracketRight: [0xdd, "]"],
  ArrowUp: [0x26, "↑"],
  ArrowDown: [0x28, "↓"],
  ArrowLeft: [0x25, "←"],
  ArrowRight: [0x27, "→"],
  Home: [0x24, "Home"],
  End: [0x23, "End"],
  Insert: [0x2d, "Insert"],
  PageUp: [0x21, "PgUp"],
  PageDown: [0x22, "PgDn"],
};

/** Converte a tecla pressionada (KeyboardEvent.code) em código virtual do Windows. */
function vkOf(code: string): [number, string] | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return [m[1].charCodeAt(0), m[1]];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return [0x30 + Number(m[1]), m[1]];
  m = /^F([0-9]{1,2})$/.exec(code);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return [0x6f + Number(m[1]), code];
  return NAMED[code] ?? null;
}

export type CaptureResult = { kind: "ok"; hotkey: Hotkey } | { kind: "partial"; label: string } | { kind: "invalid"; reason: string };

/**
 * Lê uma combinação para virar atalho global. Exige um modificador
 * (Ctrl, Alt ou Win), exceto nas teclas F, para não capturar letras soltas.
 */
export function captureHotkey(e: KeyboardEvent): CaptureResult {
  const parts: string[] = [];
  let mods = 0;
  if (e.ctrlKey) (mods |= MOD.ctrl), parts.push("Ctrl");
  if (e.altKey) (mods |= MOD.alt), parts.push("Alt");
  if (e.shiftKey) (mods |= MOD.shift), parts.push("Shift");
  if (e.metaKey) (mods |= MOD.win), parts.push("Win");
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return { kind: "partial", label: parts.join("+") + "+…" };
  const key = vkOf(e.code);
  if (!key) return { kind: "invalid", reason: "Essa tecla não pode ser usada" };
  const isF = /^F[0-9]+$/.test(e.code);
  if (!isF && !(mods & (MOD.ctrl | MOD.alt | MOD.win))) return { kind: "invalid", reason: "Use Ctrl, Alt ou Win junto" };
  return { kind: "ok", hotkey: { mods, vk: key[0], label: [...parts, key[1]].join("+") } };
}

/** Atalhos dentro da ilha (fixos), para a referência dos ajustes e da paleta. */
export const LOCAL_KEYS: { keys: string; label: string }[] = [
  { keys: "Ctrl+K", label: "Abrir a paleta de comandos" },
  { keys: "Ctrl+1…9", label: "Ir para a página" },
  { keys: "← →", label: "Página anterior / próxima" },
  { keys: "Ctrl+,", label: "Ajustes" },
  { keys: "Esc", label: "Voltar / recolher" },
];
