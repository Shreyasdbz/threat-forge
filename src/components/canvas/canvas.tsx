import { ArrowUpRight, FolderOpen } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import { useFileOperations } from "@/hooks/use-file-operations";
import { buildLayoutFromModel } from "@/lib/model-layout-utils";
import { openExternalUrl } from "@/lib/platform";
import { sequenceDiagrams } from "@/lib/sequence-views";
import { ARCHITECTURE_STARTERS, loadTemplate, TEMPLATES, type TemplateInfo } from "@/lib/templates";
import { TIPS } from "@/lib/tips";
import { useCanvasStore } from "@/stores/canvas-store";
import { useDocumentRegistry } from "@/stores/document-registry";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { SequenceEditor } from "./sequence-editor";

const LazyDfdCanvas = lazy(() => import("./dfd-canvas").then((m) => ({ default: m.DfdCanvas })));

export function Canvas() {
	const model = useModelStore((s) => s.model);
	const selectedSequenceId = useModelStore((s) => s.selectedSequenceId);
	const selectSequence = useModelStore((s) => s.selectSequence);
	const editDiagrams = useModelStore((s) => s.editSequenceDiagrams);
	const sequenceError = useModelStore((s) => s.sequenceError);

	if (!model) {
		return <EmptyCanvas />;
	}

	const sequences = sequenceDiagrams(model);
	const active = sequences.find((diagram) => diagram.id === selectedSequenceId);
	return (
		<div data-testid="canvas-area" className="h-full w-full">
			<div className="relative h-full w-full">
				{sequenceError && (
					<div
						role="alert"
						className="absolute top-2 right-2 z-10 max-w-sm border border-destructive bg-editor-surface p-2 text-editor-caption"
					>
						{sequenceError}
					</div>
				)}
				<div className={active ? "invisible h-full w-full" : "h-full w-full"} inert={!!active}>
					<Suspense
						fallback={
							<div className="flex h-full items-center justify-center text-editor-body text-muted-foreground">
								Loading canvas...
							</div>
						}
					>
						<LazyDfdCanvas />
					</Suspense>
				</div>
				{active && (
					<div className="absolute inset-0">
						<SequenceEditor
							key={active.id}
							diagram={active}
							model={model}
							onChange={(diagram) =>
								editDiagrams(
									model.diagrams.map((entry) => (entry.id === active.id ? diagram : entry)),
								)
							}
							onDelete={() => {
								if (editDiagrams(model.diagrams.filter((entry) => entry.id !== active.id)))
									selectSequence(null);
							}}
							onOpenFlow={(id) => {
								useCanvasStore.setState(({ nodes, edges }) => ({
									nodes: nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
									edges: edges.map((edge) => {
										const selected = edge.id === id;
										return !!edge.selected === selected ? edge : { ...edge, selected };
									}),
								}));
								selectSequence(null);
								useModelStore.getState().setSelectedEdge(id);
								if (!useUiStore.getState().rightPanelOpen) useUiStore.getState().toggleRightPanel();
								useUiStore.getState().setRightPanelTab("threats");
							}}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

function EmptyCanvas() {
	const { newModel, openModel } = useFileOperations();

	const openTemplate = useCallback((id: string) => {
		const model = loadTemplate(id);
		if (!model) return;
		const pendingLayout = buildLayoutFromModel(model);
		// Open in a new tab (`#54` step 6); templates carry no file settings, so createDocument
		// seeds fileSettings to null.
		useDocumentRegistry.getState().createDocument({ model, filePath: null, pendingLayout });
	}, []);

	return (
		<div data-testid="empty-canvas" className="flex h-full flex-col bg-editor-canvas">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
					<h2 className="text-editor-title2">Open a workspace</h2>
					<div className="mt-4 flex flex-wrap gap-2">
						<Button
							type="button"
							data-testid="btn-empty-new"
							className="h-editor-primary rounded-editor-control px-4 text-editor-headline"
							onClick={() => void newModel()}
						>
							New Model
						</Button>
						<Button
							type="button"
							data-testid="btn-empty-open"
							variant="outline"
							className="h-editor-primary rounded-editor-control px-4 text-editor-headline"
							onClick={() => void openModel()}
						>
							<FolderOpen className="h-4 w-4" />
							Open Existing
						</Button>
					</div>

					{/* Templates */}
					<div className="@container mt-6">
						<div className="grid gap-6 @min-[37rem]:grid-cols-2">
							<section>
								<h3 className="text-editor-title3 text-foreground">Architecture starters</h3>
								<p className="mt-1 mb-2 text-editor-caption text-muted-foreground">
									Start without findings. When ready, open Threats and choose Run STRIDE Analysis.
								</p>
								<div className="divide-y divide-editor-line border-y border-editor-line">
									{ARCHITECTURE_STARTERS.map((t) => (
										<TemplateRow key={t.id} template={t} onSelect={openTemplate} />
									))}
								</div>
							</section>
							<section>
								<h3
									data-testid="empty-canvas-contrast-target"
									className="text-editor-title3 text-foreground opacity-95"
								>
									Templates with findings
								</h3>
								<p className="mt-1 mb-2 text-editor-caption text-muted-foreground">
									Explore examples that already include findings.
								</p>
								<div className="divide-y divide-editor-line border-y border-editor-line">
									{TEMPLATES.map((t) => (
										<TemplateRow key={t.id} template={t} onSelect={openTemplate} />
									))}
								</div>
							</section>
						</div>
					</div>
				</div>
			</div>
			<div className="mx-auto mt-2 h-12 w-full max-w-md shrink-0 px-4 [@media(max-height:850px)]:h-8">
				<RotatingTip />
			</div>

			{/* Footer */}
			<footer className="flex w-full shrink-0 items-center justify-center gap-4 border-t border-border/50 px-4 py-3">
				<span
					data-testid="empty-canvas-contrast-target"
					className="text-editor-caption text-foreground opacity-95"
				>
					Built by Exit Zero Labs LLC
				</span>
				<span className="text-muted-foreground/30">·</span>
				<button
					type="button"
					onClick={() => void openExternalUrl("https://github.com/exit-zero-labs/threat-forge")}
					data-testid="empty-canvas-contrast-target"
					className="flex items-center gap-1 text-editor-caption text-foreground opacity-95 transition-opacity hover:opacity-100"
				>
					<GithubIcon className="h-3 w-3" />
					GitHub
				</button>
				<span className="text-muted-foreground/30">·</span>
				<span
					data-testid="empty-canvas-contrast-target"
					className="text-editor-caption text-foreground opacity-95"
				>
					v{__APP_VERSION__ ?? "dev"}
				</span>
			</footer>
		</div>
	);
}

function TemplateRow({
	template,
	onSelect,
}: {
	template: TemplateInfo;
	onSelect: (id: string) => void;
}) {
	return (
		<button
			type="button"
			data-testid={`template-${template.id}`}
			onClick={() => onSelect(template.id)}
			className="grid min-h-editor-row w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-2 px-2 py-1.5 text-left hover:bg-editor-hover focus-visible:-outline-offset-2"
		>
			<span className="text-editor-headline">{template.name}</span>
			<ArrowUpRight className="row-span-2 size-4 text-muted-foreground" aria-hidden="true" />
			<span className="text-editor-caption text-muted-foreground">{template.description}</span>
		</button>
	);
}

function RotatingTip() {
	const reduceMotion = useSettingsStore((s) => s.settings.reduceMotion);
	const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
	const [visible, setVisible] = useState(true);
	const prevIndex = useRef(tipIndex);

	const pickNextTip = useCallback(() => {
		let next: number;
		do {
			next = Math.floor(Math.random() * TIPS.length);
		} while (next === prevIndex.current && TIPS.length > 1);
		prevIndex.current = next;
		return next;
	}, []);

	useEffect(() => {
		if (reduceMotion) return;

		const interval = setInterval(() => {
			// Fade out
			setVisible(false);
			// After fade-out, swap tip and fade in
			setTimeout(() => {
				setTipIndex(pickNextTip());
				setVisible(true);
			}, 400);
		}, 7000);

		return () => clearInterval(interval);
	}, [reduceMotion, pickNextTip]);

	return (
		<p
			data-testid="rotating-tip-contrast-target"
			className="text-center text-editor-caption italic text-foreground"
			style={{
				opacity: visible ? 1 : 0,
				transition: reduceMotion ? "none" : "opacity 400ms ease-in-out",
			}}
		>
			{TIPS[tipIndex]}
		</p>
	);
}
