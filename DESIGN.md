---
name: better-prode
description: Prode del Mundial mobile-first — verde cancha, planilla limpia, dorado para los plenos.
colors:
  pitch-green: "oklch(0.48 0.12 150)"
  pitch-green-deep: "oklch(0.42 0.12 150)"
  pitch-green-ink: "oklch(0.38 0.10 150)"
  pitch-green-tint: "oklch(0.95 0.04 150)"
  glory-gold: "oklch(0.82 0.13 84)"
  glory-gold-ink: "oklch(0.34 0.06 70)"
  surface: "oklch(1 0 0)"
  surface-subtle: "oklch(0.975 0.008 150)"
  ink: "oklch(0.22 0.015 152)"
  ink-muted: "oklch(0.46 0.012 152)"
  border-hairline: "oklch(0.91 0.006 152)"
  miss-red: "oklch(0.56 0.20 27)"
  miss-red-ink: "oklch(0.45 0.16 27)"
  miss-red-tint: "oklch(0.95 0.05 25)"
  live-red: "oklch(0.62 0.21 25)"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 5vw, 2.75rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.01em"
  score:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
    fontFeature: "'tnum' 1"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.pitch-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.pitch-green-deep}"
    textColor: "{colors.surface}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.pitch-green-deep}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  chip-filter:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
  chip-selected:
    backgroundColor: "{colors.pitch-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    padding: "6px 14px"
  pleno-badge:
    backgroundColor: "{colors.glory-gold}"
    textColor: "{colors.glory-gold-ink}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    typography: "{typography.label}"
---

# Design System: better-prode

## 1. Overview

**Creative North Star: "Cancha y planilla"**

better-prode lives where the pitch meets the scorekeeper's ledger. The energy is football — green, competitive, the small electric thrill of nailing a score — but the surface is the calm precision of a fintech you trust with your money. Pitch green carries the brand; the surface stays pure white and gets out of the way; gold is reserved for one thing only — the **pleno**, the perfect score, the moment worth celebrating. Information is dense (form, results, points, rivals' picks all earn their place) but the layout breathes: fintech spacing, clear hierarchy, never the cramped wall of a legacy prode.

This system explicitly rejects two things. It is **not the old amontonado prode** (prodeenlinea-style: cramped, illegible tables, everything fighting for space) — we take the *density of information* from those tools and throw away the clutter. And it is **not a generic gray SaaS dashboard** — no soulless slate, no default-shadcn neutrality, no "AI dashboard" coldness. The warmth and the competition are visible.

**Key Characteristics:**
- Pure white surface; the mood is carried by pitch green + gold, never by a tinted background.
- One confident green primary; gold spent only on plenos.
- Dense but breathing — fintech rhythm over scoreboard cram.
- Glanceable truth: results, picks and points read in one look, color + position + value.
- Mobile-first, thumb-honest; flat by default, depth only on lifted surfaces (sheets, sticky bars).

## 2. Colors

A pure-white field where a deep pitch green does the emotional work, with gold held in reserve for glory and a clear green/red axis for prediction outcomes.

### Primary
- **Pitch Green** (`oklch(0.48 0.12 150)`): The brand. Primary buttons, active nav, selected chips, the bar that says "this is better-prode". Deep enough to carry white text at AA. Football without the cliché celeste-and-white.
- **Pitch Green Deep** (`oklch(0.42 0.12 150)`): Hover/active state for green surfaces; pressed buttons.
- **Pitch Green Ink** (`oklch(0.38 0.10 150)`): Green text on light tints (e.g. the "acertó" cell text on a green tint); the ghost-button label color.

### Secondary
- **Glory Gold** (`oklch(0.82 0.13 84)`): Reserved. The pleno badge, top-of-table medal, the ✦ glory marker — nothing else. Its rarity is the point.
- **Glory Gold Ink** (`oklch(0.34 0.06 70)`): Text/iconography on gold fills (gold + dark-gold-brown ink, never gold + white).

