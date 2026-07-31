# Aegis design language

Derived from the code as it stands, not invented. Every value below is quoted from
a real file. Where the codebase is inconsistent, the inconsistency is recorded as a
defect rather than presented as a choice.

**All new UI in the research/diagnostics work is built from these tokens and
patterns.** If a new component has no precedent here, extend the nearest existing
pattern rather than introducing a new idiom.

---

## 1. How styling works

There is **no Tailwind, and no component library**. Confirmed three ways: no
`tailwind.config.*` exists, `tailwindcss` is absent from `package.json`, and a
repo-wide grep for utility classes (`text-sm`, `tracking-`, `font-semibold`, …)
across every `.tsx` returns zero matches. Dependencies are `@supabase/supabase-js`,
`lightweight-charts`, `next`, `react` — nothing else.

Styling is:

1. **`app/globals.css`** — the single token source (`:root`), element resets, the
   page-shell classes (`.shell`, `.main`, `.pageTitle`, `.pageSub`), keyframes, and
   the `.num` / `.press*` utilities.
2. **One CSS Module per component** — `Foo.module.css`, imported as `styles`, used
   as `styles.thing`. Variants use `composes:`, e.g.
   `.btnPrimary { composes: btn; … }` (`components/ui/ui.module.css:88-93`).

Fonts load via a plain Google Fonts `<link>` in `app/layout.tsx` — **not**
`next/font`. Neither `<html>` nor `<body>` carries a `className`; base styling is
applied through element selectors.

### Theme

**Dark only.** Zero occurrences of `dark:`, `prefers-color-scheme` (outside the
reduced-motion block), `next-themes`, or a theme provider anywhere in the repo.
`app/layout.tsx:29` pins `themeColor: "#05080f"`, matching `--bg` exactly. Do not
add a light mode as a side effect of new work.

---

## 2. Color tokens

All from `app/globals.css:7-83`.

### Surfaces

| Token | Value | Role |
|---|---|---|
| `--bg` | `#05080f` | page background (`html, body`) |
| `--bg-canvas` | `#090c13` | *defined, never used* |
| `--bg-raised` | `#0b111d` | **the standard panel/card surface** |
| `--bg-lifted` | `#0d1420` | sheets, the Home "live" card |
| `--bg-elevated` | `#101a29` | Trust Center tiles, header icon buttons |
| `--bg-inset` | `#080d16` | wells — KPI tiles, inputs |
| `--border` | `#1b2536` | default 1px border |
| `--border-strong` | `#1f2b3f` | hover, dashed empty-state borders |
| `--border-live` | `#23405c` | live/active emphasis |

### Text

| Token | Value | Role |
|---|---|---|
| `--text` | `#e8eef8` | primary — body copy, values |
| `--text-dim` | `#93a1b8` | secondary copy |
| `--text-faint` | `#5b6a83` | uppercase eyebrow labels, timestamps |

### Semantic accents

| Token | Value | Role |
|---|---|---|
| `--green` | `#2dd4a0` | positive, BUY, target hit, brand |
| `--red` | `#ff6b7a` | negative, SELL, stopped |
| `--amber` | `#f5b452` | **caution / insufficient evidence** (see §6) |
| `--blue` | `#5aa7ff` | interactive — focus ring, open state, links |
| `--violet` | `#a78bfa` | *defined, never used* |
| `--cyan` | `#4dd0e1` | *defined, never used* |

Each of green/red/amber/blue has a `-soft` wash (`rgba(…, 0.12)`) for chip
backgrounds and a `-line` variant (`0.32`–`0.4`) for tinted borders.

Disabled is not a color — it is `opacity: 0.45` (`ui.module.css:86`).

### Chart series

`--ramp-1 #17a87d`, `--ramp-2 #3d8fe8`, `--ramp-3 #c08221`, `--ramp-4 #9377e8`,
`--ramp-5 #ef5567`, `--ramp-6 #21a5b8` — noted in the source as validated for
colour-vision deficiency and contrast on `--bg-raised`. Use these for any
multi-series chart; do not reach for the semantic accents.

---

## 3. Shape and rhythm

```
--radius-sm    6px     --space-1   4px
--radius-md   10px     --space-2   8px     ← panels
--radius-tile 14px     --space-3  12px
--radius-btn  15px     --space-4  16px     ← panel padding
--radius-card 22px     --space-5  24px
--radius-hero 26px     --space-6  32px
--radius-icon 12px
```

