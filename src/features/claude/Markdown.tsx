import { memo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/native";

/**
 * Markdown mínimo para as respostas: parágrafos, listas, títulos, blocos de
 * código, `código`, **negrito**, *itálico* e links. Gera elementos React
 * (nunca HTML cru). Bloco de código sem fechamento (resposta ainda chegando)
 * vai até o fim do texto.
 */

type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", text: para.join("\n") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      endPara();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push({ t: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      endPara();
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      endPara();
      blocks.push({ t: "h", text: heading[1] });
      continue;
    }
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      endPara();
      const kind = item[1] ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      if (last && last.t === kind) last.items.push(item[3]);
      else blocks.push({ t: kind, items: [item[3]] });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      endPara();
      const last = blocks[blocks.length - 1];
      if (last && last.t === "quote") last.text += "\n" + quote[1];
      else blocks.push({ t: "quote", text: quote[1] });
      continue;
    }
    // Continuação de item de lista (linha recuada logo após a lista).
    const last = blocks[blocks.length - 1];
    if (!para.length && /^\s{2,}\S/.test(line) && last && (last.t === "ul" || last.t === "ol")) {
      last.items[last.items.length - 1] += " " + line.trim();
      continue;
    }
    para.push(line);
  }
  endPara();
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(\*[^*\s][^*\n]*\*)/g;

function openUrl(url: string) {
  if (isTauri) void invoke("plugin:opener|open_url", { url }).catch(() => {});
  else window.open(url, "_blank", "noopener");
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{s.slice(2, -2)}</strong>);
    else if (m[3]) {
      const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(
        <a key={k++} href={url} title={url} onClick={(e) => (e.preventDefault(), openUrl(url))}>
          {label}
        </a>,
      );
    } else out.push(<em key={k++}>{s.slice(1, -1)}</em>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parse(text).map((b, i) => {
        switch (b.t) {
          case "p":
            return <p key={i}>{inline(b.text)}</p>;
          case "h":
            return (
              <p key={i} className="md-h">
                {inline(b.text)}
              </p>
            );
          case "code":
            return (
              <pre key={i} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return <blockquote key={i}>{inline(b.text)}</blockquote>;
          default: {
            const List = b.t;
            return (
              <List key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
});
