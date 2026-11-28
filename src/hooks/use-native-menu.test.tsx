import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import { useSettingsStore } from "@/stores/settings-store";
import { useNativeMenu } from "./use-native-menu";

const { confirm, listen } = vi.hoisted(() => ({
	confirm: vi.fn(),
	listen:
		vi.fn<
			(event: string, handler: (message: { payload: string }) => void) => Promise<() => void>
		>(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm }));
vi.mock("@/lib/platform", () => ({ isTauri: () => true }));
vi.mock("./use-file-operations", () => ({ useFileOperations: () => ({}) }));

beforeEach(() => {
	confirm.mockReset();
	listen.mockReset().mockResolvedValue(() => {});
	useSettingsStore.getState().updateSetting("confirmBeforeDelete", true);
});

it.each([
	{ preference: true, decision: false, deletes: false },
	{ preference: true, decision: true, deletes: true },
	{ preference: false, decision: false, deletes: true },
])(
	"handles native Edit > Delete with $preference / $decision",
	async ({ preference, decision, deletes }) => {
		const stores = createDocumentStores();
		setActiveStores(stores);
		stores.model.getState().setModel(
			{
				version: "1.0",
				metadata: {
					title: "Native deletion",
					author: "",
					description: "",
					created: "2026-01-01",
					modified: "2026-01-01",
				},
				elements: [
					{
						id: "service",
						name: "Service",
						type: "process",
						description: "",
						trust_zone: "",
						technologies: [],
					},
				],
				data_flows: [],
				trust_boundaries: [],
				threats: [],
				diagrams: [],
			},
			null,
		);
		stores.canvas.getState().syncFromModel();
		stores.canvas.setState((state) => ({
			nodes: state.nodes.map((node) => ({ ...node, selected: true })),
		}));
		useSettingsStore.getState().updateSetting("confirmBeforeDelete", preference);
		confirm.mockResolvedValue(decision);

		renderHook(() => useNativeMenu());
		await waitFor(() => expect(listen).toHaveBeenCalledWith("menu-action", expect.any(Function)));
		const menu = listen.mock.calls.find(([event]) => event === "menu-action")?.[1];
		await act(async () => {
			menu?.({ payload: "edit-delete" });
		});
		if (preference) {
			await waitFor(() =>
				expect(confirm).toHaveBeenCalledWith(
					"Delete this item?",
					expect.objectContaining({ okLabel: "Delete" }),
				),
			);
		} else {
			expect(confirm).not.toHaveBeenCalled();
		}
		expect(stores.model.getState().model?.elements.map(({ id }) => id)).toEqual(
			deletes ? [] : ["service"],
		);
		expect(stores.history.getState().past).toHaveLength(Number(deletes));
	},
);
