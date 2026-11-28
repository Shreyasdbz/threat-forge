import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "@/stores/canvas-store";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

vi.mock("@/hooks/use-file-operations", () => ({
	useFileOperations: () => ({
		newModel: vi.fn(),
		openModel: vi.fn(),
		saveModel: vi.fn(),
		saveModelAs: vi.fn(),
		exportAsHtml: vi.fn(),
	}),
}));

const { useKeyboardShortcuts } = await import("./use-keyboard-shortcuts");

describe("useKeyboardShortcuts", () => {
	beforeEach(() => {
		setActiveStores(createDocumentStores());
		useUiStore.setState({ keyboardShortcutsDialogOpen: false });
		useSettingsStore.setState({ settingsDialogOpen: false, settingsDialogInitialTab: null });
	});

	it("opens the keyboard shortcuts dialog with ?", () => {
		renderHook(() => useKeyboardShortcuts());

		fireEvent.keyDown(window, { key: "?", shiftKey: true });

		expect(useUiStore.getState().keyboardShortcutsDialogOpen).toBe(true);
	});

	it("closes the keyboard shortcuts dialog with Escape before other Escape behavior", () => {
		useUiStore.setState({ keyboardShortcutsDialogOpen: true });

		renderHook(() => useKeyboardShortcuts());

		fireEvent.keyDown(window, { key: "Escape" });

		expect(useUiStore.getState().keyboardShortcutsDialogOpen).toBe(false);
	});

	it("clears graph selection and inspector selection with Escape", () => {
		useCanvasStore.setState({
			nodes: [
				{
					id: "node",
					position: { x: 0, y: 0 },
					data: {
						label: "Node",
						elementType: "process",
						trustZone: "",
						description: "",
						technologies: [],
					},
					selected: true,
				},
			],
			edges: [{ id: "edge", source: "node", target: "other", selected: true }],
		});
		useModelStore.getState().setSelectedEdge("edge");
		const { passiveUpdate } = useCanvasStore.getState();
		renderHook(() => useKeyboardShortcuts());

		fireEvent.keyDown(window, { key: "Escape" });

		expect(useCanvasStore.getState().nodes[0].selected).toBe(false);
		expect(useCanvasStore.getState().edges[0].selected).toBe(false);
		expect(useCanvasStore.getState().passiveUpdate).toBe(passiveUpdate + 1);
		expect(useModelStore.getState().selectedEdgeId).toBeNull();
	});
});
