/* Shared nav definition for the Sidebar (desktop), the phone tab bar and the
   More page.

   Five tabs, each answering one question in plain words (2026-10-07,
   virtual trading and learning plan):
     Today  — what is the learner doing, what happened to the virtual money?
     Trades — every bot trade and skip, with the evidence behind it.
     Learn  — what it has tried, kept or rejected; the bot's health.
     Chart  — where is price, where are the key areas, what news is ahead?
     More   — trade ideas, practice money, your journal, the Guide, settings.

   URLs did not change when the labels did (/brain is Learn, /markets is
   Chart, /signals is Ideas under More), so saved links and home-screen icons
   keep working. /trades is new.
   Everything below the tabs lives in MORE_GROUPS; the Research room is the
   raw-numbers corner and says so. Icons are inline 20×20 stroke SVGs. */

export interface NavLink {
  href: string;
  label: string;
  /** Shorter label for the phone tab bar, when the sidebar label is too wide. */
  shortLabel?: string;
  hint: string;
  icon: React.ReactNode;
}

export interface NavGroup {
  title: string;
  note?: string;
  links: NavLink[];
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
    label: "Today",
    hint: "Is the bot working?",
    icon: (
      <svg {...iconProps}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9.5h13V10" />
      </svg>
    ),
  },
  {
    href: "/trades",
    label: "Trades",
    hint: "Every bot trade and skip, with its evidence",
    icon: (
      <svg {...iconProps}>
        <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6M9 11.5h6M9 15h3.5" />
      </svg>
    ),
  },
  {
    href: "/brain",
    label: "Learn",
    hint: "What the learner tried, kept or rejected",
    icon: (
      <svg {...iconProps}>
        <rect x="4.5" y="7.5" width="15" height="11" rx="3" />
        <path d="M12 7.5V4.5M12 4.5h.01" />
        <circle cx="9.3" cy="12.6" r="1.1" />
        <circle cx="14.7" cy="12.6" r="1.1" />
        <path d="M9.5 16h5" />
      </svg>
    ),
  },
  {
    href: "/markets",
    label: "Chart",
    hint: "Prices, key areas and news",
    icon: (
      <svg {...iconProps}>
        <path d="M7 4v3M7 15v5M17 4v5M17 17v3" />
        <rect x="5" y="7" width="4" height="8" rx="0.5" />
        <rect x="15" y="9" width="4" height="8" rx="0.5" />
      </svg>
    ),
  },
  {
    href: "/more",
    label: "More",
    hint: "Ideas, practice money, journal, Guide, settings",
    icon: (
      <svg {...iconProps}>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </svg>
    ),
  },
];

export const MORE_GROUPS: NavGroup[] = [
  {
    title: "Ideas and records",
    note: "Separate records, never added together: trade ideas, practice money and the learner's virtual account.",
    links: [
  {
    href: "/signals",
    label: "Ideas",
    hint: "Every trade idea the methods posted, and how it ended",
    icon: (
      <svg {...iconProps}>
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.45 1 1.15 1 1.95v.25h5.2v-.25c0-.8.4-1.5 1-1.95A6 6 0 0 0 12 3Z" />
      </svg>
    ),
  },
      {
        href: "/brain#practice",
        label: "Practice money",
        hint: "The strict account: trades only a method that passed every test",
        icon: (
          <svg {...iconProps}>
            <rect x="3.5" y="6.5" width="17" height="11" rx="2" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Your tools",
    links: [
      {
        href: "/replay",
        label: "Journal",
        hint: "Log your own trades and compare with the bot",
        icon: (
          <svg {...iconProps}>
            <rect x="4" y="3.5" width="16" height="17" rx="2" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        ),
      },
      {
        href: "/review",
        label: "Review",
        hint: "Trade-idea history: calendar of results and when ideas did best",
        icon: (
          <svg {...iconProps}>
            <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
            <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
            <rect x="7" y="12.5" width="3.5" height="3.5" rx="0.6" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Learn",
    links: [
      {
        href: "/guide",
        label: "Guide",
        hint: "How to use this app, in five minutes",
        icon: (
          <svg {...iconProps}>
            <path d="M12 6.5C10.5 5 8.2 4.5 5.5 4.5c-.8 0-1.5.1-2 .2V18c.5-.1 1.2-.2 2-.2 2.7 0 5 .5 6.5 2 1.5-1.5 3.8-2 6.5-2 .8 0 1.5.1 2 .2V4.7c-.5-.1-1.2-.2-2-.2-2.7 0-5 .5-6.5 2Z" />
            <path d="M12 6.5v13.3" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "Research room",
    note: "For researchers. Raw numbers and statistics — every method tested here so far has failed to beat chance.",
    links: [
      {
        href: "/lab",
        label: "Strategy Lab",
        shortLabel: "Lab",
        hint: "Test a method on past prices",
        icon: (
          <svg {...iconProps}>
            <path d="M10 3h4M11 3v6l-5.2 8.6A2 2 0 0 0 7.5 21h9a2 2 0 0 0 1.7-3.4L13 9V3" />
            <path d="M8.5 15h7" />
          </svg>
        ),
      },
      {
        href: "/diagnostics",
        label: "Diagnostics",
        hint: "Does a method beat random entries?",
        icon: (
          <svg {...iconProps}>
            <path d="M3 17c3 0 3.5-9 6.5-9s3.5 9 6.5 9 2.5-5 5-5" />
            <path d="M8 20.5v-3" />
            <circle cx="8" cy="15.5" r="1.4" />
          </svg>
        ),
      },
      {
        href: "/data",
        label: "Data",
        hint: "Import price files and replay a past day",
        icon: (
          <svg {...iconProps}>
            <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
            <path d="M5 5.5V12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.5" />
            <path d="M5 12v6.5C5 19.9 8.1 21 12 21s7-1.1 7-2.5V12" />
          </svg>
        ),
      },
    ],
  },
];

/** Every page reached through More, flattened (sidebar, header lookups). */
export const SECONDARY_LINKS: NavLink[] = MORE_GROUPS.flatMap((g) => g.links);

/** The phone tab bar carries all five primary links. */
export const MOBILE_LINKS = NAV_LINKS;

export function isActiveLink(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** The tab to highlight: the matching primary link, or More for any page reached through it. */
export function activeTabIndex(pathname: string): number {
  const direct = MOBILE_LINKS.findIndex((l) => isActiveLink(l.href, pathname));
  if (direct >= 0) return direct;
  const viaMore = SECONDARY_LINKS.some((l) => isActiveLink(l.href, pathname));
  return viaMore ? MOBILE_LINKS.findIndex((l) => l.href === "/more") : -1;
}
