---
name: Obsidian Glass Gallery
colors:
  surface: '#111319'
  surface-dim: '#111319'
  surface-bright: '#373940'
  surface-container-lowest: '#0c0e14'
  surface-container-low: '#191b22'
  surface-container: '#1e1f26'
  surface-container-high: '#282a30'
  surface-container-highest: '#33343b'
  on-surface: '#e2e2eb'
  on-surface-variant: '#c6c5d5'
  inverse-surface: '#e2e2eb'
  inverse-on-surface: '#2e3037'
  outline: '#908f9e'
  outline-variant: '#454653'
  surface-tint: '#bdc2ff'
  primary: '#bdc2ff'
  on-primary: '#131e8c'
  primary-container: '#818cf8'
  on-primary-container: '#101b8a'
  inverse-primary: '#4953bc'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#b8c4ff'
  on-tertiary: '#1a2b6a'
  tertiary-container: '#8392d7'
  on-tertiary-container: '#182968'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bdc2ff'
  on-primary-fixed: '#000767'
  on-primary-fixed-variant: '#2f3aa3'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#dde1ff'
  tertiary-fixed-dim: '#b8c4ff'
  on-tertiary-fixed: '#001354'
  on-tertiary-fixed-variant: '#334282'
  background: '#111319'
  on-background: '#e2e2eb'
  surface-variant: '#33343b'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1.25rem
  margin: 1rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system sets an ultra-premium, cinematic tone tailored for curated media libraries. It caters to discerning creators, photographers, and visual enthusiasts who expect personal archives to feel as elevated as a luxury physical exhibition or private viewing room.

The aesthetic fuses **Minimalist Dark Mode** with **Refined Glassmorphism**:
- The emotional tone evokes calm focus, luxury, and intimacy. Interfaces step back into near-void obsidian, letting high-fidelity photography and video take complete center stage.
- Translucent frosted glass layers (`backdrop-filter: blur(20px)`) float delicately above media canvases, giving depth without visual noise.
- Tactile, jewel-like violet-indigo luminous accents guide key interactions, offering soft luminescence rather than harsh alerts.
- Interactions are frictionless, deliberate, and fluid, reinforcing an archival, high-end studio atmosphere.

## Colors

The palette is engineered around deep obsidian and slate depths to maximize optical dynamic range for colorful imagery.

### Role Assignments & Application
- **Primary (`#818cf8`)**: Used for luminous focal indicators, primary action icons, selected states, and glow drop-shadows.
- **Secondary (`#6366f1`)**: Powers directional gradients, active toggles, and layered interactive depths.
- **Tertiary (`#a5b4fc`)**: Delivers high-contrast soft highlights, text accents, and micro-badges.
- **Neutral Canvas (`#0b0d13`)**: The deepest root background.
- **Layering Neutrals**:
  - `Surface 1 (Base Container)`: `#131722`
  - `Surface 2 (Elevated Panels)`: `#1b2130`
  - `Surface Glass`: `rgba(19, 23, 34, 0.72)` with a 1px border of `rgba(255, 255, 255, 0.08)`.
- **Text Tiers**:
  - High-emphasis text: `#f8fafc` (96% contrast).
  - Medium-emphasis text: `#94a3b8` (Slate 400).
  - Subtle/Metadata text: `#64748b` (Slate 500).

## Typography

The typography leverages **Plus Jakarta Sans** across all roles to achieve a balance between geometric precision and warm, welcoming clarity.

- **Display & Headlines**: Tightly tracked (`-0.015em` to `-0.03em`) with prominent weights (600, 700) to introduce album titles, metadata headers, and memory timelines with editorial grandeur.
- **Body Hierarchy**: Neutral tracking with relaxed line heights ensures EXIF details, asset timestamps, and descriptions remain legible over dark backdrops.
- **Labels & Micro-data**: Slightly expanded tracking (`0.01em` to `0.04em`) in medium and bold weights ensures readability on compact badges, scrubber timestamps, and floating controls.

## Layout & Spacing

The layout is built mobile-first with a fluid grid, transitioning smoothly to multi-column desktop masonry:

- **Mobile Viewport (< 640px)**: A 4-column fluid layout with dynamic aspect-ratio masonry grids (2 or 3 items across). Uses tight `0.75rem` gutters and `1rem` outer canvas padding to maximize screen real estate for photos.
- **Tablet / Large Mobile (640px – 1024px)**: 8-column layout with 4-5 media columns, `1rem` gutters, and `1.5rem` margins.
- **Desktop Viewport (> 1024px)**: 12-column fixed-max layout (capped at 1440px width) with `1.25rem` gutters and `2.5rem` side margins, ensuring wide-screen browsing retains an intimate gallery feel.
- **Safe Areas**: Bottom margins incorporate dynamic environment safe areas (`env(safe-area-inset-bottom) + 5rem`) to accommodate the floating frosted navigation bar without overlapping media elements.

