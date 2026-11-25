import { isTauri } from "@/lib/platform";
import { validateThreatModel } from "@/lib/thf-validation";
import type { ThreatModel } from "@/types/threat-model";

export type DiagramFormat = "svg" | "png";

interface SceneRenderer {
	default: () => Promise<unknown>;
	render_svg: (json: string) => string;
	render_png: (json: string) => Uint8Array<ArrayBuffer>;
}

async function browserRenderer(): Promise<SceneRenderer> {
	const url = new URL("/scene/renderer.js", window.location.origin).href;
	const renderer: SceneRenderer = await import(/* @vite-ignore */ url);
	await renderer.default();
	return renderer;
}

export async function renderDiagramSvg(model: ThreatModel): Promise<string> {
	if (isTauri()) {
		const { renderDiagram } = await import("@/lib/adapters/tauri-file-adapter");
		return renderDiagram(model);
	}
	const renderer = await browserRenderer();
	return renderer.render_svg(JSON.stringify(validateThreatModel(model)));
}

export async function saveDiagram(model: ThreatModel, format: DiagramFormat): Promise<void> {
	const filename =
		model.metadata.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "diagram";
	if (isTauri()) {
		const { exportDiagram } = await import("@/lib/adapters/tauri-file-adapter");
		await exportDiagram(model, format, filename);
		return;
	}
	const renderer = await browserRenderer();
	const json = JSON.stringify(validateThreatModel(model));
	const blob =
		format === "png"
			? new Blob([renderer.render_png(json)], { type: "image/png" })
			: new Blob([renderer.render_svg(json)], { type: "image/svg+xml" });
	const { downloadBlob } = await import("@/lib/adapters/browser-file-adapter");
	downloadBlob(blob, `${filename}.${format}`);
}
