import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserFileAdapter } from "@/lib/adapters/browser-file-adapter";
import { TauriFileAdapter } from "@/lib/adapters/tauri-file-adapter";
import { serializeThreatModelYaml } from "@/lib/thf-yaml";
import { useDocumentRegistry } from "@/stores/document-registry";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ThreatModel } from "@/types/threat-model";
import { useFileOperations } from "./use-file-operations";

const host = vi.hoisted(() => ({
	invoke: vi.fn(),
	confirm: vi.fn(),
	platform: "browser",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: host.confirm }));
vi.mock("@/lib/platform", () => ({ isTauri: () => host.platform === "tauri" }));
vi.mock("@/lib/adapters/get-file-adapter", () => ({
	getFileAdapter: () =>
		Promise.resolve(host.platform === "tauri" ? new TauriFileAdapter() : new BrowserFileAdapter()),
}));

function model(title: string): ThreatModel {
	return {
		version: "1.0",
		metadata: { title, author: "", created: "2026-01-01", modified: "2026-01-01", description: "" },
		elements: [],
		data_flows: [],
		trust_boundaries: [],
		threats: [],
		diagrams: [],
	};
}

describe.each(["browser", "tauri"])("%s file adapter lifecycle", (platform) => {
	let pickDocument: boolean;
	let allowDiscard: boolean;
	let allowSave: boolean;
	let downloads: string[];
	let nativeSaves: { path: unknown; saveAs: unknown; expectedRevision: unknown }[];
	const sourceYaml = serializeThreatModelYaml(model("Opened document"));
	const sourcePath = platform === "tauri" ? "/models/opened.thf" : "opened.thf";

	beforeEach(() => {
		host.platform = platform;
		pickDocument = false;
		allowDiscard = false;
		allowSave = true;
		downloads = [];
		nativeSaves = [];
		useDocumentRegistry.setState({ documents: {}, openDocumentIds: [], activeDocumentId: null });
		useWorkspaceStore.setState({ documents: [], activeDocumentId: null });
		setActiveStores(createDocumentStores());
		host.confirm.mockImplementation(() => Promise.resolve(allowDiscard));
		host.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
			switch (command) {
				case "create_new_model":
					return model(String(args.title));
				case "open_threat_model":
					return pickDocument
						? { model: model("Opened document"), path: sourcePath, revision: "open", sourceYaml }
						: null;
				case "save_threat_model":
					nativeSaves.push({
						path: args.path,
						saveAs: args.saveAs,
						expectedRevision: args.expectedRevision,
					});
					return allowSave
						? {
								path: args.saveAs ? "/models/copy.thf" : sourcePath,
								revision: "written",
								sourceYaml,
							}
						: null;
				default:
					throw new Error(`Unexpected native file command: ${command}`);
			}
		});
		vi.spyOn(window, "confirm").mockImplementation(() => allowDiscard);
		vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
			this: HTMLInputElement,
		) {
			if (pickDocument) {
				Object.defineProperty(this, "files", {
					value: [{ name: "opened.thf", text: async () => sourceYaml }],
				});
			}
			this.dispatchEvent(new Event(pickDocument ? "change" : "cancel"));
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloads.push(this.download);
		});
		vi.stubGlobal(
			"URL",
			Object.assign(class extends URL {}, {
				createObjectURL: () => "blob:workspace-contract",
				revokeObjectURL: () => undefined,
			}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("preserves independent documents through create, open, save, save as and close", async () => {
		const { result } = renderHook(useFileOperations);
		const registry = useDocumentRegistry.getState();
		await act(async () => result.current.newModel());
		const created = useDocumentRegistry.getState().activeDocumentId;
		if (!created) throw new Error("Expected the new document to be open");
		await act(async () => result.current.openModel());
		expect(useDocumentRegistry.getState().openDocumentIds).toEqual([created]);

		pickDocument = true;
		await act(async () => result.current.openModel());
		const opened = useDocumentRegistry.getState().activeDocumentId;
		if (!opened || opened === created) throw new Error("Expected a separate document to open");
		const openedModel = registry.getDocumentStores(opened)?.model;
		if (!openedModel) throw new Error("Missing the opened document store");
		expect(openedModel.getState()).toMatchObject({ filePath: sourcePath, sourceYaml });
		expect(registry.getDocumentStores(created)?.model.getState().model?.metadata.title).toBe(
			"Untitled Threat Model",
		);

		await act(async () => {
			expect(await result.current.saveModel()).toBe(true);
		});
		await act(async () => {
			expect(await result.current.saveModelAs()).toBe(true);
		});
		if (platform === "tauri") {
			expect(nativeSaves).toEqual([
				{ path: sourcePath, expectedRevision: "open", saveAs: false },
				{ path: sourcePath, expectedRevision: "written", saveAs: true },
			]);
			expect(openedModel.getState().filePath).toBe("/models/copy.thf");
			allowSave = false;
			await act(async () => {
				expect(await result.current.saveModelAs()).toBe(false);
			});
			expect(openedModel.getState().filePath).toBe("/models/copy.thf");
		} else {
			expect(downloads).toEqual(["opened-document.thf", "opened-document.thf"]);
		}

		act(() => openedModel.getState().updateMetadata({ title: "Unsaved title" }));
		await act(async () => result.current.closeModel());
		expect(useDocumentRegistry.getState().activeDocumentId).toBe(opened);
		allowDiscard = true;
		await act(async () => result.current.closeModel());
		expect(useDocumentRegistry.getState().openDocumentIds).toEqual([created]);
		expect(useDocumentRegistry.getState().activeDocumentId).toBe(created);
	});
});
