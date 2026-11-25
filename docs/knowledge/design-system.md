# ThreatForge editor design system

ThreatForge should feel like a native desktop drawing tool: the diagram is the subject; the chrome
helps you orient, edit, and get out of the way. Use the hierarchy of a macOS workspace and the
grouping of an iOS form, not a simulation of either platform. Prefer aligned edges, plain language,
and clear states to visual decoration. No Material UI, glass effects, gradients, or decorative
outlines. Keep editor chrome opaque unless a toolbar or sidebar needs slight translucency to
communicate layering; do not blur the diagram behind it.

## Typography

- Editor UI: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`.
  Bundle [Inter 4.1](https://github.com/rsms/inter/releases/tag/v4.1) under the SIL Open Font License.
  Use its upright variable WOFF2 for the editor and self-contained SVG, and the release's static
  400/500/600 TTF faces for resvg. Do not fetch fonts from a CDN or ship an Apple font.
  Apply Inter's `cv11` to editor text and its open digits (`ss01`) and tabular width (`tnum`)
  to numeric readouts. The landing page keeps its separate typography.
- IDs, code, and paths when precision matters:
  `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`.
  Use tabular figures for counts, percentages, and numeric fields; a count does not need monospace.
- Implement the full ramp as named Tailwind roles (`text-editor-caption2` through
  `text-editor-title2`), not isolated font sizes and weight overrides. Values below are CSS pixels
  at a 16 px root; use rem for sizes and leading. These are desktop web values, not Apple's native
  point sizes. Keep browser text zoom enabled. Rows grow or stack when text no longer fits.

| Role | Size / line | Weight | Tracking | Use |
| --- | ---: | ---: | ---: | --- |
| Caption 2 | 11 / 16 | 500 | 0 | Count pills, shortcut glyphs, compact segmented labels; never instructions |
| Caption | 12 / 16 | 400 | 0 | Diagram metadata, status bar, helper text and IDs |
| Footnote | 13 / 18 | 500 | 0 | Field labels, list section labels, one-line connector labels |
| Body | 14 / 20 | 400 | 0 | Rows, controls, tooltips, inspector values and descriptions |
| Headline | 14 / 20 | 600 | 0 | Node titles, current document, inspector section headers |
| Title 3 | 18 / 24 | 600 | -0.015em | Panel and dialog titles |
| Title 2 | 24 / 32 | 600 | -0.02em | Empty workspace title or an equivalent top-level heading |

Use sentence case for prose and controls. Use weight to make the next thing to read obvious, not to
make every label prominent. Truncate unbounded one-line names only when the full text remains
available to both pointer and keyboard users (for example, in the inspector).

## Color and contrast

Use semantic `editor-*` roles. A blue interaction accent is distinct from the brand mark and from
document-defined colors; only use red, orange, and green for meaningful states. Light and dark
recipes below are the reference for the standard editor appearances. Preserve preset selection
and use preset-aware surface and ink aliases for alternate appearances rather than painting one
fixed background behind all themes.

| Editor role | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `label` | `#16181C` | `#F3F5F7` | Primary text and icons |
| `secondary-label` | `#505863` | `#B6BEC9` | Metadata and secondary actions |
| `tertiary-label` | `#606973` | `#9EA8B6` | Hints, placeholder text, quiet captions |
| `grouped-background` | `#F3F5F8` | `#14161B` | Sidebar and inset form surround |
| `surface` | `#FFFFFF` | `#1D2026` | Toolbar, cards, inset form rows |
| `raised` | `#FFFFFF` | `#262B33` | Popovers and dialogs |
| `canvas` | `#F7F8FA` | `#171A20` | Diagram workspace |
| `separator` | `#CFD4DC` | `#373D48` | Decorative hairlines; not a control's only visual cue |
| `outline` | `#828B98` | `#747F90` | Control or diagram outline when shape is meaningful |
| `fill` / `hover` / `pressed` | `#F1F3F6` / `#EBEEF3` / `#E1E6EE` | `#252A32` / `#292F39` / `#333B48` | Neutral control state tiers |
| `selection` | `#EAF3FF` | `#243952` | Selected rows and tinted buttons |
| `accent` / `on-accent` | `#005CC8` / `#FFFFFF` | `#79B8FF` / `#111318` | Links, focus and filled primary actions |
| `danger` / `warning` / `success` | `#B42338` / `#944A06` / `#197248` | `#FF9AA5` / `#FFC078` / `#75D9A2` | Error/destructive, caution, success |
| `action` | `#005CC8` | `#0064D2` | Filled STRIDE action with white text in either theme |
| `canvas-dot` | `#AEB9C8` | `#647081` | Decorative grid only |

