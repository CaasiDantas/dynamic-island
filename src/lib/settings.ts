import { parseHex } from "./color";

export type IslandSize = "compact" | "default" | "wide";
/** notch: colada na borda de cima da tela; floating: cápsula solta, abaixo do topo. */
export type IslandStyle = "notch" | "floating";
/** Ilha fechada: relógio no centro, ou mínima (só indicadores, como um notch de verdade). */
export type CompactFace = "clock" | "minimal";
/** Ilha parada: gota, fio, ou "off" (fica sempre no tamanho fechado normal). */
export type RestStyle = "drop" | "line" | "off";
export type ThemeMode = "dark" | "light" | "system";

export type PageId = "media" | "pomodoro" | "claude" | "todo" | "shortcuts" | "weather" | "hardware";
export const ALL_PAGES: PageId[] = ["media", "pomodoro", "claude", "todo", "shortcuts", "weather", "hardware"];

/** Atalho global do Windows (RegisterHotKey): modificadores MOD_* + código virtual da tecla. */
export interface Hotkey {
  mods: number;
  vk: number;
  label: string;
}

export interface AccentPreset {
  name: string;
  color: string;
}

/** Cores sugeridas: tons sóbrios, todos com contraste testado nos dois modos. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "Índigo", color: "#7c83ff" },
  { name: "Azul", color: "#3b82f6" },
  { name: "Ciano", color: "#22b8cf" },
  { name: "Verde", color: "#34c38f" },
  { name: "Âmbar", color: "#f5a524" },
  { name: "Coral", color: "#ff6b5b" },
  { name: "Rosa", color: "#ec5c9a" },
  { name: "Violeta", color: "#9b6bff" },
  { name: "Grafite", color: "#a1a1aa" },
];

export interface Appearance {
  theme: ThemeMode;
  /** Cor principal em HEX (#rrggbb). */
  accent: string;
  /** Cor de fundo da ilha em HEX; vazio = automático (preto no escuro, claro no claro). */
  surface: string;
  /** Opacidade do fundo da ilha (0,7 a 1). */
  surfaceOpacity: number;
  /** Intensidade do degradê de fundo da ilha aberta (0 desliga). */
  glow: number;
}

export interface Settings extends Appearance {
  size: IslandSize;
  style: IslandStyle;
  compactFace: CompactFace;
  /** Forma em repouso. Com gota/fio: mouse em cima mostra a ilha fechada; clique abre. */
  restShape: RestStyle;
  /** Distância da borda superior da tela no estilo flutuante, em px lógicos. */
  topOffset: number;
  expandOnHover: boolean;
  alwaysOnTop: boolean;
  reduceMotion: boolean;
  /** Ordem das páginas na barra de abas. */
  pageOrder: PageId[];
  hiddenPages: PageId[];
  /** Página ao abrir a ilha: a última usada ou uma fixa. */
  startPage: "last" | PageId;
  hotkey: Hotkey | null;
  /** Cidade do clima; vazio = automática (pela conexão). */
  weatherCity: string;
  /** Clima ao lado da hora na ilha fechada. */
  compactWeather: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  accent: ACCENT_PRESETS[0].color,
  surface: "",
  surfaceOpacity: 1,
  glow: 0.5,
};

/** Fundos sugeridos para a ilha (vazio = automático pelo modo). */
export const SURFACE_PRESETS: AccentPreset[] = [
  { name: "Preto", color: "#000000" },
  { name: "Grafite", color: "#1c1c22" },
  { name: "Azul-noite", color: "#0f1a2e" },
  { name: "Floresta", color: "#0f2419" },
  { name: "Vinho", color: "#2a0f17" },
  { name: "Branco", color: "#f7f7f9" },
];

/** Ctrl+Alt+Espaço: livre no Windows e fácil de alcançar. */
export const DEFAULT_HOTKEY: Hotkey = { mods: 0x2 | 0x1, vk: 0x20, label: "Ctrl+Alt+Espaço" };

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_APPEARANCE,
  size: "default",
  style: "notch",
  compactFace: "clock",
  restShape: "drop",
  topOffset: 10,
  expandOnHover: true,
  alwaysOnTop: true,
  reduceMotion: false,
  pageOrder: ALL_PAGES,
  hiddenPages: [],
  startPage: "last",
  hotkey: DEFAULT_HOTKEY,
  weatherCity: "",
  compactWeather: true,
};

const STORAGE_KEY = "island.settings.v1";

/** Ids de destaque da versão anterior (antes do seletor de cor livre). */
const LEGACY_ACCENTS: Record<string, string> = {
  gelo: "#9cd6ff",
  menta: "#7be3b6",
  ambar: "#f5c46b",
  coral: "#ff8f7e",
  lilas: "#b9a6ff",
  grafite: "#e8e8ec",
};

/** Garante que tudo o que veio do armazenamento é válido (versões antigas, edição manual). */
function normalize(raw: Partial<Settings> & Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  if (!parseHex(s.accent)) s.accent = LEGACY_ACCENTS[s.accent] ?? DEFAULT_SETTINGS.accent;
  if (!["drop", "line", "off"].includes(s.restShape)) s.restShape = "drop";
  if (s.compactFace !== "clock" && s.compactFace !== "minimal") s.compactFace = "clock";
  if (!["dark", "light", "system"].includes(s.theme)) s.theme = "dark";
  if (typeof s.surface !== "string" || (s.surface && !parseHex(s.surface))) s.surface = "";
  s.surfaceOpacity = Math.min(1, Math.max(0.7, Number(s.surfaceOpacity) || 1));
  s.glow = Math.min(1, Math.max(0, Number.isFinite(Number(s.glow)) ? Number(s.glow) : DEFAULT_SETTINGS.glow));
  // Páginas novas entram no fim; ids desconhecidos saem.
  const order = (Array.isArray(s.pageOrder) ? s.pageOrder : []).filter((p) => ALL_PAGES.includes(p));
  s.pageOrder = [...new Set([...order, ...ALL_PAGES])];
  s.hiddenPages = (Array.isArray(s.hiddenPages) ? s.hiddenPages : []).filter((p) => ALL_PAGES.includes(p));
  if (typeof s.weatherCity !== "string") s.weatherCity = "";
  s.compactWeather = s.compactWeather !== false;
  if (s.startPage !== "last" && !ALL_PAGES.includes(s.startPage)) s.startPage = "last";
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
}