The scale is deliberately hard-rounded: hero sections 26px, cards 22px, tiles 14px,
icon buttons 12px. Layout constants: `--sidebar-w 220px`, `--tabbar-h 64px`,
`--appbar-h 56px`.

Breakpoints (documented at `globals.css:2-6`): **768px** mobile boundary,
**1100px** page-grid collapse, **480px** inner-grid collapse, plus
`@media (pointer: coarse)` as an orthogonal touch-sizing layer.

---

## 4. Typography

| Token | Face | Used for |
|---|---|---|
| `--font-sans` | Archivo | body — set once on `html, body` at 14px/1.5 |
| `--font-display` | Space Grotesk | brand, page titles, card headings, symbols |
| `--font-mono` | JetBrains Mono | **every numeric readout** |

**Numerics are tabular**, via two overlapping mechanisms: the `.num` utility class
(`globals.css:121-123`) applied inline, and `font-variant-numeric: tabular-nums`
declared directly on `.table`, `.kpiValue`, `.fieldValue`, `.input`. Both are in
use; prefer `.num` for one-off inline numbers and the CSS property for anything
that is always numeric.

### There is no named type scale

Sizes are tuned per component on a near-continuous half-pixel scale (9px → 44px).
The recurring bands:

| Band | Treatment | Used for |
|---|---|---|
| 9.5–11px | uppercase, `letter-spacing: 0.06–0.12em`, weight 600–700, `--text-faint` | eyebrow / kicker labels |
| 11.5–13px | regular | default body and UI text (table cells 12.5px) |
| 13.5–16px | weight 600 | emphasised values, card titles, tickers |
| 18–26px | weight 600, mono | KPI big numbers |
| 30–44px | weight 700, mono | the two true hero numbers |

`letter-spacing` is **negative** (`-0.01em` to `-0.02em`) on large display numbers
and headings, and **positive** (`0.04–0.12em`) on small uppercase labels. Weights
recur at 500 (form labels), 600 (default emphasis), 700 (hero, brand).

---

## 5. Component patterns

The primitives live in `components/ui/index.tsx` + `ui.module.css`. Reuse these
before writing markup.

| Export | Signature |
|---|---|
| `Panel` | `{ title?, hint?, actions?, children, className? }` |
| `Kpi` | `{ label, value, sub?, tone?, n?, ci? }` |
| `Badge` | `{ tone?: "default"\|"green"\|"red"\|"amber"\|"blue", children }` |
| `Button` | `ButtonHTMLAttributes & { variant?: "default"\|"primary"\|"ghost", small? }` |
| `DataTable` | `{ columns, rows, empty?, mobileCards?: {titleIndexes, hideIndexes?} }` |
| `Tabs` | `{ tabs: {id,label}[], active, onChange }` |
| `NumberField` | `{ label, value, onChange, min?, max?, step?, unit?, help?, slider? }` |
| `SelectField` | `{ label, value, onChange, options, help? }` |
| `ToggleField` | `{ label, value, onChange, help? }` |
| `Rate` | `{ readout: RateReadout, valueClassName?, showCi? }` |
| `SampleNote` | `{ n, ci?, className? }` |
| `toneClass` | `(tone) => string` — the shared tone→class resolver |
| `BottomSheet` | `{ open, onClose, title, children }` — focus-trapped; sheet <769px, dialog above |

### Panel — the standard container

```css
.panel {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  min-width: 0;
}
```

Title is 13px / 600 / `0.06em` uppercase / `--text-dim`. Higher-radius bespoke
variants exist for feature moments (`--radius-card` for signal cards,
`--radius-hero` for the Home P&L hero and Lab run summary).

### Metric readout

```css
.kpi { display: flex; flex-direction: column; gap: 2px;
       padding: var(--space-3); border-radius: var(--radius-sm);
       background: var(--bg-inset); }
.kpiLabel { font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
            text-transform: uppercase; color: var(--text-faint); }
.kpiValue { font-size: 18px; font-weight: 600;
            font-variant-numeric: tabular-nums; line-height: 1.2; }
```

### Table

```css
.table    { width: 100%; border-collapse: collapse; font-size: 12.5px;
            font-variant-numeric: tabular-nums; }
.table th { text-align: left; font-size: 10.5px; font-weight: 600;
            letter-spacing: 0.06em; text-transform: uppercase;
            color: var(--text-faint); padding: 6px 10px;
            border-bottom: 1px solid var(--border); }
.table td { padding: 6px 10px; border-bottom: 1px solid var(--border);
            white-space: nowrap; }
.table tbody tr:hover { background: var(--bg-inset); }
```

