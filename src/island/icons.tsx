import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconWifi = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 10a11 11 0 0 1 15 0" />
    <path d="M7.5 13.2a6.6 6.6 0 0 1 9 0" />
    <circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconWifiOff = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 10a11 11 0 0 1 6-2.9M15.5 7.6A11 11 0 0 1 19.5 10" />
    <path d="M7.5 13.2a6.6 6.6 0 0 1 3.4-1.6" />
    <circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none" />
    <path d="M5 4l14 15" />
  </svg>
);

export const IconGear = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.7-1.3-1.8-3.1-2 .8a7.7 7.7 0 0 0-2.6-1.5L14.4 3h-3.6l-.3 2.1A7.7 7.7 0 0 0 7.9 6.6l-2-.8L4 8.9l1.7 1.3a7.6 7.6 0 0 0 0 3L4 14.5l1.8 3.1 2-.8a7.7 7.7 0 0 0 2.6 1.5l.3 2.1h3.6l.3-2.1a7.7 7.7 0 0 0 2.6-1.5l2 .8 1.8-3.1z" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </svg>
);

export const IconPrev = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M6 6.5h2v11H6zM19 6.9v10.2a.6.6 0 0 1-.9.5L10 12.5a.6.6 0 0 1 0-1l8.1-5.1a.6.6 0 0 1 .9.5z" />
  </svg>
);

export const IconNext = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M18 6.5h-2v11h2zM5 6.9v10.2c0 .5.5.8.9.5l8.1-5.1a.6.6 0 0 0 0-1L5.9 6.4a.6.6 0 0 0-.9.5z" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M7.5 5.6v12.8c0 .7.8 1.1 1.4.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4c-.6-.4-1.4 0-1.4.7z" />
  </svg>
);

export const IconPause = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="5.5" width="4" height="13" rx="1.2" />
    <rect x="13.5" y="5.5" width="4" height="13" rx="1.2" />
  </svg>
);

export const IconBell = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </svg>
);

export const IconPower = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.5v8" />
    <path d="M7 6.6a7.5 7.5 0 1 0 10 0" />
  </svg>
);

export const IconBolt = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M13.2 2.8 5.6 13.1a.6.6 0 0 0 .5.9H11l-1.1 7.1c-.1.6.7.9 1 .4l7.6-10.3a.6.6 0 0 0-.5-.9H13l1.1-7.1c.1-.6-.6-.9-.9-.4z" />
  </svg>
);

export const IconTimer = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13.5" r="7" />
    <path d="M12 13.5V10M9.5 3.5h5M18.5 7l1.2-1.2" />
  </svg>
);

export const IconStop = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5.5 12.5l4 4 9-9.5" />
  </svg>
);

export const IconMinus = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M6 12h12" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 6v12M6 12h12" />
  </svg>
);

/** Bateria desenhada à mão: o preenchimento acompanha o nível real. */
export function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  const low = level <= 0.2 && !charging;
  return (
    <svg width="1.6em" height="1em" viewBox="0 0 26 14" aria-hidden className="battery-glyph" data-low={low || undefined}>
      <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.3" />
      <rect x="23.4" y="4.6" width="1.9" height="4.8" rx="0.95" fill="currentColor" fillOpacity="0.45" />
      <rect x="2.6" y="2.6" width={Math.max(1.6, 17.8 * level)} height="8.8" rx="2.4" className="battery-fill" />
    </svg>
  );
}

export const IconChevronRight = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </svg>
);

export const IconReset = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 12a7 7 0 1 0 2.1-5" />
    <path d="M5 4.5V8h3.5" />
  </svg>
);

export const IconFolder = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

export const IconArrowUp = (p: IconProps) => (
  <svg {...base} {...p} strokeWidth={2}>
    <path d="M12 18.5v-13M6.5 11l5.5-5.5 5.5 5.5" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

/** Faísca de quatro pontas: marca do Claude na ilha. */
export const IconSpark = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <path d="M12 2.5c.5 4.6 2.4 6.9 7 9.5-4.6 2.6-6.5 4.9-7 9.5-.5-4.6-2.4-6.9-7-9.5 4.6-2.6 6.5-4.9 7-9.5z" />
  </svg>
);

export const IconHeadphones = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 15.5v-3a7.5 7.5 0 0 1 15 0v3" />
    <rect x="3.5" y="14" width="4.2" height="6" rx="1.6" />
    <rect x="16.3" y="14" width="4.2" height="6" rx="1.6" />
  </svg>
);

export const IconSpeaker = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />
  </svg>
);

export const IconMute = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </svg>
);

export const IconCaps = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 4.5l6.5 7h-3.8v3.8H9.3v-3.8H5.5z" />
    <path d="M9.3 19h5.4" />
  </svg>
);

export const IconBattery = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="7.5" width="15" height="9" rx="2.4" />
    <path d="M21 10.5v3" />
  </svg>
);

/** Balão com linhas: botão de letras. */
export const IconLyrics = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5.5 5h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5V17h-1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <path d="M8.5 9.5h7M8.5 12.5h4.5" />
  </svg>
);

export const IconCalendar = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </svg>
);

/* ───────── Navegação, ajustes e atalhos ───────── */

