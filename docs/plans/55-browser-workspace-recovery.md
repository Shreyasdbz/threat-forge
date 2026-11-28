# Issue 55 — Browser workspace recovery

## Contract

- **Parent:** #48. **Context:** #56 owns browser persistence and #282 tracks storage
  access failures. The existing IndexedDB schema and `.thf` format remain unchanged.
- **Effort / autonomy / milestone:** High / AUTO / M2 • Beta. Project 2 cannot be
  resolved with current access; leave its metadata unset rather than inventing it.
- Give users access to saved browser work after losing a tab, manifest entry, or
  current revision. Browser storage remains local; desktop remains file-based.
- No automatic deletion, cross-device sync, bundle import, or change to ordinary
  desktop open/save behavior.

## Execution issues

### 1. Preserve imported documents and export stored workspace data

- Keep one stable registry/manifest/IndexedDB ID per imported workspace document.
  Store the ID outside the schema. Opening the same file again remains a new tab;
  reconnecting to an existing stored document retains its original ID. Preserve
  unedited imported YAML and extension fields, and let edits use the ordinary
  workspace capture path. Do not infer identity from a path, title, or file hash.
- Build recovery inventory from persisted documents, orphaned tab metadata, and
  record health. Validate current stored text with the browser reader before making
  it available as a standalone `.thf` download. Keep exact stored UTF-8 text; use a
  safe display filename. When the current body is corrupt, expose validated older
  revisions if available without promoting one silently.
- Use a versioned JSON bundle containing the workspace's document IDs, display
  metadata, stored text/revisions and per-record recovery status. Distinguish
  complete from partial exports; do not include settings, chat, credentials,
  unrelated localStorage data, or platform errors. Never describe invalid raw
  content as a valid standalone file.
- Verify import identity across reload, exact stored/downloaded bytes, unknown
  extensions, normal/closed/orphan/corrupt data, and Rust-reader compatibility
  for a downloaded browser document via the existing cross-runtime test path.

### 2. Add browser recovery UI and confirmed clearing

- Add a browser-only workspace recovery entry that is available even with no open
  tabs. Present healthy and closed documents, missing metadata or bodies, corrupt
  records, and actionable authored messages for failed migrations or inaccessible
  storage. Offer single-document and bundle download, and reopen only a supported
  readable document. Do not erase data when listing or opening fails.
- Offer per-document deletion and a separately confirmed full workspace reset.
  Settle/suppress pending writes so deleted records do not reappear; reconcile
  in-memory registry/manifest only after storage acknowledges deletion. A failed
  clear must remain visibly failed. A confirmed full reset must be able to delete
  this database even if normal migration cannot open it. Report blocked resets
  rather than claiming completion. Restrict resets to workspace stores; leave
  user preferences and key storage untouched.
- Guard access to IndexedDB even when reading its property throws, as described
  in #282, so recovery presents an authored status. Keep the workspace usable in
  memory, and distinguish blocked storage from an aborted migration.
- Exercise the recovery UI via keyboard in Chromium, including a corrupt/missing
  record and explicit clear confirmation; add one targeted visual baseline if
  needed, following `e2e/support/README.md`.

### 3. Pin the cross-platform file operation contract

- Exercise both adapters through the existing document lifecycle API and the same
  scenarios: create, open/cancel, save, save-as/cancel, and close/dirty confirmation.
  Stub only the browser picker/download and native IPC/dialog boundaries. Assert
  the platform-specific destinations without treating a browser download as a
  writable path or adding an unused close IPC.
- Verify independent sessions, closing only the intended document, and no
  mutation on cancellation. Keep manual native dialogs an owner validation item.

## Risks and verification

- Recovery must preserve data first: review close/autosave races, open tabs in
  other browser windows, transactional deletion, invalid record handling and
  extension preservation. Report any storage unavailable to the current tab.
- Use the existing persistence, hydration, file-operation and browser fixture
  suites; add new coverage with each behavior. Verify exported `.thf` with the
  native Rust parser and inspect the checked-in Chromium snapshot visually.
- Run anti-slop and applicable specialist review lanes. Load the pinned Node
  version and push normally with the local CI gate once per push, then wait for
  hosted checks and handle any relayed findings.
