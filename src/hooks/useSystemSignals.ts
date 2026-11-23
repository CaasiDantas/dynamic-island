import { useSyncExternalStore } from "react";

/**
 * Sinais do sistema compartilhados: um único timer de relógio, um único par de
 * listeners de rede e uma única assinatura de bateria para o app inteiro,
 * não importa quantos componentes os usem. Cada fonte só fica ativa enquanto
 * houver alguém inscrito.
 */
function createStore<T>(initial: T, start: (set: (v: T) => void) => () => void) {
  let value = initial;
  let stop: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const set = (v: T) => {
    if (Object.is(v, value)) return;
    value = v;
    listeners.forEach((l) => l());
  };
  return {
    get: () => value,
    subscribe(l: () => void) {
      listeners.add(l);
      if (!stop) stop = start(set);
      return () => {
        listeners.delete(l);
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
  };
}

// ───────── Relógio: atualiza só na virada do minuto ─────────

const clock = createStore(new Date(), (set) => {
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => {
      set(new Date());
      schedule();
    }, 60_000 - (Date.now() % 60_000) + 20);
  };
  set(new Date());
  schedule();
  return () => window.clearTimeout(timer);
});

export function useClock() {
  return useSyncExternalStore(clock.subscribe, clock.get);
}

// ───────── Rede ─────────

const online = createStore(navigator.onLine, (set) => {
  const update = () => set(navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
});

export function useOnline() {
  return useSyncExternalStore(online.subscribe, online.get);
}

// ───────── Bateria (Battery Status API do WebView2) ─────────

export interface BatteryState {
  level: number;
  charging: boolean;
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

let lastBattery: BatteryState | null = null;

const battery = createStore<BatteryState | null>(null, (set) => {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
  if (!nav.getBattery) return () => {};
  let manager: BatteryManagerLike | undefined;
  let active = true;
  const update = () => {
    if (!manager || !active) return;
    // Desktop sem bateria reporta "carregando a 100%": trata como sem bateria.
    if (manager.charging && manager.level === 1) {
      lastBattery = null;
    } else if (!lastBattery || lastBattery.level !== manager.level || lastBattery.charging !== manager.charging) {
      lastBattery = { level: manager.level, charging: manager.charging };
    }
    set(lastBattery);
  };
  nav
    .getBattery()
    .then((m) => {
      manager = m;
      m.addEventListener("levelchange", update);
      m.addEventListener("chargingchange", update);
      update();
    })
    .catch(() => {});
  return () => {
    active = false;
    manager?.removeEventListener("levelchange", update);
    manager?.removeEventListener("chargingchange", update);
  };
});

export function useBattery() {
  return useSyncExternalStore(battery.subscribe, battery.get);
}