### Neutral
- **Ink** (`oklch(0.22 0.015 152)`): Primary text. Near-black with the faintest green cast so it belongs to the system.
- **Ink Muted** (`oklch(0.46 0.012 152)`): Secondary text, metadata, dates, group labels. Dark enough for ≥4.5:1 on white — **never** a light "elegant" gray.
- **Surface** (`oklch(1 0 0)`): Pure white. Body and cards. Literal white, no hidden warmth.
- **Surface Subtle** (`oklch(0.975 0.008 150)`): The barely-there green-tinted fill for unselected chips, sticky headers, section bands. Tint toward the brand hue, never toward warm-by-default.
- **Border Hairline** (`oklch(0.91 0.006 152)`): 1px dividers and card edges. Separation comes from hairlines, not shadows.

### Tertiary — Outcome axis
- **Miss Red** (`oklch(0.56 0.20 27)`) / **Miss Red Ink** (`oklch(0.45 0.16 27)`) / **Miss Red Tint** (`oklch(0.95 0.05 25)`): The "erró" side of a prediction (wrong goal, wrong result). Paired with a ✗ glyph and position — never color alone.
- **Live Red** (`oklch(0.62 0.21 25)`): The "EN VIVO" pulse only. Distinct in role from Miss Red even if adjacent in hue.

### Named Rules
**The Gold-For-Glory Rule.** Gold appears only on a pleno and the podium. If gold shows up on a normal +3 or a generic button, it's wrong — its scarcity is what makes a pleno feel earned.

**The White-Field Rule.** The body background is literal `oklch(1 0 0)`. Warmth/identity lives in green + gold + type, never in a tinted surface. No cream, no sand, no "warm white".

## 3. Typography

**Display Font:** Archivo (with system-ui, sans-serif)
**Body Font:** Inter (with system-ui, sans-serif)
**Score/Numeric:** Archivo with tabular figures (`font-feature-settings: 'tnum'`)

**Character:** Archivo brings a wider, sporting, almost-editorial grotesque for headers and scores — the scoreboard voice. Inter carries dense data and UI at small sizes where legibility is everything. The pairing contrasts on **proportion and role** (Archivo's sporting width vs Inter's neutral humanist body), not two near-identical sans fighting.

### Hierarchy
- **Display** (Archivo 800, `clamp(1.75rem, 5vw, 2.75rem)`, lh 1.05, tracking -0.02em): Screen titles ("Partidos", "Hoy"), the rare hero moment.
- **Title** (Archivo 700, 1.125rem, lh 1.2): Card titles, section headers, group names.
- **Score** (Archivo 700, 1.25rem, lh 1, tabular): Every goal number, the result, points. Tabular so columns align and digits don't jump.
- **Body** (Inter 400, 0.9375rem/15px, lh 1.5): Default text. Cap prose at 65–75ch (rare here; this is an app).
- **Label** (Inter 600, 0.75rem/12px, tracking 0.01em): Metadata, chips, dates, the L/E/V outcome letters.

### Named Rules
**The Tabular Score Rule.** Any number that represents a score, goal count, or point total uses tabular figures. Scores in a column must align digit-for-digit; non-tabular score columns are forbidden.

## 4. Elevation

