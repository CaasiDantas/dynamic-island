import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../../lib/native";
import { showPill } from "../pills/store";

/**
 * Notificações dos outros apps, vindas da central do Windows (ver
 * src-tauri/src/notify.rs). Aqui decide se aparecem: só as fontes que o
 * usuário ligou nos ajustes. WhatsApp e Zoho Mail já vêm ligados.
 *
 * Fonte = o app (ex.: "WhatsApp") ou, quando o aviso vem do navegador,
 * o site (ex.: "mail.zoho.com"), para não tratar todo o Edge como uma coisa só.
 */

interface NotifyEvent {
  id: number;
  app: string;
  appId: string;
  texts: string[];
  logo: string | null;
}

export interface NotifySource {
  key: string;
  label: string;
  enabled: boolean;
}

const KEY = "island.notifySources.v1";
const BROWSER = /edge|chrome|firefox|brave|opera|vivaldi/i;
const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:]\S*)?$/i;
const DEFAULT_ON = /whatsapp|zoho/i;
/** Sites reconhecidos pelo texto do aviso quando o navegador não informa a origem. */
const KNOWN_SITES = [
  { domain: "mail.zoho.com", match: /\bzoho\s*mail\b/i },
  { domain: "web.whatsapp.com", match: /\bwhatsapp\b/i },
];
/** O texto é só o nome do serviço (ex.: título "Zoho Mail")? Então sai da lista. */
const onlyName = (re: RegExp, t: string) => t.replace(re, "").trim() === "";

let sources: NotifySource[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as NotifySource[];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function save(next: NotifySource[]) {
  sources = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  listeners.forEach((l) => l());
}

function labelFor(key: string, app: string) {
  if (/whatsapp/i.test(key)) return "WhatsApp";
  if (/zoho/i.test(key)) return "Zoho Mail";
  return app || key;
}

/** Fonte do aviso e textos sem a linha de atribuição do site. */
function classify(e: NotifyEvent) {
  let domain: string | null = null;
  let texts = e.texts;
  // Edge registra cada site como um "app" próprio: "...!https://mail.zoho.com/".
  const site = e.appId.match(/!https?:\/\/(?:www\.)?([^/:]+)/i);
  if (site) domain = site[1].toLowerCase();
  else if (BROWSER.test(e.app)) {
    const i = texts.findIndex((t) => DOMAIN.test(t));
    if (i >= 0) {
      domain = texts[i].match(DOMAIN)![1].toLowerCase();
      texts = texts.filter((_, j) => j !== i);
    }
  }
  // O Edge atual não diz o site: reconhece serviços conhecidos pelo texto ("Zoho Mail").
  if (!domain && BROWSER.test(e.app)) {
    const known = KNOWN_SITES.find((s) => texts.some((t) => s.match.test(t)));
    if (known) {
      domain = known.domain;
      const rest = texts.filter((t) => !onlyName(known.match, t));
      if (rest.length) texts = rest;
    }
  }
  const key = domain ?? e.app.toLowerCase();
  return { key, label: domain ? labelFor(domain, domain) : labelFor(key, e.app), domain, texts };
}

function sourceFor(key: string, label: string): NotifySource {
  const found = sources.find((s) => s.key === key);
  if (found) return found;
  const created = { key, label, enabled: DEFAULT_ON.test(key) };
  save([...sources, created]);
  return created;
}

function onNotify(e: NotifyEvent) {
  // Desenvolvimento: grava o aviso cru no log local (.perf/perf.jsonl) para diagnóstico.
  if (import.meta.env.DEV) {
    void fetch("/__perf", { method: "POST", body: JSON.stringify({ t: Date.now(), kind: "notify", tauri: isTauri, app: e.app, appId: e.appId, texts: e.texts }) });
  }
  const { key, label, domain, texts } = classify(e);
  if (!key || !texts.length) return;
  const source = sourceFor(key, label);
  if (!source.enabled) return;

  const [first, ...rest] = texts;
  const title = rest.length ? first : label;
  const body = rest.length ? rest.join(" · ") : first;
  showPill({
    kind: "notify",
    icon: "bell",
    title,
    subtitle: body,
    meta: label,
    // No navegador o ícone seria o do Edge/Chrome: melhor o sino.
    image: domain ? undefined : (e.logo ?? undefined),
    ring: null,
    tone: "accent",
    open: () => {
      if (domain) void invoke("plugin:opener|open_url", { url: `https://${domain}` });
      else if (e.appId) void invoke("notify_open", { appId: e.appId });
    },
  });
}

let started = false;

/** Começa a ouvir (uma vez, ao abrir o app). */
export function startNotifications() {
  if (started || !isTauri) return;
  started = true;
  void listen<NotifyEvent>("island://notify", (ev) => onNotify(ev.payload));
}

export function setSourceEnabled(key: string, enabled: boolean) {
  save(sources.map((s) => (s.key === key ? { ...s, enabled } : s)));
}

/** Fontes já vistas (cada app/site que mandou aviso), para os ajustes. */
export function useNotifySources() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sources,
  );
}

/** Teste no navegador/devtools: `(await import("/src/features/notify/store.ts")).debugNotify()`. */
export function debugNotify(app = "WhatsApp") {
  onNotify({ id: Date.now(), app, appId: "", texts: ["Maria", "Chego em 10 minutos, pode descer"], logo: null });
}

/** Modo demonstração: simula um aviso do Windows com textos quaisquer. */
export function __demoNotify(app: string, texts: string[]) {
  onNotify({ id: Date.now(), app, appId: "", texts, logo: null });
}
