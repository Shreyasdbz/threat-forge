import { isTauri } from "@/lib/platform";
import { validateThreatModel } from "@/lib/thf-validation";
import { loadThreatModelWasm } from "@/lib/threat-model-wasm";
import type { ThreatModel } from "@/types/threat-model";

export type DiagramFormat = "svg" | "png";

export async function renderDiagramSvg(model: ThreatModel, diagramId?: string): Promise<string> {
	if (isTauri()) {
		const { renderDiagram } = await import("@/lib/adapters/tauri-file-adapter");
		return renderDiagram(model, diagramId);
	}
	const renderer = await loadThreatModelWasm();
	return renderer.render_svg(JSON.stringify(validateThreatModel(model)), diagramId);
}

export async function saveDiagram(
	model: ThreatModel,
	format: DiagramFormat,
	diagramId?: string,
): Promise<void> {
	const filename =
		(diagramId
			? (model.diagrams.find(({ id }) => id === diagramId)?.name ?? model.metadata.title)
			: model.metadata.title
		)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "diagram";
	if (isTauri()) {
		const { exportDiagram } = await import("@/lib/adapters/tauri-file-adapter");
		await exportDiagram(model, format, filename, diagramId);
		return;
	}
	const renderer = await loadThreatModelWasm();
	const json = JSON.stringify(validateThreatModel(model));
	const blob =
		format === "png"
			? new Blob([renderer.render_png(json, diagramId)], { type: "image/png" })
			: new Blob([renderer.render_svg(json, diagramId)], { type: "image/svg+xml" });
	const { downloadBlob } = await import("@/lib/adapters/browser-file-adapter");
	downloadBlob(blob, `${filename}.${format}`);
}
