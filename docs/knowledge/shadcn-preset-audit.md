# Shadcn preset migration

ThreatForge runs React on Vite. The editor and native Tauri shell share the same
frontend. The shadcn Vite preset command generated Base UI Rhea, neutral surfaces
with an emerald action color, Figtree body text, Outfit headings, Tabler icons,
zero base radius, subtle menus, and pointer cursors for enabled buttons. The
interoperability reference is [shadcn/ui](https://ui.shadcn.com/docs); see the
[editor design references](editor-design-references.md) for accessibility and
layout guidance.

## Before the migration

Captured the editor at 1440 × 900 in light and dark, at 1× and 2×. The key
findings cover the empty workspace and release notes, document toolbar/status,
library, populated canvas, Properties (component/appearance/flow/boundary),
Architecture, Threats, AI, Settings, command menu, and Presentation.

| Surface | Finding / migration criterion |
| --- | --- |
| Empty workspace and document toolbar | Separate primary/secondary action styles and hand-rolled icon buttons disagree on padding and hover behavior. Use the same button variants without making every action primary. |
| Library | The search field feels heavier than its surrounding chrome. Give search an inset icon and a consistent input surface; retain keyboard scrolling and drag. |
| Canvas and presentation | The grid, component accents, and editable geometry carry information. Keep those, and keep export styling independent of the editor's new typeface. |
| Inspector | Text tabs compete with the selection title and widen unevenly. Use equal icon targets, keyboard-focus and pointer tooltips, persistent accessible names, and a threat count. The detail controls should keep their existing shared value alignment. |
| Threats, AI, Settings | Different default/outline buttons, toggles and number badges create competing emphasis. Use shared primitives for controls whose behavior matches. |
| Menus, dialogs, and status | Maintain keyboard ordering, focus restore, modal cancel, native close-guard layering, and all persistent state cues while changing the styling. |

## Revisions

| Surface | Resolution |
| --- | --- |
| Empty workspace, documents, and toolbar | Use the Rhea Button for the primary and secondary empty-state actions and the toolbar's equal-sized Tabler targets. New, open, save, rename, and export keep their existing file handlers. |
| Library and controls | Use Rhea Input with an inset search icon. Keep native selects and the keyboard-reachable list. Settings use Rhea Switch and Input without replacing the native dialog or its dismissal logic. |
| Canvas, selection, and presentation | Give chrome neutral surfaces and emerald state cues. Keep the dot grid, Inter diagram labels, stored element colors, and independent Inter SVG/PNG renderer. |
| Inspector | Use Rhea Tabs and Tooltip with four equal-width Tabler icons. Tooltips appear on hover and focus. The count is visible on Threats and announced separately from the tab name. Panels keep their own scroll and their previous alignment. |
| Threats and AI | Share the secondary STRIDE action and outlined API-key entry button. Do not alter analysis, key storage, or chat flows. |
| Menus, dialogs, TM7, and status | Use the preset's colors, typography, and square editor chrome. Keep the existing native modal, context-menu portal, importer, and status wiring. |

The primary button keeps an opaque hover fill for contrast. The Tailwind merge
configuration recognizes the editor's text-size roles so they don't displace
foreground colors when composed with a shadcn primitive.

## Capture index

The browser captures use `editor-v6-shadcn-{before,after}-{light,dark}-{1,2}x-<surface>.png`
under `~/.devin-files/screens/`. Each phase includes 24 views at each mode and
scale: `whats-new`, `empty`, `new`, `workspace`, `rename`, `saved`, `library-search`,
`library-drag`, `inline-edit`, `context-menu`, `properties`,
`properties-appearance`, `properties-flow`, `properties-boundary`,
`architecture`, `threats`, `ai`, `ai-key-setup`, `settings`, `command-menu`,
`presentation`, `presentation-export`, `tm7-import`, and `missing-sidecar`.
Desktop filesystem sync, conflict, and the native dirty-window prompt are not
represented by the browser's missing-sidecar view.
