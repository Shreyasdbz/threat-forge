import { useId, useLayoutEffect } from "react";
import { useActiveStores } from "@/stores/document-stores";

export function useCanvasDraft(editing: boolean): void {
	const { pendingDrafts } = useActiveStores();
	const id = useId();
	useLayoutEffect(() => {
		if (!editing) return;
		pendingDrafts.add(id);
		return () => {
			pendingDrafts.delete(id);
		};
	}, [editing, id, pendingDrafts]);
}
