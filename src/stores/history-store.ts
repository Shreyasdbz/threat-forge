import { buildLayoutFromModel } from "@/lib/model-layout-utils";
import type { ThreatModel } from "@/types/threat-model";
import { createActiveStoreFacade, getActiveStores } from "./document-stores";
import type { HistoryState } from "./history-store-factory";

/** Undo/redo history for the active document. */
export const useHistoryStore = createActiveStoreFacade<HistoryState>((stores) => stores.history);

export function restoreHistorySnapshot(snapshot: ThreatModel): void {
	const stores = getActiveStores();
	const canvas = stores.canvas.getState();
	const layout = buildLayoutFromModel(snapshot);
	if (layout) canvas.setPendingLayout({ ...layout, viewport: canvas.viewport });
	stores.model.getState().restoreSnapshot(snapshot);
	canvas.syncFromModel();
}
