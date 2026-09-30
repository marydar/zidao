import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 17, ...rest }: IconProps, children: ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => base(p, <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5" />);
export const IconPen = (p: IconProps) => base(p, <><path d="m15.5 5.5 3 3M4 20l1.2-4.2L16.4 4.6a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L8.2 18.8 4 20Z" /><path d="m14.5 6.5 3 3" /></>);
export const IconBook = (p: IconProps) => base(p, <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z" /></>);
export const IconChart = (p: IconProps) => base(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconSettings = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>);
export const IconSun = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = (p: IconProps) => base(p, <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />);
export const IconVolume = (p: IconProps) => base(p, <><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const IconVolumeOff = (p: IconProps) => base(p, <><path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" /><path d="m16 9 5 5M21 9l-5 5" /></>);
export const IconCheck = (p: IconProps) => base(p, <path d="m4.5 12.5 5 5 10-11" />);
export const IconX = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6 6 18" />);
export const IconUndo = (p: IconProps) => base(p, <><path d="M3 8h11a5 5 0 0 1 0 10H8" /><path d="m7 4-4 4 4 4" /></>);
export const IconEraser = (p: IconProps) => base(p, <><path d="m7 21-4-4a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L13 21H7Z" /><path d="M20 21H7" /></>);
export const IconBulb = (p: IconProps) => base(p, <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2.9 1.9v.2h5.2v-.2c0-.7.3-1.4.9-1.9A6 6 0 0 0 12 3Z" /></>);
export const IconEye = (p: IconProps) => base(p, <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = (p: IconProps) => base(p, <><path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17.5 17.5 0 0 1-3.1 3.9M6.5 7.3A16.7 16.7 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></>);
export const IconChevronLeft = (p: IconProps) => base(p, <path d="m14.5 6-6 6 6 6" />);
export const IconChevronRight = (p: IconProps) => base(p, <path d="m9.5 6 6 6-6 6" />);
export const IconChevronDown = (p: IconProps) => base(p, <path d="m6 9.5 6 6 6-6" />);
export const IconSearch = (p: IconProps) => base(p, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconPlus = (p: IconProps) => base(p, <path d="M12 5v14M5 12h14" />);
export const IconTrash = (p: IconProps) => base(p, <><path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" /></>);
export const IconRefresh = (p: IconProps) => base(p, <><path d="M20 11a8 8 0 0 0-14-4.5L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 14 4.5l2-2" /><path d="M20 20v-4.5h-4.5" /></>);
export const IconSkip = (p: IconProps) => base(p, <><path d="M5 5.5v13l9-6.5-9-6.5Z" /><path d="M18 5v14" /></>);
export const IconFlame = (p: IconProps) => base(p, <path d="M12 3s.8 2.8-1.4 5C8.5 10 7 11.6 7 14a5 5 0 0 0 10 0c0-2-1-3.6-2.4-5-.6 1-1.3 1.6-2.1 2 .6-2.6-.2-5.6-.5-8Z" />);
export const IconClock = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>);
export const IconTarget = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>);
export const IconAward = (p: IconProps) => base(p, <><circle cx="12" cy="9" r="5" /><path d="m8.5 13.5-1.5 7 5-3 5 3-1.5-7" /></>);
export const IconGrid = (p: IconProps) => base(p, <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>);
export const IconInfo = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.6" /></>);
export const IconArrowLeft = (p: IconProps) => base(p, <><path d="M20 12H4" /><path d="m10 6-6 6 6 6" /></>);
export const IconList = (p: IconProps) => base(p, <><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>);
export const IconLayers = (p: IconProps) => base(p, <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3.5 13 8.5 4.7L20.5 13" /><path d="m3.5 17.5 8.5 4.7 8.5-4.7" /></>);
export const IconTrending = (p: IconProps) => base(p, <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>);
export const IconSparkle = (p: IconProps) => base(p, <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />);
export const IconPlay = (p: IconProps) => base(p, <path d="M7 5.5v13l11-6.5-11-6.5Z" />);
