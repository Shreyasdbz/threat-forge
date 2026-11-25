# Editor design system

The canvas is the focus. Use a quiet surface for the workspace, a slightly
different surface for tools, and a single divider between regions. Prefer
alignment and space to boxes around individual items.

| Token | Use |
| --- | --- |
| Tailwind spacing (4 px at the default text size) | 4 px within a label, 8 px between related controls, 16 px for panel insets, 24–32 px between sections |
| `text-editor-small` and `text-editor-body` | 12/16 px for metadata, 14/20 px for controls and body text |
| `text-editor-heading` and `text-editor-title` | 18/24 px for section headings, 28/32 px for the empty workspace title |
| `editor-surface`, `editor-canvas`, `editor-hover` | Preset-aware neutral surfaces; retain the user's light or dark theme |
| `editor-line` and `editor-outline` | Quiet structural dividers and a stronger line for diagram geometry |
| `editor-accent` and `editor-selection` | Selected items, focus and primary actions; not decoration |
| `rounded-editor-control`, `rounded-editor-panel`, `shadow-editor-dialog` | 6 px controls, 12 px dialogs, elevation only for overlays |

Use Source Sans 3 at regular (400) and semibold (600). Editor controls use
16 px Lucide icons with the standard stroke; component-library glyphs are domain
symbols, not control icons. Keep shortcuts available in button labels and the
shortcuts dialog rather than repeating them under icons. Error, warning and
success colors are for states, never for routine navigation.

SVG and PNG exports share the Rust renderer and a neutral light background for
legibility outside the editor. Explicit document colors survive export; default
groups are unfilled and default nodes and flows use the neutral diagram palette.
Browser and MCP must render identical bytes for the same document and options.
