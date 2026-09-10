import type { SVGProps } from 'react';

/**
 * Small inline icons for the landing page. Monochrome, `currentColor`, 24px
 * grid — kept here rather than pulled from an icon package so the marketing
 * page adds no dependency and no icon-font request.
 */

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
});

export const PlayIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const PeopleIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M15 11a3 3 0 1 0 0-6" />
    <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
    <path d="M17 20c0-2 .8-3.6 2-4.5" />
  </svg>
);

export const BoltIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
  </svg>
);

export const LockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const GlobeIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
  </svg>
);

export const MonitorIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const LinkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

/* --- Brand-ish marks, simplified, single colour --- */

export const WindowsIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
  </svg>
);

export const AppleIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.8-.4 6.9 1.1 9.1.8 1.1 1.6 2.3 2.8 2.3 1.1 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.7-2.2c.9-1.2 1.2-2.4 1.3-2.5-.1 0-2.6-1-2.6-3.5zM14.2 5.6c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2.1-.5 2.7-1.3z" />
  </svg>
);

export const LinuxIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2c-2 0-3 1.8-3 3.6 0 1 .3 1.7.3 2.6 0 1-1.2 2.4-1.9 3.7C6.5 13.3 5 15.6 5 17.4c0 1.6 1.2 2 2.2 2.4 1 .3 1.3.9 2 1.4.5.4 1.6.8 2.8.8s2.3-.4 2.8-.8c.7-.5 1-1.1 2-1.4 1-.4 2.2-.8 2.2-2.4 0-1.8-1.5-4.1-2.4-5.5-.7-1.3-1.9-2.7-1.9-3.7 0-.9.3-1.6.3-2.6C15 3.8 14 2 12 2zm-1.6 4.2c.5 0 .9.5.9 1s-.4 1-.9 1-.9-.5-.9-1 .4-1 .9-1zm3.2 0c.5 0 .9.5.9 1s-.4 1-.9 1-.9-.5-.9-1 .4-1 .9-1zM12 9.4c.9 0 2 .6 2 1.2 0 .3-.4.6-1 .9-.4.2-.7.5-1 .5s-.6-.3-1-.5c-.6-.3-1-.6-1-.9 0-.6 1.1-1.2 2-1.2z" />
  </svg>
);

export const AndroidIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 10a1 1 0 0 0-1 1v6a1 1 0 0 0 2 0v-6a1 1 0 0 0-1-1zm10 0a1 1 0 0 0-1 1v6a1 1 0 0 0 2 0v-6a1 1 0 0 0-1-1zM8.5 10h7v7.5a1 1 0 0 1-1 1h-1V21a1 1 0 0 1-2 0v-2.5h-1V21a1 1 0 0 1-2 0v-2.5h-1a1 1 0 0 1-1-1V10zm.2-1c.2-1.8 1.4-3.3 3.3-3.9l-.9-1.5a.3.3 0 0 1 .5-.3l1 1.6c.4-.1.9-.2 1.4-.2s1 .1 1.4.2l1-1.6a.3.3 0 0 1 .5.3l-.9 1.5C17.9 5.7 19.1 7.2 19.3 9H8.7zm2.3-2.2a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2zm6 0a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2z" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);
