import { selectedGraphItems } from "@/stores/canvas-store-factory";
import { getActiveStores } from "@/stores/document-stores";
import { useSettingsStore } from "@/stores/settings-store";
import { isTauri } from "./platform";
import { showingSequence } from "./sequence-views";

type DeletionTarget = { nodeId: string } | { edgeId: string };

let confirming = false;

export async function requestGraphDeletion(target?: DeletionTarget, onConfirm?: () => void) {
	if (confirming) return;
	const stores = getActiveStores();
	const modelState = stores.model.getState();
	if (stores.interview.getState().visible || showingSequence(modelState)) return;
	const { model, selectedEdgeId } = modelState;
	const canvas = stores.canvas.getState();
	const targets = target
		? {
				nodes: "nodeId" in target ? [target.nodeId] : [],
				edges: "edgeId" in target ? [target.edgeId] : [],
			}
		: selectedGraphItems(canvas, selectedEdgeId);
	const count =
		canvas.nodes.filter((node) => targets.nodes.includes(node.id)).length +
		canvas.edges.filter((edge) => targets.edges.includes(edge.id)).length;
	if (!model || !count) return;

	if (useSettingsStore.getState().settings.confirmBeforeDelete) {
		const message = count === 1 ? "Delete this item?" : `Delete these ${count} items?`;
		confirming = true;
		try {
			const confirmed = isTauri()
				? await (await import("@tauri-apps/plugin-dialog")).confirm(message, {
						title: "Confirm deletion",
						kind: "warning",
						okLabel: "Delete",
						cancelLabel: "Cancel",
					})
				: window.confirm(message);
			if (!confirmed) return;
		} catch {
			return;
		} finally {
			confirming = false;
		}
	}

	if (getActiveStores() !== stores || stores.model.getState().model !== model) return;
	onConfirm?.();
	stores.canvas.getState().deleteSelected(targets);
}
