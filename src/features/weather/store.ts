import { useSyncExternalStore } from "react";

/**
 * Clima atual pelo wttr.in (sem chave, responde com CORS liberado).
 * Sem cidade nos ajustes, o wttr.in descobre pelo IP. Atualiza a cada 20 min,
 * ao voltar a conexão e quando a cidade muda; o último resultado fica salvo
 * para a ilha já abrir com a temperatura enquanto busca a nova.
 */

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "storm" | "snow";

export interface Weather {
  city: string;
  temp: number;
  feels: number;
  humidity: number;
  /** km/h */
  wind: number;
  /** Direção de onde o vento vem, em graus (0 = norte). */
  windDeg: number;
  desc: string;
  kind: WeatherKind;
  night: boolean;
  updatedAt: number;
}

interface State {
  data: Weather | null;
  status: "idle" | "loading" | "ok" | "error";
}

const CACHE = "island.weather.v1";
const REFRESH_MS = 20 * 60_000;
const RETRY_MS = 2 * 60_000;

/* Códigos do WorldWeatherOnline, que o wttr.in usa. */
const CODES: [WeatherKind, number[]][] = [
  ["clear", [113]],
  ["partly", [116]],
  ["cloudy", [119, 122]],
  ["fog", [143, 248, 260]],
  ["drizzle", [176, 263, 266, 281, 284, 293, 296, 353]],
  ["rain", [299, 302, 305, 308, 311, 314, 356, 359]],
  ["storm", [200, 386, 389, 392, 395]],
  ["snow", [179, 182, 185, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377]],
];

function kindOf(code: number): WeatherKind {
  return CODES.find(([, list]) => list.includes(code))?.[0] ?? "cloudy";
}

/** "06:12 AM" → minutos do dia. */
function minutes(s: string | undefined) {
  const m = s?.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

function load(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as Weather) : null;
  } catch {
    return null;
  }
}

let state: State = { data: load(), status: "idle" };
let city = "";
let timer: number | undefined;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parse(json: any, wanted: string): Weather {
  const cur = json.current_condition?.[0];
  if (!cur) throw new Error("resposta sem clima atual");
  const area = json.nearest_area?.[0];
  const astro = json.weather?.[0]?.astronomy?.[0];
  const rise = minutes(astro?.sunrise);
  const set = minutes(astro?.sunset);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const desc: string = cur.lang_pt?.[0]?.value || cur.weatherDesc?.[0]?.value || "";
  return {
    city: wanted || area?.areaName?.[0]?.value || "",
    temp: Number(cur.temp_C),
    feels: Number(cur.FeelsLikeC),
    humidity: Number(cur.humidity),
    wind: Number(cur.windspeedKmph),
    windDeg: Number(cur.winddirDegree),
    desc: desc.charAt(0).toUpperCase() + desc.slice(1),
    kind: kindOf(Number(cur.weatherCode)),
    night: rise != null && set != null ? nowMin < rise || nowMin >= set : false,
    updatedAt: Date.now(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function refresh() {
  window.clearTimeout(timer);
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  commit({ ...state, status: "loading" });
  const wanted = city;
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(wanted)}?format=j1&lang=pt`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parse(await res.json(), wanted);
    if (ctrl.signal.aborted) return;
    try {
      localStorage.setItem(CACHE, JSON.stringify(data));
    } catch {
      /* sem armazenamento */
    }
    commit({ data, status: "ok" });
    timer = window.setTimeout(refresh, REFRESH_MS);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    console.warn("clima indisponível", err);
    commit({ ...state, status: "error" });
    timer = window.setTimeout(refresh, RETRY_MS);
  }
}

let started = false;

/** Chamado pelo App com a cidade dos ajustes ("" = automática pelo IP). */
export function configureWeather(nextCity: string) {
  const trimmed = nextCity.trim();
  const changed = trimmed !== city;
  city = trimmed;
  if (!started) {
    started = true;
    window.addEventListener("online", () => void refresh());
    // Cache de outra cidade: não mostrar o lugar errado enquanto busca.
    if (state.data && city && state.data.city !== city) commit({ ...state, data: null });
    void refresh();
    return;
  }
  if (changed) {
    commit({ data: null, status: "loading" });
    void refresh();
  }
}

export const refreshWeather = () => void refresh();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useWeather() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Só o necessário para a ilha fechada (não re-renderiza por mudança de status). */
export function useWeatherNow() {
  return useSyncExternalStore(subscribe, () => state.data);
}