## Elevation & Depth

Visual depth is achieved through layered frosted glass, low-contrast ghost borders, and soft violet ambient back-glows:

- **Surface Layering**:
  - `Level 0 (Canvas)`: Solid `#0b0d13`.
  - `Level 1 (Card & Group Background)`: Solid `#131722` or `#1b2130`.
  - `Level 2 (Floating Glass Layers)`: `rgba(19, 23, 34, 0.72)` combined with `backdrop-filter: blur(20px) saturate(180%)`.
  - `Level 3 (Overlays & Modals)`: `rgba(11, 13, 19, 0.85)` with `backdrop-filter: blur(28px)`.
- **Borders & Seams**: Structural boundaries employ a delicate hairline `1px solid rgba(255, 255, 255, 0.08)`. For hovered or active elements, the border transitions to `rgba(129, 140, 248, 0.35)`.
- **Ambient Glow Shadows**:
  - Standard floating elements: `0 8px 32px -4px rgba(0, 0, 0, 0.6)`.
  - Focused/Active elements: Dual shadow composed of `0 8px 24px -2px rgba(0, 0, 0, 0.8)` and a soft ambient glow `0 0 20px 2px rgba(129, 140, 248, 0.22)`.

## Shapes

The interface balances soft geometry with modern pill contours:

- **Base Radius (`roundedness: 2`)**: Standard inputs, inner containers, and action panels adopt `0.5rem` (8px).
- **Media & Album Cards (`rounded-2xl`)**: Feature an expansive `1rem` to `1.25rem` corner radius, softening image silhouettes and framing photo content.
- **Pill Elements (`rounded-full`)**: Applied universally to interactive badges, category filter chips, search pills, and the floating bottom navigation bar to provide friendly, tactile ergonomics.

## Components

### Buttons
- **Primary**: Pill-shaped or rounded-xl, filled with linear gradient (`from #818cf8 to #6366f1`), high-contrast text (`#ffffff`), and a subtle luminous glow shadow. Active states apply scale compression (`scale-98`).
- **Glass / Secondary**: Translucent `rgba(255, 255, 255, 0.05)` fill, `1px solid rgba(255, 255, 255, 0.08)`, and text in `#f8fafc`.
- **Tactile Icon Button**: Compact 40x40px or 44x44px frosted circles (`rounded-full`) with centered glyphs, designed for quick one-handed tapping (favorite, share, metadata toggle).

### Chips & Filter Pills
- Floating pill containers (`rounded-full`) with padding `0.375rem 0.875rem`.
- Inactive: Frosted background (`rgba(255, 255, 255, 0.04)`), text in `#94a3b8`.
- Active: Elevated violet background (`rgba(129, 140, 248, 0.16)`), glowing text in `#818cf8`, and a crisp perimeter border `rgba(129, 140, 248, 0.4)`.

### Cards & Media Cells
- Enclosed with `rounded-2xl`, overflow hidden, and a 1px border `rgba(255, 255, 255, 0.06)`.
- Asset thumbnails feature a progressive dark gradient overlay at the bottom for metadata readability (duration pill, favorite heart, resolution badge).
- Video thumbnails include a micro frosted glass duration badge (`backdrop-blur-md`, `rgba(0, 0, 0, 0.45)`).

### Input Fields & Search Bars
- Pill or rounded-xl containers with deep slate glass background (`rgba(19, 23, 34, 0.6)`), 1px boundary border, and high inner padding (`0.75rem 1.25rem`).
- Focus states invoke a 1px ring of `rgba(129, 140, 248, 0.5)` with an ambient violet bloom.

### Floating Bottom Navigation
- Anchored 1rem above viewport edge, centered, with `rounded-full` pill architecture.
- Crafted with ultra-dense frosted glass (`rgba(19, 23, 34, 0.8)` + `blur(24px)`), hairline top-lit border (`rgba(255, 255, 255, 0.1)`), and internal padding `0.5rem 1rem`.
- Active destination is marked with an animated luminous pill backdrop (`rgba(129, 140, 248, 0.2)`) and illuminated icon tint (`#818cf8`).

### Media Scrubber & Sliders
- Minimalist track in `rgba(255, 255, 255, 0.12)`, active progress fill with `#818cf8`, and a luminous thumb with `box-shadow: 0 0 10px rgba(129, 140, 248, 0.8)`.