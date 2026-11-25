import { useCallback, useEffect } from "react";
import { getFileAdapter } from "@/lib/adapters/get-file-adapter";
import { buildLayoutFromModel } from "@/lib/model-layout-utils";
import { isTauri } from "@/lib/platform";
import { useDocumentRegistry } from "@/stores/document-registry";
import type { ModelState } from "@/stores/model-store-factory";
import type { DocumentId } from "@/types/document";

const POLL_INTERVAL = 1500;

async function refreshDocument(id: DocumentId, cancelled: () => boolean, discard?: ModelState) {
	const registry = useDocumentRegistry.getState();
	const stores = registry.getDocumentStores(id);
	if (!stores) return;
	const { filePath, fileRevision } = stores.model.getState();
	if (!filePath || !fileRevision) return;

	const current = () => {
		const state = stores.model.getState();
		return !cancelled() &&
			useDocumentRegistry.getState().getDocumentStores(id) === stores &&
			state.filePath === filePath &&
			state.fileRevision === fileRevision
			? state
			: null;
	};
	let update: Awaited<
		ReturnType<typeof import("@/lib/adapters/tauri-file-adapter").checkDocumentUpdate>
	>;
	try {
		const { checkDocumentUpdate } = await import("@/lib/adapters/tauri-file-adapter");
		update = await checkDocumentUpdate(filePath, fileRevision);
	} catch {
		const state = current();
		if (state && state.fileSync !== "unavailable")
			stores.model.setState({ fileSync: "unavailable" });
		return;
	}
	const state = current();
	if (!state) return;
	if (!update) {
		if (state.fileSync === "conflict" || state.fileSync === "unavailable") {
			stores.model.setState({ fileSync: undefined });
		}
		return;
	}
	if (
		stores.inspectorDrafts.size > 0 ||
		(state.isDirty &&
			(!discard ||
				state.model !== discard.model ||
				state.filePath !== discard.filePath ||
				state.fileRevision !== discard.fileRevision))
	) {
		if (state.fileSync !== "conflict") stores.model.setState({ fileSync: "conflict" });
		return;
	}
	if (
		state.isAnalyzing ||
		stores.canvas.getState().nodes.some((node) => node.dragging || node.resizing)
	) {
		return;
	}

	stores.canvas.setState({
		pendingLayout: buildLayoutFromModel(update.model),
		nodes: [],
		edges: [],
	});
	stores.history.getState().clear();
	state.setModel(update.model, update.path, update.revision, update.sourceYaml);
	registry.setDocumentFileSettings(id, update.model.metadata.settings ?? null);
	stores.model.setState({ fileSync: "updated" });
}

export function useDocumentSync() {
	useEffect(() => {
		if (!isTauri()) return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			for (const id of useDocumentRegistry.getState().openDocumentIds) {
				if (stopped) return;
				await refreshDocument(id, () => stopped);
			}
			if (!stopped) timer = setTimeout(() => void poll(), POLL_INTERVAL);
		};
		timer = setTimeout(() => void poll(), POLL_INTERVAL);
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, []);

	return useCallback(async () => {
		const registry = useDocumentRegistry.getState();
		const id = registry.activeDocumentId;
		const stores = id ? registry.getDocumentStores(id) : null;
		const state = stores?.model.getState();
		if (!id || !state || state.fileSync !== "conflict") return;
		const adapter = await getFileAdapter();
		if (await adapter.confirmDiscard(state.model?.metadata.title)) {
			await refreshDocument(id, () => false, state);
		}
	}, []);
}
