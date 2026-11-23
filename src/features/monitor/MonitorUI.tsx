import type { ComponentType, CSSProperties, SVGProps } from "react";
import { IconArrowDown, IconArrowUp, IconCpu, IconDisk, IconGpu, IconMemory } from "../../island/icons";
import { usePrivacy, useHw } from "./store";

const GB = 1024 ** 3;
const gb = (bytes: number) => (bytes / GB).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Bytes/s → texto em bits por segundo (como as operadoras anunciam). */
function rate(bytesPerSec: number | null) {
  if (bytesPerSec == null) return "—";
  const bits = bytesPerSec * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Gbps`;
  if (bits >= 1e6) return `${(bits / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbps`;
  return `${Math.round(bits / 1e3)} kbps`;
}

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x)}%`);

/** Carga → nível da barra: âmbar passando de 75%, vermelho passando de 90%. */
const level = (x: number | null) => (x == null ? undefined : x > 90 ? "danger" : x > 75 ? "warn" : undefined);

function Metric({
  icon: Icon,
  label,
  value,
  load,
  title,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  /** 0..100; ausente = sem barra (rede). */
  load?: number | null;
  title?: string;
}) {
  const hasBar = load !== undefined;
  return (
    <li className="stat-card hw-card" data-level={hasBar ? level(load ?? null) : undefined} title={title}>
      <Icon className="stat-icon" />
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hasBar && (
        <span className="hw-bar" aria-hidden>
          <i style={{ "--fill": (load ?? 0) / 100 } as CSSProperties} />
        </span>
      )}
    </li>
  );
}

export function HardwarePage() {
  const s = useHw();
  const ram = s && s.ramTotal ? (100 * s.ramUsed) / s.ramTotal : null;
  const disk = s && s.diskTotal ? (100 * s.diskUsed) / s.diskTotal : null;
  return (
    <ul className="hw" aria-busy={!s}>
      <Metric icon={IconCpu} label="CPU" value={pct(s?.cpu ?? null)} load={s?.cpu ?? null} />
      <Metric
        icon={IconMemory}
        label="RAM"
        value={s && s.ramTotal ? `${gb(s.ramUsed)} / ${gb(s.ramTotal)} GB` : "—"}
        load={ram}
      />
      <Metric icon={IconGpu} label="GPU" value={pct(s?.gpu ?? null)} load={s?.gpu ?? null} />
      <Metric icon={IconArrowUp} label="Envio" value={rate(s?.netUp ?? null)} />
      <Metric icon={IconArrowDown} label="Download" value={rate(s?.netDown ?? null)} />
      <Metric
        icon={IconDisk}
        label="Disco"
        value={pct(disk)}
        load={disk}
        title={s && s.diskTotal ? `${gb(s.diskUsed)} de ${gb(s.diskTotal)} GB usados` : undefined}
      />
    </ul>
  );
}

/** Pontinhos de privacidade: verde = câmera em uso, laranja = microfone em uso. */
export function PrivacyDots() {
  const p = usePrivacy();
  if (!p.camera && !p.mic) return null;
  return (
    <span className="privacy-dots">
      {p.camera && <i className="privacy-dot privacy-dot--cam" title="Câmera em uso" aria-label="Câmera em uso" />}
      {p.mic && <i className="privacy-dot privacy-dot--mic" title="Microfone em uso" aria-label="Microfone em uso" />}
    </span>
  );
}
