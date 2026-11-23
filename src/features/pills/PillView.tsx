import { memo, type ComponentType, type SVGProps } from "react";
import { useCommitCount } from "../../perf/hooks";
import { IconBattery, IconBell, IconBolt, IconDownload, IconCaps, IconHeadphones, IconMute, IconSpeaker, IconWifi, IconWifiOff } from "../../island/icons";
import { usePills, type PillIcon } from "./store";

const ICONS: Record<PillIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  bolt: IconBolt,
  battery: IconBattery,
  headphones: IconHeadphones,
  speaker: IconSpeaker,
  mute: IconMute,
  caps: IconCaps,
  wifi: IconWifi,
  "wifi-off": IconWifiOff,
  bell: IconBell,
  download: IconDownload,
};

/**
 * Pílula de aviso (403×78, como no Nusa): anel com ícone à esquerda,
 * título e detalhe no meio e o número grande à direita.
 */
export const PillView = memo(function PillView() {
  useCommitCount("PillView");
  const { last: pill } = usePills();
  if (!pill) return <div className="pill" />;
  const Icon = ICONS[pill.icon];
  const r = 14.5;
  const c = 2 * Math.PI * r;
  const fill = pill.ring ?? 1;

  return (
    <div className="pill" data-tone={pill.tone} data-kind={pill.kind}>
      {pill.image ? (
        <span className="pill-badge pill-badge--app">
          <img src={pill.image} alt="" draggable={false} />
        </span>
      ) : (
      <span className="pill-badge">
        <svg viewBox="0 0 39 39" className="pill-ring" aria-hidden>
          <circle cx="19.5" cy="19.5" r={r} className="pill-ring-track" />
          <circle cx="19.5" cy="19.5" r={r} className="pill-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - fill)} />
        </svg>
        <Icon className="pill-icon" />
      </span>
      )}
      <span className="pill-text">
        {pill.meta && <em className="pill-meta">{pill.meta}</em>}
        <strong title={pill.title}>{pill.title}</strong>
        <span title={pill.subtitle}>{pill.subtitle}</span>
      </span>
      {pill.value && <span className="pill-value">{pill.value}</span>}
    </div>
  );
});
