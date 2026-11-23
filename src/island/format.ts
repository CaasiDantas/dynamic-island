const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

export const formatTime = (d: Date) => timeFmt.format(d);

export function formatDate(d: Date) {
  const text = dateFmt.format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const mo = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const clean = (t: string) => t.replace(".", "");

/** "Sex 13 nov" */
export function formatShortDate(d: Date) {
  const w = clean(wd.format(d));
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} ${d.getDate()} ${clean(mo.format(d))}`;
}