Flat by default. Depth is structural, not decorative: the field is white with hairline borders, and shadow appears only on surfaces that genuinely lift above the page — the bottom tab bar, sticky day headers, and bottom sheets. No ambient drop shadows on resting cards (that's the legacy-prode and the 2014-app tell).

### Shadow Vocabulary
- **Lifted** (`box-shadow: 0 1px 2px oklch(0.22 0.015 152 / 0.06), 0 2px 8px oklch(0.22 0.015 152 / 0.08)`): The bottom tab bar and sticky headers — barely there, just enough to separate from scrolling content.
- **Sheet** (`box-shadow: 0 -8px 32px oklch(0.22 0.015 152 / 0.18)`): Bottom sheets rising over the backdrop. The only strong shadow in the system.

### Named Rules
**The Flat-At-Rest Rule.** Resting cards and rows have no shadow — separation is a hairline border or a subtle-surface band. Shadow is earned by lifting (sheet, sticky, tab bar), never used for "depth" decoration.

## 5. Components

### Buttons
- **Shape:** Gently rounded (12px, `{rounded.md}`).
- **Primary:** Pitch Green fill, white label, Inter 600 (label scale), 12×20px padding. The one strong call to action per context (Guardar predicción).
- **Hover / Focus:** Background → Pitch Green Deep; focus-visible → 2px Pitch Green ring at 2px offset. Transition 150ms ease-out.
- **Ghost / Secondary:** Transparent fill, Pitch Green Ink label, hairline border; for "Editar", "Invitar", low-emphasis actions.

### Chips (filters, group selector)
- **Style:** Pill (`{rounded.full}`), 6×14px. Unselected: Surface Subtle fill, Ink Muted text. Selected: Pitch Green fill, white text.
- **State:** Used for the Partidos filter (Todos / Por predecir / Resultados) and the multi-group selector. Horizontal row; if it overflows, the row scrolls — chips never wrap into a second cramped line.

### Cards / Containers
- **Corner Style:** 16px (`{rounded.lg}`).
- **Background:** Pure white surface.
- **Shadow Strategy:** None at rest (see Elevation). Hairline border for separation.
- **Border:** 1px Border Hairline.
- **Internal Padding:** 16px (`{spacing.lg}`); generous — the card breathes.

### Inputs / Score Steppers
- **Style:** Steppers are the primary input. Big +/− targets ≥44×44px, the goal number in Score type (tabular) between them.
- **Focus:** Pitch Green focus-visible ring; never remove the outline.
- **Disabled:** At lock (kickoff−5min) steppers drop to 40% opacity and show the locked state; the server is authoritative.

### Navigation — Bottom Tab Bar
- **Style:** Fixed bottom bar, white with the Lifted shadow and a top hairline. Three tabs: **Hoy · Partidos · Grupos**.
- **States:** Active tab → Pitch Green icon + label; inactive → Ink Muted. Label is Label scale. 44px min target each.
- **Mobile treatment:** This IS the mobile navigation; there is no separate desktop chrome for the MVP.

### Signature — Score Breakdown Row
The heart of a finished match. One spacious row, each datum once: home flag + code, the three outcome cells `[goles local] [L/E/V] [goles visitante]`, away code + flag, `Res A–B`, and the points badge. Each of the three cells is independently tinted — Pitch Green Tint + Pitch Green Ink with a ✓ when that part was correct, Miss Red Tint + Miss Red Ink with a ✗ when wrong. Color is never the only signal: the ✓/✗ glyph and the exact number/letter carry the meaning too. A pleno lifts the whole row to a Glory Gold ring + tint with the **PLENO ✦** badge.

### Signature — Pleno Badge
Glory Gold pill, Glory Gold Ink text, ✦ mark, "PLENO ✦ +7". The only place gold and the ✦ appear together. Mechanically special (7 > the 5 you'd get summing the parts), so it gets the visual crown.

## 6. Do's and Don'ts

### Do:
- **Do** keep the body background pure white (`oklch(1 0 0)`); carry warmth in pitch green, gold, and type.
- **Do** reserve Glory Gold for plenos and the podium only.
- **Do** make finished results glanceable — picks color-coded green/red with ✓/✗ and position, no tap-to-expand.
- **Do** use tabular figures for every score, goal, and point total.
- **Do** give cards and rows room to breathe (16px padding, hairline separation); density of *information*, not of *pixels*.
- **Do** keep touch targets ≥44px and a visible Pitch Green focus ring on every interactive element.
- **Do** put unbounded detail (full team history, a member's predictions) in a bottom sheet with vertical scroll.

### Don't:
- **Don't** rebuild the **amontonado legacy prode** (prodeenlinea-style): no cramped illegible tables, no everything-fighting-for-space. Take the data density, drop the clutter.
- **Don't** ship the **generic gray SaaS dashboard**: no default-shadcn slate, no soulless neutral, no cold corporate dashboard feel.
- **Don't** use light "elegant" gray for body or muted text — it fails contrast; muted text is `oklch(0.46 0.012 152)` or darker.
- **Don't** use a colored `border-left`/`border-right` greater than 1px as a side-stripe accent on cards, rows, or alerts. Encode outcome with cell tint + ✓/✗ + the points badge, not a side stripe.
- **Don't** put scores or unbounded lists in a horizontally-scrolling strip inside a card — vertical sheet or wrap; horizontal scroll inside cards is banned (it fights the page and dies on mobile).
- **Don't** drop shadows on resting cards; flat at rest, lift only sheets/sticky/tab bar.
- **Don't** tint the surface warm (no cream/sand/parchment) or add hidden chroma to white.
- **Don't** spend gold on anything that isn't a pleno or the podium.