**No zebra striping anywhere** — hover is the only row treatment. `DataTable` also
carries a `mobileCards` mode that restacks rows as label/value cards under 768px,
and paints gradient scroll-shadows on the wrapper's edges when columns clip.

### Control groups

- **Segmented control** — pill track (`border-radius: 999px`), inactive segments
  `--text-faint` on transparent, active gets `background: var(--border)` and
  `--text`.
- **`Tabs`** — underline style; active tab takes `--green` for both text and
  bottom border.
- **Preset pills** — `.pill` / `.pillOn` in `lab.module.css:261-288`.
- **`ParamFields`** (`components/lab/ParamFields.tsx`) — the shared renderer that
  maps a strategy's typed param defs to `NumberField`/`SelectField`/`ToggleField`.
  It has a `compact` prop that suppresses help text. **Use this for any new
  parameter UI** rather than hand-rolling fields.

### Status badge / chip

`Badge` is an outlined pill: tone-coloured text + `-line` border + `-soft`
background. The fill-confidence chips (`SignalsClient.tsx:73-87`) are the canonical
example — and they encode a rule worth copying: **a clean fill renders no chip at
all.** Absence is the good state; only `marginal` (amber) and `doubtful` (red) are
labelled. Tone→label mappings live once in `lib/signals/status.ts:67-84`
(`statusLook`) and are reused by three surfaces so they cannot disagree.

### Empty state

Always a dashed border. Three sizes exist — `ui.module.css:297-304` (in-table),
`signalCards.module.css:221-230` (card list), `home.module.css:603-619` (hero, with
icon + title + body + link). Use `--border-strong` for the dash and
`--text-faint`/`--text-dim` for the copy.

### Loading

**There is no skeleton component.** The only idioms are plain `"Loading…"` text
inside a `Panel`, and the `.pulse` shimmer utility
(`@keyframes pulse` → `opacity: 1 → 0.45`, 1.6s). Do not introduce a skeleton
system for this work.

---

## 6. Two honesty rules that are load-bearing

These are not stylistic preferences. They are the reason this application exists,
expressed in CSS, and new diagnostics UI must follow them.

**1. Insufficient evidence is amber, never red.** From `ui.module.css:417-420`:

> Amber = "careful", never red: too little data is not a loss, and colouring it
> like one would be its own dishonesty.

The same rule governs pass/fail checklists — a failed item renders **grey**
(`.dim`), not red (`BrainClient.tsx:462-468`). Red is reserved for a measured
negative result. A thing not yet proven is never coloured as a loss.

**2. No rate renders without its `n`.** `lib/stats.ts` + the `Rate`/`SampleNote`
primitives enforce this: below `MIN_JUDGED_N = 30` the value dims and is flagged
*"previewed, not judged"*. Any new percentile, profit factor, or win rate must go
through `Rate`/`SampleNote` — including the random-entry percentile.

### The explainability idiom

There is **no component named "Gate Rail"**. The explainability surface is
distributed, and new diagnostics extend these rather than replacing them:

