import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { DiagramFormat } from "@/lib/export/diagram-export";
import type { ThreatModel } from "@/types/threat-model";
import type { FileAdapter, OpenedDocument, SavedDocument } from "./file-adapter";

export function checkDocumentUpdate(
	path: string,
	revision: string,
): Promise<(OpenedDocument & { path: string; revision: string; sourceYaml: string }) | null> {
	return invoke("check_document_update", { path, revision });
}

export function renderDiagram(model: ThreatModel): Promise<string> {
	return invoke("render_diagram", { model });
}

export function exportDiagram(
	model: ThreatModel,
	format: DiagramFormat,
	defaultName: string,
): Promise<string | null> {
	return invoke("export_diagram", { model, format, defaultName });
}

export class TauriFileAdapter implements FileAdapter {
	async createNewModel(title: string, author: string): Promise<ThreatModel> {
		return invoke<ThreatModel>("create_new_model", { title, author });
	}

	async openThreatModel(path?: string): Promise<OpenedDocument | null> {
		return invoke<OpenedDocument | null>("open_threat_model", { path });
	}

	async importThreatModel(): Promise<{ model: ThreatModel } | null> {
		const model = await invoke<ThreatModel | null>("import_threat_model");
		return model ? { model } : null;
	}

	async saveThreatModel(
		model: ThreatModel,
		path: string | null,
		expectedRevision?: string,
		saveAs = false,
		sourceYaml?: string,
	): Promise<SavedDocument | null> {
		return invoke<SavedDocument | null>("save_threat_model", {
			path,
			model,
			expectedRevision,
			saveAs,
			sourceYaml,
		});
	}

	async exportAsHtml(htmlContent: string, defaultName: string): Promise<string | null> {
		return invoke<string | null>("export_html", { defaultName, content: htmlContent });
	}

	async confirmDiscard(documentTitle?: string): Promise<boolean> {
		const message = documentTitle
			? `You have unsaved changes in "${documentTitle}". Discard them?`
			: "You have unsaved changes. Discard them?";
		return confirm(message, {
			title: "Unsaved Changes",
			kind: "warning",
			okLabel: "Discard",
			cancelLabel: "Cancel",
		});
	}
}