export const IconMusic = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9 17.5V6.2l10-2v11.3" />
    <circle cx="6.8" cy="17.5" r="2.3" />
    <circle cx="16.8" cy="15.5" r="2.3" />
  </svg>
);

export const IconListCheck = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 7l1.6 1.6L9 5.7M4.5 15l1.6 1.6L9 13.7" />
    <path d="M12.5 7.5h7M12.5 15.5h7" />
  </svg>
);

export const IconGrid = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="M15.6 15.6 20 20" />
  </svg>
);

export const IconCommand = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0h-6m6 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm-6 0v2.5A2.5 2.5 0 1 1 6.5 15H9z" />
  </svg>
);

export const IconPencil = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14.5 5.5l4 4L9 19H5v-4z" />
    <path d="M12.5 7.5l4 4" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7" />
  </svg>
);

export const IconGrip = (p: IconProps) => (
  <svg {...base} {...p} fill="currentColor" stroke="none">
    <circle cx="9" cy="6.5" r="1.4" />
    <circle cx="15" cy="6.5" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="17.5" r="1.4" />
    <circle cx="15" cy="17.5" r="1.4" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M13.5 4.5h6v6M19.5 4.5l-8 8" />
    <path d="M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4" />
  </svg>
);

export const IconGlobe = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M4 12h16M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z" />
  </svg>
);

export const IconEye = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconEyeOff = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M10 6.3c.6-.2 1.3-.3 2-.3 5.7 0 9 6 9 6a15 15 0 0 1-2.4 3.1M6.6 7.7A14.7 14.7 0 0 0 3 12s3.3 6 9 6c1.6 0 3-.5 4.2-1.1" />
    <path d="M4 4l16 16" />
  </svg>
);

export const IconKeyboard = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8" />
  </svg>
);

export const IconPalette = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.8a8.2 8.2 0 0 0 0 16.4c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-.9.7-1.5 1.6-1.5h2.2a3.8 3.8 0 0 0 3.8-3.8c0-3.6-3.7-6.6-8.2-6.6z" />
    <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.6" cy="7.8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSun = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.6" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </svg>
);

export const IconMoon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z" />
  </svg>
);

export const IconMonitor = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </svg>
);

export const IconLayout = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M3.5 9.5h17" />
  </svg>
);

export const IconSliders = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 7h9M18 7h1M5 17h3M12 17h7" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

export const IconMail = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
    <path d="M4.5 7l7.5 5.5L19.5 7" />
  </svg>
);

export const IconCode = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14" />
  </svg>
);

export const IconChat = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />
  </svg>
);

export const IconVideo = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="6" width="12" height="12" rx="2.2" />
    <path d="M15.5 10.5l5-3v9l-5-3" />
  </svg>
);

export const IconDoc = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5" />
  </svg>
);

export const IconCart = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3.5 4.5h2.2l2 10.5h10.6l1.9-7.5H7" />
    <circle cx="9" cy="19" r="1.3" />
    <circle cx="17" cy="19" r="1.3" />
  </svg>
);

export const IconStar = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3l-4.8 2.6 1-5.4-4-3.8 5.4-.7z" />
  </svg>
);

export const IconHome = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4.5v-5.5h-4V20H5.5a1 1 0 0 1-1-1z" />
  </svg>
);

export const IconBook = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" />
    <path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" />
  </svg>
);

export const IconReturn = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M19 5.5V12a2 2 0 0 1-2 2H6" />
    <path d="M9.5 10.5 6 14l3.5 3.5" />
  </svg>
);

/* ───────── Clima e hardware ───────── */

export const IconCloudSun = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M8.5 4.2v1.3M3.9 8.8H2.6M5.2 5.5l.9.9M11.8 5.5l-.9.9" />
    <path d="M5.9 11.2a3.2 3.2 0 015.6-2.6" />
    <path d="M8.8 19.5h8.6a3.4 3.4 0 00.4-6.8 4.6 4.6 0 00-8.8.9 3 3 0 00-.2 5.9z" />
  </svg>
);

export const IconCpu = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" />
    <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
  </svg>
);

export const IconMemory = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="7" width="18" height="9" rx="1.6" />
    <path d="M7 10.5v2M11 10.5v2M15 10.5v2M6 16v2.5M10 16v2.5M14 16v2.5M18 16v2.5" />
  </svg>
);

export const IconGpu = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 5.5v13" />
    <rect x="5.5" y="7" width="15.5" height="10" rx="1.8" />
    <circle cx="11" cy="12" r="2.6" />
    <path d="M16.5 10.2h2M16.5 13.8h2" />
  </svg>
);

export const IconDisk = (p: IconProps) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
    <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
    <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
  </svg>
);

export const IconArrowDown = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />
  </svg>
);

export const IconWind = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 8.5h10.5a2.5 2.5 0 10-2.4-3.2M3 12.5h15a2.8 2.8 0 11-2.6 3.8M3 16.5h7" />
  </svg>
);

export const IconThermo = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14 14.6V5a2 2 0 10-4 0v9.6a3.8 3.8 0 104 0z" />
    <path d="M12 16.2V9" />
  </svg>
);

export const IconDrop = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 3.5s6 6.4 6 10.7a6 6 0 01-12 0C6 9.9 12 3.5 12 3.5z" />
  </svg>
);

export const IconDownload = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

export const IconLock = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
