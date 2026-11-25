import type { ThreatModel } from "@/types/threat-model";

export interface OpenedDocument {
	model: ThreatModel;
	path: string | null;
	revision?: string;
	sourceYaml?: string;
}

export interface SavedDocument {
	path: string;
	revision: string;
	sourceYaml: string;
}

/**
 * Adapter interface for file operations.
 *
 * Tauri implementation uses invoke() + native dialogs.
 * Browser implementation uses File API + download links + js-yaml.
 */
export interface FileAdapter {
	/** Create a new empty threat model. */
	createNewModel(title: string, author: string): Promise<ThreatModel>;
	/** Show an open dialog and load a threat model from YAML. */
	openThreatModel(path?: string): Promise<OpenedDocument | null>;
	/** Show an open dialog for importing from external formats (TM7, etc.) and convert to ThreatModel. */
	importThreatModel(): Promise<{ model: ThreatModel } | null>;
	/** Save a threat model to YAML. If no path provided, show save dialog. */
	saveThreatModel(
		model: ThreatModel,
		path: string | null,
		expectedRevision?: string,
		saveAs?: boolean,
		sourceYaml?: string,
	): Promise<string | SavedDocument | null>;
	/** Export the threat model as a self-contained HTML report. Returns the saved path, or null if cancelled. */
	exportAsHtml(htmlContent: string, defaultName: string): Promise<string | null>;
	/**
	 * Show a confirmation dialog for discarding unsaved changes. When a `documentTitle` is given the
	 * prompt names the document, so a user with several tabs open can answer it correctly (`#54`
	 * D6). Absent the argument the message is the original unnamed one, keeping every prior call
	 * site compiling and unchanged.
	 */
	confirmDiscard(documentTitle?: string): Promise<boolean>;
}
