# ThreatForge — `.thf` File Format

The `.thf` file format is ThreatForge's primary differentiator. It is the product's moat.

## Design Principles

1. **Human-readable** when opened in any text editor
2. **Minimal, clean diffs** when tracked in git
3. **Schema-validated** for tooling interoperability
4. **Single-file** — all data lives in one `.thf` file, no sidecars needed

## Schema Structure

All data lives in a single `.thf` YAML file:

```
version → metadata → layers → groups → elements → data_flows → relationships
        → trust_boundaries → threats → diagrams
```

| Section | Purpose |
|---------|---------|
| `version` | Schema version (`"1.0"` for ordinary documents; `"1.1"` enables typed sequence views). Always first field. |
| `metadata` | Title, author, dates, description, authoring info |
| `layers` | Optional architecture layers; display order is array order |
| `groups` | Optional architecture containers; may nest via `parent` |
| `elements` | DFD nodes: processes, data stores, external entities, text annotations |
| `data_flows` | Connections between elements with protocol and data info |
| `relationships` | Optional non-data architecture edges (`deploys_to`, `depends_on`, …) |
| `trust_boundaries` | Security boundary groups containing elements |
| `threats` | STRIDE threats linked to elements/flows |
| `diagrams` | Diagram definitions with viewport state |

### Architecture sections and threat analysis

The architecture sections are an overlay on the threat model, and four rules keep
the two coherent:

- **Membership is element-side.** An element opts into a layer or group through
  `elements[].layer` / `elements[].group`; `trust_boundaries` remain the only
  container-side membership (`contains`). Both references are validated on read.
- **Relationship endpoints are element IDs only**, matching `data_flows`. A typed
  edge to a group or layer is not representable today; supporting it would be an
  additive schema change.
- **Relationships are never STRIDE-analyzed.** They are non-data edges, and
  running flow-targeted rules over them would manufacture tampering and
  information-disclosure findings on edges that carry no data. Pinned by
  `architecture_sections_do_not_change_stride_output` (Rust) and its
  `stride-engine.test.ts` mirror.
- **Threats attach to `element` or `flow` only.** A threat on a group or layer
  would be ambiguous — all members, or the container? — so the schema does not
  allow it.

`metadata.threat_analysis_enabled` is tri-state and resolves as: `true`/`false`
when present; when absent, a document is treated as threat-analysis-enabled iff
it has any `threats`. Nothing gates on the field yet — the resolution helper
ships with the workflow work in #58, and both language implementations must
follow this rule.

### Layout Data

Layout data (positions, sizes, colors, viewport) is stored **inline** on each entity:

- `elements[].position` — `{x, y}` canvas position
- `elements[].size` — optional `{width, height}` layout dimensions; omitted for default sizing
- `trust_boundaries[].position` — `{x, y}` canvas position
- `trust_boundaries[].size` — `{width, height}` boundary dimensions
- `trust_boundaries[].fill_color`, `stroke_color`, `fill_opacity`, `stroke_opacity` — visual styling
- `data_flows[].label_offset` — `{x, y}` dragged label offset
- `data_flows[].source_handle`, `target_handle` — connection point handles
- `data_flows[].stroke_color`, `stroke_opacity` — connector color
- `diagrams[].viewport` — `{x, y, zoom}` canvas viewport

### Legacy sidecar migration

Current files store layout inline and require no sidecar. Older models may reference
`.threatforge/layouts/*.json` through `diagrams[].layout_file`. On desktop open, the Rust backend
reads an available legacy sidecar and merges its positions and viewport into the in-memory model.
If the sidecar cannot be loaded, you can still open the model, but desktop Save and Save As
refuse to replace the missing layout with fallback geometry. Restore the sidecar and reopen
the model before saving. Once loaded, Save writes the layout inline and omits `layout_file`.
Save As can also write a new file from a snapshot whose layout was loaded, even if the source
model has changed on disk.

## Full Example