Use [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): 4.5:1 for
normal text and 3:1 for [required non-text cues](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), including
focus indicators. The reference tertiary ink reaches 5.11:1 on light grouped background and
6.78:1 on dark surface; the selected row pairs reach 5.58:1 and 5.67:1, respectively. Filled-action
ink reaches 6.24:1 in light and 8.95:1 in dark. Check actual adjacent backgrounds, including
hover, raised surfaces, and any preset overrides; these sample numbers do not certify every
component. Increase separator/outline contrast for `prefers-contrast: more`; honor forced colors
for essential cues. Never make color the only signal for selection, severity, group identity, or errors.

### Diagram palette

Use the eight suggested hues for diagram marks, not app navigation. The tuned marks reach at
least 4.85:1 against their reference canvas before opacity is applied. Use the UI label colors for
text. Reserve a solid mark for the identifying dot; an outline or fill may be quieter when the
name and dot already communicate the container. Keep existing explicit colors; never modify
stored `.thf` colors on theme change or export.

| Hue | Light canvas | Dark canvas |
| --- | --- | --- |
| Blue | `#286CC2` | `#7CB5F6` |
| Indigo | `#6657B7` | `#ACA2F4` |
| Violet | `#893FA8` | `#CF91E9` |
| Rose | `#B44675` | `#E58FB4` |
| Copper | `#A15024` | `#E4A17A` |
| Ochre | `#846313` | `#DCC46F` |
| Green | `#24774D` | `#79C897` |
| Teal | `#217781` | `#73C5CC` |

## Metrics, motion, and symbols

- Layout: 4 px micro grid and 8 px rhythm. Use 4 px within a compact label or icon group, 8 px
  between related controls, 12–16 px at panel edges, and 24–32 px between topics. Align headers,
  row labels, and field edges across adjacent surfaces. Standard buttons and rows are at least
  32 px high; coarse-pointer controls target 44 px where space permits.
- Shape: 6 px for small controls, 10 px for grouped rows and nodes, 14 px for dialogs. Use nested
  radii that decrease with inset; avoid pills except for counts. Draw a 1 px separator once, not
  two adjacent borders. No shadows on resting rows, buttons, or nodes.
- Elevation: popover `0 4px 16px rgb(0 0 0 / 0.15)`; modal
  `0 16px 48px rgb(0 0 0 / 0.24)`. Pair overlays with a quiet outline; no extra shadow tier.
- Motion: 120 ms for hover and press, 180 ms for disclosure, 220 ms for a dialog transition;
  use `cubic-bezier(0.2, 0.65, 0.3, 1)`. Under reduced motion, remove translation, scaling, and
  continuous decoration; keep immediate state feedback.
- Focus: 2 px accent outline, 2 px offset, visible for keyboard focus and not clipped by scroll
  containers. On a filled accent control separate the ring from the fill with a surface gap.
