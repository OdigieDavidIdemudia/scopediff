# ScopeDiff Design System

This folder is the project-authoritative copy of the personal design standard. Read
`standard.json` before any UI, branding, report, admin or deployment-screen work. The
implementation tokens live in `web/src/styles/tokens.css`; component patterns live in
`web/src/styles/globals.css`.

## Style variant

**Neobrutalism with minimalism restraint.** Thick 2px borders, hard offset shadows, blocky
controls and visible structure — held back with generous whitespace, one accent, a tight type
scale and no decorative illustration outside the login page.

The design exists to answer one question fast: *what changed?* Added, removed and changed
targets must be readable before the prose. The accent is deliberately scarce.

## Type

| Role | Family | Use |
| --- | --- | --- |
| Heading | Space Grotesk | H1–H3, score values, brand |
| Body | Inter | copy, labels, navigation |
| Mono | JetBrains Mono | targets, revisions, counts, scores, code |

Type scale is intentionally compact: 9px eyebrows, 12–14px body, 20–24px section headings,
and a clamp-based 30–46px page title. Uppercase mono eyebrows carry structure without adding
visual weight.

## Color

The full token list is in `standard.json`. The short version:

- **Light:** warm paper `#F7F6F3`, white surfaces, ink `#111111`, amber `#B45309`.
- **Dark:** near-black `#0F0F0E`, raised surfaces, warm off-white text, amber `#F59E0B`.
- **Status colors** — green for opportunity/in-scope/success, red for risk/removed/error,
  yellow for partial/pending, blue for informational links only. Status colors never become
  the brand accent.
- **Amber is reserved** for primary actions, active filter state, focus and materiality. Do
  not use amber for large decorative fills or generic highlights.

Both themes are hand-tuned, not inverted. The theme is set before paint by `web/index.html`
and persisted in `localStorage`.

## Components

- **Buttons:** primary amber, secondary surface, ghost transparent, danger red. Every button
  has hover, active, focus-visible and disabled states. Hard shadow shifts to 2px on hover.
- **Cards:** 2px strong border, hard offset shadow, 6px radius. Accent cards use the amber
  shadow only for the one item that matters.
- **Change cards:** left border color follows impact (green opportunity, red risk, amber
  mixed, neutral baseline). Counts, target preview and materiality come before actions.
- **Diff groups:** added, removed, changed and moved groups have separate color bars, glyphs
  and text labels. Color is never the only signal.
- **Chips:** platform, kind, impact, confidence, scope and alert status. All chips include
  text.
- **Filter panel:** `aria-pressed` buttons with counts; the mobile toggle uses
  `aria-expanded`. Filters are in-flow on mobile, sticky on desktop.
- **Empty and error states:** explain what happened and offer the next action. The live API
  failure state offers both Retry and Use demo data, and never pretends demo data is live.

## Accessibility

- WCAG AA text contrast in both themes.
- Visible `:focus-visible` ring: `0 0 0 2px var(--bg), 0 0 0 4px var(--accent)`.
- 44px minimum touch targets for primary controls; compact icon buttons get 27–34px visual
  boxes with surrounding hit area where possible.
- Meaning is not conveyed by color alone — every status has a text label.
- Toast is `role=status`; errors are `role=alert`.
- Skip link to `#main`; reduced-motion media query disables non-essential transitions.
- Responsive breakpoints: 1080px (4→2 stats), 900px (single-column feed/diff, mobile filter
  toggle), 640px (single-column cards, stacked actions).

## Content voice

Technical, calm, direct. Say *published revision*, *target*, *materiality*, *scope note*.
Never say *scan*, *exploit*, *attack* or *test the target* as an action ScopeDiff performs.
The demo always uses RFC 2606 domains (`example.com`) and RFC 5737 ranges (`192.0.2.10`).

## Screens

| Screen | Route | Screenshot |
| --- | --- | --- |
| Change feed | `/` | `docs/screenshots/feed-light.png` |
| Change feed, dark | `/` | `docs/screenshots/feed-dark.png` |
| Change feed, mobile | `/` | `docs/screenshots/feed-mobile.png` |
| Program directory | `/programs` | `docs/screenshots/programs.png` |
| Program detail | `/programs/:id` | `docs/screenshots/program-detail.png` |
| Diff detail | `/changes/:id` | `docs/screenshots/diff-v8.png` |
| Watchlist & alerts | `/watchlist` | `docs/screenshots/watchlist.png` |
| Worker admin | `/admin` | `docs/screenshots/admin.png` |
| Sign in | `/login` | `docs/screenshots/login.png` |

## Adding a screen

1. Reuse the classes in `globals.css`; add a new component class only when the pattern will
   repeat.
2. Use tokens, never one-off hex values.
3. Check light, dark and 390px mobile.
4. Check focus order and the keyboard path for filters and forms.
5. If it is demo-facing, keep all targets fictional and RFC-reserved.