```yaml
# ThreatForge Threat Model
version: "1.0"
metadata:
  title: "Payment Processing Service"
  author: "Alex Chen"
  created: 2026-03-15
  modified: 2026-03-20
  created_by: "Alex Chen <alex@example.com>"
  modified_by: "Alex Chen <alex@example.com>"
  last_edit_timestamp: 1742486400
  description: |
    Threat model for the payment processing microservice
    that handles credit card transactions via Stripe API.

elements:
  - id: web-app
    type: process
    name: "Web Application"
    trust_zone: internal
    description: "React frontend served via CDN"
    position:
      x: 100
      y: 200

  - id: api-gateway
    type: process
    name: "API Gateway"
    trust_zone: dmz
    technologies: [nginx, rate-limiting]
    position:
      x: 400
      y: 200

  - id: payment-db
    type: data_store
    name: "Payment Database"
    trust_zone: internal
    stores: [transaction_records, tokenized_card_data]
    encryption: AES-256-at-rest
    position:
      x: 700
      y: 200

  - id: stripe-api
    type: external_entity
    name: "Stripe API"
    trust_zone: external
    position:
      x: 700
      y: 400

data_flows:
  - id: flow-1
    from: web-app
    to: api-gateway
    protocol: HTTPS/TLS-1.3
    data: [user_input, payment_request]
    authenticated: true

  - id: flow-2
    from: api-gateway
    to: payment-db
    protocol: PostgreSQL/TLS
    data: [transaction_records]

  - id: flow-3
    from: api-gateway
    to: stripe-api
    protocol: HTTPS/TLS-1.3
    data: [tokenized_card_data]

trust_boundaries:
  - id: boundary-1
    name: "Corporate Network"
    contains: [web-app, api-gateway, payment-db]
    position:
      x: 50
      y: 150
    size:
      width: 700
      height: 150

  - id: boundary-2
    name: "External Services"
    contains: [stripe-api]
    position:
      x: 650
      y: 350
    size:
      width: 200
      height: 150

threats:
  - id: threat-1
    title: "SQL Injection on payment queries"
    category: Tampering
    element: api-gateway
    flow: flow-2
    severity: high
    description: |
      Malicious SQL could be injected through payment
      parameters if input validation is insufficient.
    mitigation:
      status: mitigated
      description: "Parameterized queries via ORM; input validation layer"

  - id: threat-2
    title: "Man-in-the-middle on Stripe API calls"
    category: Information Disclosure
    element: api-gateway
    flow: flow-3
    severity: medium
    description: "API calls to Stripe could be intercepted."
    mitigation:
      status: mitigated
      description: "TLS 1.3 enforced; certificate pinning"

diagrams:
  - id: main-dfd
    name: "Level 0 DFD"
    viewport:
      x: 0
      y: 0
      zoom: 1
```

## Data Model

```
THREAT_MODEL
  ├── version: string
  ├── metadata: { title, author, dates, description, authoring }
  ├── elements[]: { id, type, name, trust_zone, position, colors, ... }
  ├── data_flows[]: { id, from, to, protocol, data, handles, colors, ... }
  ├── trust_boundaries[]: { id, name, contains[], position, size, colors }
  ├── threats[]: { id, title, category, element, flow, severity, mitigation }
  └── diagrams[]: { id, name, viewport }
```

**Relationships:**
- Each `threat` references an `element` and/or `flow` by ID
- Each `trust_boundary` references `elements` by ID in its `contains` array
- Each `data_flow` references two `elements` by ID (`from` and `to`)

## Design Choices

- **Element IDs** are kebab-case slugs: `api-gateway`, `payment-db`
- **Multi-line text** uses YAML block scalars (`|`), not escaped strings
- **Each threat** is a discrete YAML block — adding/removing threats produces clean diffs
- **All layout/visual fields** are `Option<T>` — omitted when not set, keeping the YAML minimal
- **Unknown fields are tolerated** (no `deny_unknown_fields`) for forward compatibility
- **New fields must be optional** with sensible defaults for backward compatibility

