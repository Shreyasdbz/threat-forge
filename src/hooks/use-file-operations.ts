import { useCallback } from "react";
import type { OpenedDocument } from "@/lib/adapters/file-adapter";
import { getFileAdapter } from "@/lib/adapters/get-file-adapter";
import { documentDisplayTitle } from "@/lib/document-display-title";
import { generateHtmlReport } from "@/lib/export/export-html";
import { captureCanvasIntoModel } from "@/lib/model-capture";
import {
	buildLayoutFromModel,
	hasUnloadedLegacyLayout,
	RESTORE_LEGACY_LAYOUT,
} from "@/lib/model-layout-utils";
import { isTauri } from "@/lib/platform";
import { mergeWorkspaceTabs } from "@/lib/workspace-tabs";
import { useCanvasStore } from "@/stores/canvas-store";
import { nextActiveDocumentId, useDocumentRegistry } from "@/stores/document-registry";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DocumentId } from "@/types/document";
import type { ThreatModel } from "@/types/threat-model";
import { hydrateDocumentById } from "./use-workspace-restore";

function todayString(): string {
	return new Date().toISOString().split("T")[0];
}

function sanitizeFilename(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Build an author string like "Jane Doe <jane@example.com>" from settings. */
function getAuthorIdentity(): string {
	const { authorName, authorEmail } = useSettingsStore.getState().settings;
	if (authorName && authorEmail) return `${authorName} <${authorEmail}>`;
	if (authorName) return authorName;
	if (authorEmail) return authorEmail;
	return "";
}

/** Capture the active document's live canvas geometry into a model about to be written. */
function captureActiveCanvas(model: ThreatModel): ThreatModel {
	return captureCanvasIntoModel(model, useCanvasStore.getState());
}

/**
 * The D1 neighbour a close should activate, computed across the **full merged tab order** rather
 * than the registry alone (`#56`). After a reload the registry holds only the active document, so
 * `nextActiveDocumentId` over `openDocumentIds` sees no neighbour even though restored manifest
 * tabs remain on screen; merging the registry with the manifest first lets a still-un-hydrated
 * sibling become active when the last hydrated tab closes.
 */
function mergedCloseNeighbor(id: DocumentId): DocumentId | null {
	const registry = useDocumentRegistry.getState();
	const manifest = useWorkspaceStore.getState().documents;
	const openDocumentIds = registry.openDocumentIds;
	const pinnedIds = new Set(openDocumentIds.filter((docId) => registry.documents[docId]?.pinned));
	const merged = mergeWorkspaceTabs(manifest, openDocumentIds, pinnedIds).map((tab) => tab.id);
	return nextActiveDocumentId(merged, id);
}

export function useFileOperations() {
	const model = useModelStore((s) => s.model);

	const newModel = useCallback(async () => {
		const adapter = await getFileAdapter();
		const identity = getAuthorIdentity();
		const { authorName } = useSettingsStore.getState().settings;
		const created = await adapter.createNewModel("Untitled Threat Model", authorName || "");
		// Populate created_by from settings
		if (identity) {
			created.metadata.created_by = identity;
		}

		// Open in a new tab, leaving any open documents untouched (`#54` step 6). Creating a document
		// is no longer destructive, so there is nothing to confirm. New models use default positions,
		// so there is no pending layout to apply; createDocument seeds fileSettings from metadata.
		useDocumentRegistry
			.getState()
			.createDocument({ model: created, filePath: null, pendingLayout: null });
		// syncFromModel runs from the DfdCanvas effect once the new bundle is active.
	}, []);

	const openModel = useCallback(async (filePath?: string) => {
		const adapter = await getFileAdapter();
		let result: OpenedDocument | null;
		try {
			result = await adapter.openThreatModel(filePath);
		} catch (err) {
			// Both adapters reject documents they cannot read: the desktop reader on schema
			// version and reference errors, the browser parser on malformed dates and shapes.
			const msg = err instanceof Error ? err.message : String(err);
			window.alert(`Open failed: ${msg}`);
			return;
		}
		if (!result) return;

		const { model: loaded, path, revision, sourceYaml } = result;
		const pendingLayout = buildLayoutFromModel(loaded);

		// Open in a new tab, leaving any open documents untouched (`#54` step 6). createDocument
		// seeds the new document's fileSettings from loaded.metadata.settings.
		useDocumentRegistry.getState().createDocument({
			model: loaded,
			filePath: path,
			fileRevision: revision,
			sourceYaml,
			pendingLayout,
		});
		// syncFromModel runs from the DfdCanvas effect once the new bundle is active.
	}, []);

	const saveDocument = useCallback(async (saveAs: boolean) => {
		const focused = document.activeElement;
		if (focused instanceof HTMLInputElement && focused.hasAttribute("data-sequence-draft")) {
			focused.blur();
		}
		const registry = useDocumentRegistry.getState();
		const id = registry.activeDocumentId;
		const target = (id && registry.getDocumentStores(id)?.model) || useModelStore;
		const { model, filePath, fileRevision: expectedRevision, sourceYaml } = target.getState();
		if (!model) return false;
		if (isTauri() && hasUnloadedLegacyLayout(model)) {
			window.alert(RESTORE_LEGACY_LAYOUT);
			return false;
		}

		const identity = getAuthorIdentity();
		const captured = captureActiveCanvas({
			...model,
			metadata: {
				...model.metadata,
				modified: todayString(),
				modified_by: identity || model.metadata.modified_by,
				last_edit_timestamp: Math.floor(Date.now() / 1000),
			},
		});

		try {
			const adapter = await getFileAdapter();
			const saved = saveAs
				? await adapter.saveThreatModel(captured, filePath, expectedRevision, true, sourceYaml)
				: await adapter.saveThreatModel(captured, filePath, expectedRevision);
			if (!saved) return false;
			const path = typeof saved === "string" ? saved : saved.path;
			const revision = typeof saved === "string" ? undefined : saved.revision;
			const savedYaml = typeof saved === "string" ? undefined : saved.sourceYaml;
			const current = target.getState();
			if (current.model === model) {
				current.setModel(captured, path, revision, savedYaml);
				if (id) registry.setDocumentFileSettings(id, captured.metadata.settings ?? null);
			} else if (id && current.filePath === filePath && current.fileRevision === expectedRevision) {
				target.setState({
					filePath: path,
					fileRevision: revision,
					sourceYaml: savedYaml,
					fileSync: undefined,
				});
			}
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			window.alert(`Save failed: ${message}`);
			return false;
		}
	}, []);
	const saveModel = useCallback(() => saveDocument(false), [saveDocument]);
	const saveModelAs = useCallback(() => saveDocument(true), [saveDocument]);

	/**
	 * Close one document by id, guarding its *own* unsaved changes and naming it in the prompt
	 * (`#54` D6). Used for any tab — the active one or a background one — from the close button, the
	 * File menu, the command palette, the native/keyboard menu, and `Delete` in the tab strip, so
	 * neither the dirty guard nor the manifest cleanup can be bypassed by a caller that closes a tab
	 * some other way. A declined confirmation leaves the document open and changes nothing.
	 *
	 * On success the document's localStorage manifest entry is dropped here — at the shared close
	 * boundary rather than in the tab strip — so a closed live document can never remain in the
	 * manifest and resurrect on the next reload, whatever surface closed it. Its durable IndexedDB
	 * body is untouched; recovery and export of a closed document are `#55`'s job, not a close's.
	 * When the closed document was active and the registry has no live neighbour left (the common
	 * post-reload state), its D1 neighbour is computed over the full merged tab order and hydrated
	 * so a restored sibling becomes active instead of dropping to an empty scratch view.
	 */
	const closeDocumentById = useCallback(async (id: DocumentId) => {
		const registry = useDocumentRegistry.getState();
		const stores = registry.getDocumentStores(id);
		if (!stores) return;
		const state = stores.model.getState();
		if (state.isDirty) {
			const adapter = await getFileAdapter();
			const discard = await adapter.confirmDiscard(
				documentDisplayTitle(state.model, state.filePath),
			);
			if (!discard) return;
		}

		const wasActive = useDocumentRegistry.getState().activeDocumentId === id;
		// Resolve the neighbour over the full merged order *before* the close mutates either store.
		const neighborId = wasActive ? mergedCloseNeighbor(id) : null;
		// If the neighbour is a persisted-but-un-hydrated tab, read its body first (without
		// activating) so it enters the registry at its persisted slot and the close can select it as
		// the live neighbour — never a blank scratch document. A failed read leaves it un-hydrated;
		// the registry then falls back to its own neighbour selection below.
		if (neighborId && !useDocumentRegistry.getState().documents[neighborId]) {
			await hydrateDocumentById(neighborId, { activate: false });
		}

		// Hydration is asynchronous. If the user selected another document while the neighbour was
		// loading, that later selection wins; otherwise the merged-order neighbour remains the close
		// target even when registry-only close policy would choose differently.
		const closingDocumentStillActive = useDocumentRegistry.getState().activeDocumentId === id;
		useDocumentRegistry.getState().closeDocument(id);
		// Drop the manifest entry after the close commits so the fast-render projection never lists a
		// document the session no longer holds. A no-op on desktop, where there is no manifest.
		const workspace = useWorkspaceStore.getState();
		workspace.removeManifestEntry(id);

		// Prefer the merged-order neighbour when it hydrated: `closeDocument` picks over registry
		// order alone, which omits still-restored tabs and would otherwise land on the wrong sibling.
		if (
			closingDocumentStillActive &&
			neighborId &&
			useDocumentRegistry.getState().documents[neighborId]
		) {
			useDocumentRegistry.getState().activateDocument(neighborId);
		}
		// Persist the settled active pointer synchronously at the shared close boundary. Waiting for
		// the React autosave effect would leave a pagehide-sized window where reload could see null
		// (or the just-closed id) despite another document already being active.
		workspace.setActiveDocumentId(useDocumentRegistry.getState().activeDocumentId);
	}, []);

	const closeModel = useCallback(async () => {
		const registry = useDocumentRegistry.getState();
		const activeId = registry.activeDocumentId;
		if (activeId) await closeDocumentById(activeId);
		// With no active document the facades resolve to a fresh scratch bundle, so the canvas
		// is empty by construction — no explicit syncFromModel needed. File settings are disposed
		// with the closed document's session.
	}, [closeDocumentById]);

	const importModel = useCallback(async () => {
		const adapter = await getFileAdapter();
		let result: { model: ThreatModel } | null;
		try {
			result = await adapter.importThreatModel();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			window.alert(`Import failed: ${msg}`);
			return;
		}
		if (!result) return;

		const { model: imported } = result;

		// Build layout from inline positions (imported models carry no sidecar reference).
		const pendingLayout = buildLayoutFromModel(imported);

		// Open in a new tab, leaving any open documents untouched (`#54` step 6). Imported models
		// have no file path — the user must Save As to create a .thf file. TM7 imports carry no
		// ThreatForge file settings; createDocument seeds fileSettings to null.
		useDocumentRegistry
			.getState()
			.createDocument({ model: imported, filePath: null, pendingLayout });
	}, []);

	const exportAsHtml = useCallback(async () => {
		if (!model) return;

		const captured = captureActiveCanvas(model);
		const html = generateHtmlReport(captured);
		const defaultName = sanitizeFilename(model.metadata.title) || "threat-model-report";

		const adapter = await getFileAdapter();
		await adapter.exportAsHtml(html, defaultName);
	}, [model]);

	const exportAsMarkdown = useCallback(async () => {
		if (!model) return;
		const defaultName = sanitizeFilename(model.metadata.title) || "threat-model-review";
		try {
			const adapter = await getFileAdapter();
			await adapter.exportAsMarkdown(model, defaultName);
		} catch {
			window.alert("Could not export the Markdown review.");
		}
	}, [model]);

	return {
		newModel,
		openModel,
		importModel,
		saveModel,
		saveModelAs,
		closeModel,
		closeDocumentById,
		exportAsHtml,
		exportAsMarkdown,
	};
}
