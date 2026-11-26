import {
	Building2,
	Cloud,
	CreditCard,
	FolderOpen,
	HeartPulse,
	type LucideIcon,
	Radio,
	ShoppingCart,
	Smartphone,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import { useFileOperations } from "@/hooks/use-file-operations";
import { buildLayoutFromModel } from "@/lib/model-layout-utils";
import { openExternalUrl } from "@/lib/platform";
import { sequenceDiagrams } from "@/lib/sequence-views";
import { loadTemplate, TEMPLATES, type TemplateInfo } from "@/lib/templates";
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
		<div data-testid="empty-canvas" className="flex h-full flex-col items-center bg-editor-canvas">
			{/* Main content — centered with upward bias */}
			<div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center-safe overflow-y-auto px-4 pb-12 [@media(max-height:850px)]:pb-0">
				<img
					src="/logo_square.png"
					alt="Threat Forge"
					className="mb-4 size-12 [@media(max-height:850px)]:mb-3 [@media(max-height:850px)]:size-10"
				/>
				<h2 className="text-editor-title2">Threat Forge</h2>
				<p className="mt-2 max-w-sm text-center text-editor-body text-muted-foreground">
					Nothing open. Start a new model, or open one you saved earlier.
				</p>

				<div className="mt-6 flex gap-3 [@media(max-height:850px)]:mt-4">
					<Button
						type="button"
						data-testid="btn-empty-new"
						className="h-9 px-4 text-editor-headline"
						onClick={() => void newModel()}
					>
						New Model
					</Button>
					<Button
						type="button"
						data-testid="btn-empty-open"
						variant="outline"
						className="h-9 px-4 text-editor-headline"
						onClick={() => void openModel()}
					>
						<FolderOpen className="h-4 w-4" />
						Open Existing
					</Button>
				</div>

				{/* Templates */}
				<div className="@container mt-8 w-full max-w-2xl">
					<p
						data-testid="empty-canvas-contrast-target"
						className="mb-3 text-center text-editor-footnote text-foreground opacity-95"
					>
						Start from a template
					</p>
					<div className="grid grid-cols-2 gap-px rounded-editor-panel bg-editor-separator p-px @min-[40rem]:grid-cols-3">
						{TEMPLATES.map((t) => (
							<TemplateCard key={t.id} template={t} onSelect={openTemplate} />
						))}
					</div>
				</div>

				<div className="mt-8 h-12 max-w-md [@media(max-height:850px)]:mt-4 [@media(max-height:850px)]:h-8">
					<RotatingTip />
				</div>
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

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
	"ecommerce-platform": ShoppingCart,
	"cloud-microservices": Cloud,
	"mobile-banking": Smartphone,
	"saas-platform": CreditCard,
	"iot-smart-building": Building2,
	"healthcare-system": HeartPulse,
};

function TemplateCard({
	template,
	onSelect,
}: {
	template: TemplateInfo;
	onSelect: (id: string) => void;
}) {
	const Icon = TEMPLATE_ICONS[template.id] ?? Radio;

	return (
		<button
			type="button"
			data-testid={`template-${template.id}`}
			onClick={() => onSelect(template.id)}
			className="grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 bg-editor-surface p-3 text-left transition-colors duration-120 ease-editor first:rounded-tl-editor-panel last:rounded-br-editor-panel hover:bg-editor-hover"
		>
			<Icon className="size-4 text-muted-foreground" />
			<span className="text-editor-footnote text-foreground">{template.name}</span>
			<span className="col-start-2 text-editor-caption text-muted-foreground">
				{template.description}
			</span>
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
