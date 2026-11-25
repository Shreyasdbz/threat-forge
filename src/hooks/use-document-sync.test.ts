import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertiesTab } from "@/components/panels/properties-tab";
import { useDocumentRegistry } from "@/stores/document-registry";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import type { ThreatModel } from "@/types/threat-model";
import { useDocumentSync } from "./use-document-sync";

const mocks = vi.hoisted(() => ({
	checkDocumentUpdate: vi.fn(),
	confirmDiscard: vi.fn(),
	isTauri: vi.fn(),
}));

vi.mock("@/lib/adapters/tauri-file-adapter", () => ({
	checkDocumentUpdate: mocks.checkDocumentUpdate,
}));
vi.mock("@/lib/adapters/get-file-adapter", () => ({
	getFileAdapter: async () => ({ confirmDiscard: mocks.confirmDiscard }),
}));
vi.mock("@/lib/platform", () => ({ isTauri: mocks.isTauri }));

function model(title: string): ThreatModel {
	return {
		version: "1.0",
		metadata: {
			title,
			author: "Test",
			created: "2026-01-01",
			modified: "2026-01-01",
			description: "",
		},
		elements: [],
		data_flows: [],
		trust_boundaries: [],
		threats: [],
		diagrams: [],
	};
}

const path = "/diagram.thf";
const update = { model: model("External"), path, revision: "two", sourceYaml: "latest source" };

function open(filePath: string | null = path) {
	const registry = useDocumentRegistry.getState();
	const id = registry.createDocument({
		model: model("Original"),
		filePath,
		fileRevision: filePath ? "one" : undefined,
		pendingLayout: null,
	});
	const stores = registry.getDocumentStores(id);
	if (!stores) throw new Error("Document did not open");
	return stores;
}

async function poll() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1500);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	mocks.isTauri.mockReturnValue(true);
	useDocumentRegistry.setState({ documents: {}, openDocumentIds: [], activeDocumentId: null });
	setActiveStores(createDocumentStores());
});

afterEach(() => {
	vi.useRealTimers();
});

describe("desktop document sync", () => {
	it("reloads a clean background document and clears its stale undo history", async () => {
		const background = open();
		background.history.getState().pushSnapshot(model("Undo"));
		const active = open(null);
		mocks.checkDocumentUpdate.mockResolvedValueOnce(update).mockResolvedValue(null);
		renderHook(() => useDocumentSync());

		await poll();
		expect(active.model.getState().model?.metadata.title).toBe("Original");
		expect(background.model.getState()).toMatchObject({
			model: update.model,
			isDirty: false,
			fileRevision: "two",
			sourceYaml: "latest source",
			fileSync: "updated",
		});
		expect(background.history.getState().past).toEqual([]);
		await poll();
		expect(mocks.checkDocumentUpdate.mock.calls).toEqual([
			[path, "one"],
			[path, "two"],
		]);
	});

	it("does not replace dirty edits unless the user confirms loading the disk version", async () => {
		const stores = open();
		stores.model.getState().updateMetadata({ title: "Local edit" });
		mocks.checkDocumentUpdate.mockResolvedValue(update);
		mocks.confirmDiscard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const { result } = renderHook(() => useDocumentSync());

		await poll();
		expect(stores.model.getState()).toMatchObject({
			model: { metadata: { title: "Local edit" } },
			isDirty: true,
			fileRevision: "one",
			fileSync: "conflict",
		});
		await act(() => result.current());
		expect(stores.model.getState().model?.metadata.title).toBe("Local edit");
		await act(() => result.current());
		expect(stores.model.getState()).toMatchObject({
			model: update.model,
			isDirty: false,
			fileSync: "updated",
		});
	});

	it("ignores an in-flight result after Save As and keeps the open model on read failure", async () => {
		const stores = open();
		mocks.checkDocumentUpdate.mockImplementationOnce(async () => {
			stores.model.getState().setModel(model("Saved copy"), "/copy.thf", "copy");
			return update;
		});
		mocks.checkDocumentUpdate.mockRejectedValueOnce("Invalid file");
		renderHook(() => useDocumentSync());
		await poll();
		expect(stores.model.getState().fileSync).toBeUndefined();
		await poll();
		expect(stores.model.getState()).toMatchObject({
			model: { metadata: { title: "Saved copy" } },
			filePath: "/copy.thf",
			fileSync: "unavailable",
		});
	});

	it("preserves an uncommitted inspector field when the disk version changes", async () => {
		const stores = open();
		stores.model.getState().setModel(
			{
				...model("Original"),
				elements: [
					{
						id: "api",
						type: "process",
						name: "API",
						description: "",
						trust_zone: "",
						technologies: ["nginx"],
						tags: [],
					},
				],
			},
			path,
			"one",
		);
		stores.model.getState().setSelectedElement("api");
		mocks.checkDocumentUpdate.mockResolvedValue(update);
		renderHook(() => useDocumentSync());
		render(createElement(PropertiesTab));
		const field = screen.getByRole("textbox", { name: "Technologies" });
		fireEvent.focus(field);
		fireEvent.change(field, { target: { value: "nginx, TLS" } });
		expect(stores.model.getState().isDirty).toBe(false);

		await poll();
		expect(stores.model.getState()).toMatchObject({ fileRevision: "one", fileSync: "conflict" });
		expect(field).toHaveValue("nginx, TLS");
		fireEvent.blur(field);
		expect(stores.model.getState().model?.elements[0].technologies).toEqual(["nginx", "TLS"]);
		expect(stores.model.getState().isDirty).toBe(true);
	});

	it("does not check disk in the browser", async () => {
		mocks.isTauri.mockReturnValue(false);
		open();
		renderHook(() => useDocumentSync());
		await poll();
		expect(mocks.checkDocumentUpdate).not.toHaveBeenCalled();
	});
});