### Element type, subtype, and icon vocabulary

`element.type`, `element.subtype`, and `element.icon` are **open strings** whose vocabulary is
the typed registry (`src/lib/registry/`), not a closed schema enum. This is deliberate: an
unknown value renders a fallback rather than failing the file to open, so a document authored by
a newer build, a human, or the AI still loads on an older build. The registry never rewrites
these values back into the document. Released IDs are permanent — see
[`component-registry.md`](component-registry.md).

## Schema Stability Rules

- Never make breaking changes without a version bump and migration path
- The `version` field is always first under root
- Schema validation runs on every file load via serde deserialization
- All element/flow references in threats must point to existing IDs
- Reject files with duplicate IDs within any section

## Schema versioning policy

This is the detailed argument behind **ADR-009** in
[`architecture.md`](architecture.md#architecture-decision-records-adrs).

**Decision: additive schema growth does not bump `version`.** Documents that gain new optional
sections or fields stay at their existing version. `validate_version`
(`src-tauri/src/file_io/reader.rs`) accepts only explicitly supported versions and fails closed.

### The forward rule

> Additive optional fields never bump the version. A bump happens only for a breaking change, and
> a breaking bump is expected to hard-fail on older builds.

### Why not bump

1. **Additive change is not breaking change.** No field is removed, renamed, retyped, or given new
   semantics, so there is nothing to migrate. `AGENTS.md` requires a bump for *breaking* schema
   changes, and this is not one.
2. **A blanket bump converts graceful degradation into a hard failure.** Older readers match
   `"1.0"` exactly and return `UnsupportedVersion` for anything else. Because serde tolerates unknown
   fields, an already-released build opens a document containing sections it has never heard of and
   simply ignores them. Bumping to `"1.1"` would instead make every already-shipped build refuse to
   open **any** file saved by the newer version — including plain threat models carrying no new
   data at all. That trades a narrow failure mode for a universal one and directly attacks the
   "portable" product invariant.
3. **`version` signals compatibility, not features.** The presence of a section is the feature
   signal, and it is self-describing. `version` exists to tell a reader whether it can understand
   the document at all.

### Alternatives considered and rejected

- **Bump every document to `"1.1"`.** Rejected per (2): it makes downgrade a total failure instead
  of a partial one, even for documents with no new semantics.
- **Keep `"1.0"` but widen `validate_version` to accept any `1.x`.** Rejected. It cannot help the
  installed base, because already-released builds hard-fail regardless. Going forward it would
  convert a clear refusal into silent data loss the first time a build met an unknown `1.x`
  document. Exact-match is the fail-closed behavior and stays.

### Sequence compatibility (#370)

In a 1.0 document, an existing `diagrams[].sequence` extension is opaque, even when
`kind` is `sequence`. Like other unknown YAML fields, the extension's parsed value
survives saves without interpretation or replacement; formatting and comments follow
the existing writer behavior. Typed sequence views are available only in 1.1.
Older editors cannot safely enforce sequence references when editing the shared graph,
so the version boundary applies only to documents opting into the new semantics.
Before adding the first typed view to a 1.0 document, check for
an existing `diagrams[].sequence` key. If present, refuse promotion without changing
the document and name the conflicting field in the error. Ordinary 1.0 saves must
leave the version unchanged.

In 1.1, a typed view uses `kind: sequence` and a `sequence` mapping. Its
`participants` list contains local `id` and canonical `element_id`; its `messages`
list contains local `id`, participant `from` and `to`, `label`, and optional canonical
`flow_id`. A linked flow must have the same directed endpoints. List order controls
columns and time. A kind-only diagram does not define a typed sequence.

### Unknown fields and downgrade compatibility

The native transaction keeps unknown YAML fields on disk alongside the typed Rust model,
including fields on surviving entities matched by ID. Browser saves dump the plain object
they loaded. Older native builds that predate the transaction still drop unknown fields
when saving. Native serialization preserves field values, not comments or YAML formatting.

Native saves compare a SHA-256 revision of the exact file bytes under a sibling
`.thf.lock` advisory lock, then replace the file atomically. The lock file remains in
place so competing processes always lock the same file. Do not commit it or delete it
while a writer is active. A stale editor must reopen the file or save to a different
file; live merge is not part of the file format contract.
Save As to a different path carries unknown fields from the editor's source
snapshot, even if the original file has since changed. If the chosen destination
already exists, its revision is checked separately and none of its fields are
included in the copy.

When a native save removes an element or data flow, it also removes threats targeting that
element or flow, including threats targeting flows cascaded by element removal.

### Cross-platform read validation parity

The browser read path applies the same checks as the desktop reader `read_threat_model`
(`src-tauri/src/file_io/reader.rs`), in the reader's order: exact-match schema version; duplicate
IDs within `elements`, `data_flows`, `layers`, `groups`, and `relationships`; group and
relationship namespace collisions (a group ID that is also an element or trust-boundary ID; a
relationship ID that is also a data-flow ID); cross-reference integrity for data-flow endpoints,
`element.layer`/`element.group`, `group.parent`, relationship endpoints, trust-boundary members,
and threat targets; and iterative group-cycle detection. ADR-009's fail-closed argument now holds
on both platforms, not desktop only. The browser mirror is `readThreatModelText` /
`validateThreatModel` in `src/lib/thf-validation.ts`.

The two are held in lockstep by the shared invalid-fixture manifest, not by codegen. The browser
contract test (`src/lib/thf-validation.test.ts`) and the Rust corpus tests
(`invalid_fixtures_are_rejected_with_the_expected_error` and
`architecture_invalid_fixtures_are_rejected_with_the_expected_error` in
`src-tauri/src/file_io/fixtures_test.rs`) both classify every fixture in
`tests/fixtures/thf/invalid/`. Because both languages read the identical bytes, a divergence is a
red test in the same CI run. The architecture rules (issue #57, merged in #123) landed through this
mechanism: each new `invalid/<rule>.thf` fixture and manifest entry forced the browser validator to
grow the matching check in lockstep. A future reader rule extends the manifest the same way. The
manifest is the extension point — not this list of rules.

Two differences between the platforms are deliberate:

- **Message parity is byte-identical only for the content-determined classes**
  (`UnsupportedVersion`, `DuplicateId`, `InvalidReference`, `CircularGroupNesting`), whose desktop
  `Display` strings carry no path or parser text. For a raw parse failure and a missing/invalid
  required section the desktop message embeds a filesystem path and `serde_yaml` internals that do
  not exist in the browser, so parity there is class-level with an actionable, path-free,
  secret-free message — the browser message may be more specific.
- **Shape narrowing is skeleton-depth by design.** The browser verifies the version, the metadata
  block, and the entry fields the semantic checks read (an `id` per collection entry, flow and
  relationship endpoints, layer/group membership, group parents, boundary members, threat
  references). A non-null element `size` must contain numeric `width` and `height`. The browser
  tolerates unknown fields, matching serde's non-`deny_unknown_fields` behavior, and
  does not re-check every optional scalar's type.

Validation runs only at open, mirroring `read_threat_model`: there is no retroactive validation of
documents already in the store or produced by AI, and no save-side validation (the browser writer
stays symmetric with `write_threat_model`, which does not validate before serializing). The
validator is non-destructive — it returns the parsed object with unknown sections and keys intact,
preserving the browser writer's forward-compatibility behavior described above.

## Testing

- Every schema change needs a round-trip test: YAML → Rust struct → YAML → assert equal
- Sample `.thf` files live in [`tests/fixtures/thf/`](../../tests/fixtures/thf/README.md), read by
  both `src-tauri/src/file_io/fixtures_test.rs` and `src/types/thf-fixtures.test.ts`
- Test that git diffs for common operations are clean and minimal
- Test backward compatibility: old files without new fields must still parse