- **`SignalSheet.tsx:103-149`** — "Why the bot took it": a bulleted list where each
  reason is a 6px dot. Reasons take a **green** dot; caveats take an **amber** dot
  and dimmed text ("dimmer dot so the eye reads it as a caveat rather than a
  reason"). There is no red dot in this component.
- **`SignalContext.tsx`** — the inline no-click context strip, sharing the same
  describe-helpers so the two cannot disagree.
- **`WhyNoSignal.tsx`** — "is it broken, or just patient?": plain-language sentence,
  then a blockers table, then per-stream status badges.
- **`BrainClient.tsx`** — Trust Center state badge + 4-up tile grid, the
  "What the filters turned away" gate-cost funnel, and the ✓/✗ checklist.
- **`ResultsPanel.tsx:165-186`** — the qualification funnel: label / bar track /
  count grid, where the `qualified` bar alone switches from blue to `--green`.
  Labels are centralised in `components/lab/funnel.ts`.

The one component literally called a "rail" is the Home **risk rail**
(`home.module.css:491-553`) — a red→neutral→green gradient track showing where
price sits between stop and target. That is a position visualisation, not a gate.

---

## 7. Motion

Everything is defined once in `globals.css:126-199`:

```css
@keyframes pulse     { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes livePulse { /* expanding green ring, 0 → 7px */ }
@keyframes spin      { to { transform: rotate(360deg) } }
@keyframes riseIn    { from { opacity:0; transform: translateY(10px) } to { … } }
.riseIn  { animation: riseIn .28s ease both; }
.press   { transition: transform .12s }  .press:active   { transform: scale(.97) }
.pressSm:active { transform: scale(.99) }
.pressLg:active { transform: scale(.90) }
```

Conventions: **120–180ms** for hover/colour changes; **0.28–0.6s** with
`cubic-bezier(0.22, 1, 0.36, 1)` for position/opacity moves. `.press` on icon
buttons, `.pressSm` on cards and rows, `.pressLg` on the mobile tab bar, `.riseIn`
on page roots and list re-renders.

A global `@media (prefers-reduced-motion: reduce)` block collapses every animation
and transition to 0.001ms and disables the press transforms. **Any new animation
inherits this automatically — do not add motion that bypasses it.**

---

## 8. Known inconsistencies — fix, do not propagate

Recorded so new work does not copy them.

1. **`components/brain/brain.module.css` is written against a token vocabulary that
   does not exist.** It uses `var(--dim, #8a94a6)` — `--dim` is undefined (the real
   tokens are `--text-dim` / `--text-faint`), so it always falls through to the
   literal, rendering Brain's muted text a different grey from every other page. Its
   `var(--green, #21ba72)` / `var(--red, #e5484d)` fallbacks also don't match the
   real `#2dd4a0` / `#ff6b7a`. Authored against a stale palette.
2. **A hero gradient is hand-copied three times** with drift:
   `lab.module.css:438` and `home.module.css:267` both hardcode
   `linear-gradient(165deg, #131c2c, #0a0f1a 60%)`; `markets.module.css:45` uses a
   different start colour and stop.
3. **Two different brand-mark gradients** — `Sidebar.module.css:27` uses
   `135deg … #128a68`, `AppHeader.module.css:32` uses `140deg … #0f7f60`.
4. **De-facto tokens that were never named:** `#04110c` (ink on bright green,
   6 occurrences), `#2b0509` (ink on red), `#141d2c` (a divider distinct from
   `--border`, 5 occurrences).
5. **Chart colours resolve three different ways** — `CandleChart.tsx:60-129` reads
   CSS custom properties at runtime via a `token()` helper (necessary, since
   `lightweight-charts` needs literal strings) but with fallbacks that don't match
   (`--border` → `#1a2436` vs the real `#1b2536`); `ReplayClient.tsx` and
   `MarketsClient.tsx` skip `token()` and hardcode hex. **New chart code uses
   `token()` with correct fallbacks.**

---

## 9. Extensions added by the Phase 1 diagnostics view

`components/diagnostics/diagnostics.module.css`. Recorded here per the rule at
the top: extend the nearest existing pattern, then write down what you
extended.

| New class | Extends | Why it exists |
|---|---|---|
| `.hero` / `.heroBig` | Lab's `.runHero` / `.runHeroBig` (`lab.module.css:437-476`) | The brief makes the random-entry percentile the headline of the screen, so it needs a hero, not a `Kpi`. Uses `--radius-hero` and mono at 32px — between Lab's 24px and Home's 38–44px. Unlike the two existing heroes it uses **tokens for the gradient** rather than the hand-copied `#131c2c → #0a0f1a` literal (§8 item 2). |
| `.rule` | The empty-state family — dashed/tinted callout | The interpretation rule has to be on screen, not in a tooltip, or the percentile is just a number. Amber left border, because it is a caution about how to read the figure, not an error. |
| `.duo` / `.duoCard` / `.duoRow` | `Kpi`'s inset tile, in a labelled key-value grid | Gross and net must always appear together. A pair of `Kpi`s side by side would let one be screenshotted alone; one card holding both cannot be. |
| `.pill` / `.pillGood` / `.pillBad` / `.pillWarn` | `Badge` (`ui.module.css:210-226`) | Same tone triplet, smaller, for use inside a `DataTable` cell where `Badge`'s padding breaks the row rhythm. Follows the §6 rule exactly: a cell that merely failed to clear the bar is **amber**, and red is reserved for a measured negative (actively anti-predictive). |

No new colours, radii, spacing steps or font sizes outside the existing scale
were introduced.

---

*Derived from the repository as of 2026-07-31.*