- Iconography: Lucide only for editor actions. Use 16 px icons in equal 32 px toolbar targets
  and for inline actions, with 1.5 px rendered stroke (Lucide's absolute stroke option); match the weight
  and optical center of adjacent text. Use one metaphor per action across surfaces. Icons beside
  labels are decorative; icon-only controls need an accessible name and a tooltip with shortcuts.
  Diagram component glyphs and product marks are content, not alternate action icon sets.

## Component recipes

| Component | Pattern |
| --- | --- |
| App shell and toolbar | One quiet 48 px strip. Separate command groups with short hairlines, not a border around each icon. Keep navigation stable with overflow titles; do not repeat shortcut hints under buttons. |
| Sidebar library | Source list, not a card grid. Use category headers and 36 px minimum rows with aligned glyph and single-line label. Use description in a tooltip or details, not a second row. Keep drag/drop and keyboard discovery. |
| Inspector segments | Equal-width segments in one inset track, selected as a surface or tinted fill. Use consistent text-first labels; add icons only if the whole control uses them. Keep all four labels readable at the default width. Conserve space by moving counts out of the segment when necessary, not clipping labels. Expose selected state to assistive tech. |
| Document tabs | One row, underline or inset selection (not both); preserve close and pin targets, the existing keyboard model, and access to full names. Do not conflate document tabs with inspector segments. |
| Inspector fields | Inset groups with a headline above, 8 px before the first row and 24 px between groups. Rows share one surface and internal hairlines. Place short label and control on a shared baseline, using stacked rows for long content or narrow panes. Use one compact inline color/opacity row with a named reset. |
| Text inputs and selects | Use body type, an opaque fill and a clear focus boundary. Labels remain visible while typing; placeholders only provide examples. Align select chevrons to the right, with no second outline. |
| Buttons | Plain for secondary and toolbar actions; tinted for selection or a secondary call to action; filled accent for the primary action in a decision group. Keep destructive actions labeled, not just colored. |
| AI and threat panels | Same type and inset rows as the inspector. One panel title, readable Body copy, and Footnote metadata. Use semantic color for approval/error or severity, with words and glyphs as needed; do not turn messages or list items into stacks of decorative cards. |
| Popovers and dialogs | One raised surface, one heading, at most one primary action. Use grouped rows for settings, hairlines only where structure needs them, and visible keyboard focus. Respect scroll, escape, and existing focus restoration. |
| Empty state and onboarding | One quiet title, brief explanation, and clear create/open actions. Keep the starter templates scannable with aligned labels, not a gallery of promotional cards. |
| Presentation | Diagram takes precedence; use a restrained header with title, export, and close, no editing chrome. |
| Status bar | Caption type and tabular figures. One save state; keep sync conflicts and storage errors readable. Separate unrelated items with spacing and only necessary separators. |

## Canvas and export

- Keep the existing zoom-scaled dot grid: nominal 1 px diameter at 100% zoom, every 20 world px.
  Use the dedicated light/dark `canvas-dot` token, not a chrome separator or an accent. The grid
  should be visible on an empty canvas at normal zoom without competing with diagram edges.
- Use at least 48 world px inside containers and 96 px between siblings in the shipped fixture
  and templates. Do not reflow imported documents or change saved geometry. Standard nodes
  start at 208 × 72 px; use a headline, one quiet secondary line, and a compact count pill.
- Group interiors are transparent; boundary fills never exceed 3% opacity. Use a thin outline
  (dashed for a trust boundary), plain top-left label and dot. In dark mode, blend the outline
  and dot ink with 24% label color to keep dark document colors legible without writing them
  back to the document. Resize affordances appear on hover or applicable selection, without
  reducing existing hit areas.
- Use thin, neutral 1.25 px connector strokes, an accent on selection, and compact labels that
  avoid nodes; arrows and lock glyphs retain directional and authentication meaning. The minimap
  is off by default and available in zoom controls; use neutral nodes and readable container
  outlines without depending on palette colors.
- Browser and MCP share the Rust scene renderer and produce byte-identical SVG/PNG for equivalent
  documents and options. Keep the neutral light presentation/export background, preserve explicit
  node colors and use the same understated container geometry and typography hierarchy. Do not
  depend on the browser's installed fonts for PNG rendering or include editor-only grid/handles.

## Sources and design decisions

- **Apple HIG:** [Typography](https://developer.apple.com/design/human-interface-guidelines/typography.md)
  for named styles, typographic hierarchy, and Dynamic Type behavior;
  [Color](https://developer.apple.com/design/human-interface-guidelines/color.md) and
  [Materials](https://developer.apple.com/design/human-interface-guidelines/materials.md) for
  semantic color and restrained layer separation;
  [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols.md) for
  matching icon weight and scale to type;
  [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars.md),
  [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables.md)
  and [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls.md)
  for shallow source lists, visual grouping, and equal inspector choices.
  [Inspectors in SwiftUI](https://developer.apple.com/videos/play/wwdc2023/10161/) shows the
  trailing inspector beside the selected work. Borrow the principles, not Liquid Glass,
  proprietary glyphs, or mobile point sizes.
- **[Vercel Geist Typography](https://vercel.com/geist/typography) and
  [Colors](https://vercel.com/geist/colors):** named styles, single-line labels distinct from
  reading copy, tabular counts, and borders drawn once.
- **[Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale):**
  distinct roles for surfaces, interaction fills, borders, and readable ink; our ratios use WCAG,
  not Radix's APCA scale targets.
- **[Linear's interface redesign](https://linear.app/now/how-we-redesigned-the-linear-ui):**
  align navigation, tabs, headers and panels across full workflows rather than styling each in
  isolation. Check both sparse and dense workspaces.
- **[Raycast's native/web design notes](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast):**
  consistent hover, bounded popovers and keyboard behavior contribute as much as visual styling.
- **[Things](https://culturedcode.com/things/features/) and [Craft](https://www.craft.do/for/writers):**
  keep detail available but quiet in the default view; let focused presentation remove the
  editing controls rather than decorate the content.
