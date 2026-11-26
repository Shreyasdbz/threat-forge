interface ThreatModelWasm {
	default: () => Promise<unknown>;
	import_tm7: (xml: string) => string;
	render_svg: (json: string, diagramId?: string) => string;
	render_png: (json: string, diagramId?: string) => Uint8Array<ArrayBuffer>;
}

let loading: Promise<ThreatModelWasm> | undefined;

export function loadThreatModelWasm(): Promise<ThreatModelWasm> {
	loading ??= (async () => {
		const url = new URL("/scene/renderer.js", window.location.origin).href;
		const module: ThreatModelWasm = await import(/* @vite-ignore */ url);
		await module.default();
		return module;
	})().catch((error: unknown) => {
		loading = undefined;
		throw error;
	});
	return loading;
}
