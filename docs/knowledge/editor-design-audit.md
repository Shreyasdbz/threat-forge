# Editor design audit

Baseline: `fd5d32f`, canonical architecture fixture, Chromium at 1440 × 900, light/dark
and device scale 1×/2×. The matched evidence is named
`editor-v6-{before,after}-{light,dark}-{1,2}x-<surface>.png`. Device scale and zoom are
separate checks. The [acceptance checklist](design-system.md#sources-and-design-decisions)
defines the review criteria.

| Surface | Baseline finding | Design response |
| --- | --- | --- |
| Toolbar and document tabs | The filename, dark-weight counts and leading brand mark compete. Narrow widths leave too little room for the actual commands. | Use medium title weight, regular readouts and a narrower-layout command arrangement; retain stable targets and accessible names. |
| Library | Headings are quieter than the body but the generic rows and library controls use different insets. Search depends on a placeholder for its name. | Align the two groups; name search independently of its hint and keep the existing keyboard-scrollable list. |
| Canvas nodes, edges and groups | Node names are nearly as heavy as the selected inspector heading. Group outlines and captions already identify containment and should not be redesigned as cards. | Lower node title weight, keep caption optical metrics, preserve saved geometry and colors, and size the edge label target independently of its copy. |
| Inspector navigation | Stacked icons and labels give every tab the visual weight of a tile. At narrow widths labels can crop, and pressed buttons don't expose a tab/panel relationship. | Use a single line of regular-weight labels, a quiet selection rule, responsive wrapping, and keyboard-operable tabs with named panels. |
| Properties: element, connection, boundary | The element title and blue symbol dominate the pane; grouping labels and control insets are already aligned. Connection and boundary start directly with fields. | Quiet the selected-element header; preserve the useful inset grouping and short-field rows across all three forms. |
| Architecture, threats, AI | Panel headings compete with the tabs. Architecture repeats the tab symbol, and threats already state severity and mitigation in text; keep those meaningful cues. | Use one shared panel title style with no redundant Architecture glyph; keep the threat action and AI setup distinguishable from readouts. |
| Status bar | Compact, stable numbers work well, but fixed height is brittle when sync messages need to wrap. | Let status content grow while preserving the existing save/sync notices and prioritizing them over ancillary readouts. |
| Settings, command menu, first run | Settings and the command surface look modal but do not expose that relationship; command focus outlines only the input interior. The release notes should not require reading before regular editing. | Use native modal focus behavior for Settings and commands. Keep the dismissible release notes and verify first-run placement; don't mix onboarding changes into the inspector. |
| Presentation | Neutral export background and reduced chrome work in both themes. The preview is document content, not a reason to invert exported colors. | Preserve render colors and export parity; quiet only the presentation chrome hierarchy. |
| Empty workspace and panels | Starter choices are useful but the title and buttons compete with the template browser. The inspector's empty selection already gives a specific next step. | Reserve the strongest UI heading for the welcome state; make secondary actions medium weight rather than another title. |
