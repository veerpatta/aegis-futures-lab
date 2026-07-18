/* Shared nav definition for Sidebar (desktop) and MobileNav (phone).
   Icons are inline 20×20 stroke SVGs — no icon dependency. */

export interface NavLink {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const NAV_LINKS: NavLink[] = [
  {
    href: "/",
    label: "Lab",
    hint: "Tune & backtest",
    icon: (
      <svg {...iconProps}>
        {/* flask */}
        <path d="M10 3h4M11 3v6l-5.2 8.6A2 2 0 0 0 7.5 21h9a2 2 0 0 0 1.7-3.4L13 9V3" />
        <path d="M8.5 15h7" />
      </svg>
    ),
  },
  {
    href: "/compare",
    label: "Compare",
    hint: "Side-by-side runs",
    icon: (
      <svg {...iconProps}>
        {/* twin columns */}
        <rect x="4" y="10" width="6" height="10" rx="1" />
        <rect x="14" y="4" width="6" height="16" rx="1" />
      </svg>
    ),
  },
  {
    href: "/markets",
    label: "Markets",
    hint: "Delayed feed & signals",
    icon: (
      <svg {...iconProps}>
        {/* candlesticks */}
        <path d="M7 4v3M7 15v5M17 4v5M17 17v3" />
        <rect x="5" y="7" width="4" height="8" rx="0.5" />
        <rect x="15" y="9" width="4" height="8" rx="0.5" />
      </svg>
    ),
  },
  {
    href: "/data",
    label: "Data",
    hint: "CSV import & replay",
    icon: (
      <svg {...iconProps}>
        {/* database */}
        <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
        <path d="M5 5.5V12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.5" />
        <path d="M5 12v6.5C5 19.9 8.1 21 12 21s7-1.1 7-2.5V12" />
      </svg>
    ),
  },
];

export function isActiveLink(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
