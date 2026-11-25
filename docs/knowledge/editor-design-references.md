# Editor design review references

These are working notes for the [editor design system](design-system.md), not a copy of the upstream
guidelines. Apply them to the editing workflow rather than transplanting another product's appearance.

| Source | Guidance used in ThreatForge |
| --- | --- |
| [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) | Test keyboard and visible focus, label icon actions and inputs, size targets independently of their glyphs, prevent overlays from obscuring focus, and test long labels and reduced motion. Keep numeric readouts stable with tabular figures. |
| [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | Ground visual decisions in what the product is for. Here, the architecture drawing is the work; surrounding panes should resemble a drawing editor's tools, not an interchangeable dashboard. Reuse bundled type suited to that job rather than adding a novel font for its own sake. |
| Apple HIG [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), and [Inspectors](https://developer.apple.com/videos/play/wwdc2023/10161/) | Maintain hierarchy when text enlarges, align related information at shared insets, and keep the source list and trailing inspector subordinate to the canvas. Use regular/medium weights rather than thin text to make the chrome quieter. |
| Apple HIG [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Keep closely related views in one coherent control with consistent labels. Convey selection without color alone, support larger text and verify contrast across appearances. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | Check text resizing and reflow (1.4.4, 1.4.10), text and non-text contrast (1.4.3, 1.4.11), keyboard operation and visible, unobscured focus (2.1.1, 2.4.7, 2.4.11), and alternatives to dragging and 24 CSS px target minimum (2.5.7, 2.5.8). A diagram can need two-dimensional space; that exception does not apply to its controls. |
| [Repo design doctrine](../../.e0l/first-principles/design.md) | Function decides form. Remove marks that do not help the next task, use one neutral spine plus purposeful accent, and keep 44 px as the ergonomic target rather than treating the AA floor as the preferred size. |

Automated axe checks expose specific regressions, not conformance by themselves. Pair them with real
interaction checks and matched images. Device scale tests rasterization; browser or text zoom tests
reflow. One is not evidence for the other.
