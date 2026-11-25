import {
	BookOpen,
	FileOutput,
	FilePlus,
	FileUp,
	FolderOpen,
	LayoutPanelLeft,
	type LucideIcon,
	PanelRight,
	Presentation,
	Save,
	Settings,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useFileOperations } from "@/hooks/use-file-operations";
import { documentDisplayTitle } from "@/lib/document-display-title";
import { captureCanvasIntoModel } from "@/lib/model-capture";
import { useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import type { ThreatModel } from "@/types/threat-model";
import { GuidePicker } from "../onboarding/guide-picker";
import { DiagramPresentation } from "./diagram-presentation";

export function TopMenuBar() {
	const isDirty = useModelStore((s) => s.isDirty);
	const model = useModelStore((s) => s.model);
	const componentCount = model?.elements.length ?? 0;
	const dataFlowCount = model?.data_flows.length ?? 0;
	const threatCount = model?.threats.length ?? 0;
	const mitigatedThreatCount =
		model?.threats.filter((threat) => threat.mitigation?.status === "mitigated").length ?? 0;
	const filePath = useModelStore((s) => s.filePath);
	const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel);
	const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);
	const openSettingsDialog = useSettingsStore((s) => s.openSettingsDialog);
	const keytipsVisible = useSettingsStore((s) => s.settings.keytipsVisible);
	const { newModel, openModel, importModel, saveModel, saveModelAs, exportAsHtml } =
		useFileOperations();
	const [guidePickerOpen, setGuidePickerOpen] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [presentation, setPresentation] = useState<ThreatModel>();
	const titleInputRef = useRef<HTMLInputElement>(null);

	// Show file basename when saved, otherwise model title — from the shared helper so the tab,
	// window title, and this menu-bar title cannot drift, and a Windows path resolves correctly.
	const title = documentDisplayTitle(model, filePath);
	const displayTitle = isDirty ? `${title} *` : title;
	const isMac = navigator.platform.includes("Mac");
	const modKey = isMac ? "\u2318" : "Ctrl+";

	const commitTitle = useCallback(() => {
		const newTitle = titleInputRef.current?.value.trim();
		setEditingTitle(false);
		if (!newTitle || !model) return;
		if (newTitle !== model.metadata.title) {
			useModelStore.getState().updateMetadata({ title: newTitle });
			// Trigger save-as so user can choose the filename
			void saveModelAs();
		}
	}, [model, saveModelAs]);

	const cancelEdit = useCallback(() => {
		setEditingTitle(false);
	}, []);

	return (
		<header
			data-testid="top-menu-bar"
			className="flex h-12 shrink-0 items-center gap-2 border-b border-editor-line bg-editor-surface px-4"
		>
			{/* App title / branding */}
			<div className="flex min-w-0 items-center gap-2">
				<img src="/logo_square.png" alt="Threat Forge" className="h-5 w-5 shrink-0" />
				{editingTitle && model ? (
					<input
						ref={titleInputRef}
						defaultValue={model.metadata.title}
						autoFocus
						className="w-40 rounded border border-primary bg-background px-1.5 py-0.5 text-editor-headline text-foreground focus:outline-none"
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter") commitTitle();
							if (e.key === "Escape") cancelEdit();
						}}
						onBlur={cancelEdit}
					/>
				) : (
					<span
						className="min-w-0 truncate text-editor-headline cursor-default"
						onDoubleClick={() => {
							if (model) setEditingTitle(true);
						}}
						title={model ? `${displayTitle} - Double-click to rename` : undefined}
					>
						{displayTitle}
					</span>
				)}
			</div>

			{/* File operations */}
			<div className="ml-1 flex shrink-0 items-center gap-0.5">
				<MenuButton
					testId="btn-new"
					icon={FilePlus}
					tooltip={keytipsVisible ? `New Model (${modKey}N)` : "New Model"}
					onClick={() => void newModel()}
				/>
				<MenuButton
					testId="btn-open"
					icon={FolderOpen}
					tooltip={keytipsVisible ? `Open Model (${modKey}O)` : "Open Model"}
					onClick={() => void openModel()}
				/>
				<MenuButton
					testId="btn-save"
					icon={Save}
					tooltip={keytipsVisible ? `Save (${modKey}S)` : "Save"}
					onClick={() => void saveModel()}
					disabled={!model}
				/>
				<MenuButton
					testId="btn-export"
					icon={FileOutput}
					tooltip={`Export HTML (${modKey}${isMac ? "⇧" : "Shift+"}E)`}
					onClick={() => void exportAsHtml()}
					disabled={!model}
				/>
				<span aria-hidden="true" className="mx-1 h-4 w-px bg-editor-separator" />
				<MenuButton
					testId="btn-present"
					icon={Presentation}
					tooltip="Present diagram and export SVG or PNG"
					onClick={() => {
						if (model)
							setPresentation(
								isDirty ? captureCanvasIntoModel(model, useCanvasStore.getState()) : model,
							);
					}}
					disabled={!model}
				/>
				<MenuButton
					testId="btn-import"
					icon={FileUp}
					tooltip="Import Microsoft Threat Model (.tm7)"
					onClick={() => void importModel()}
				/>
				{presentation && (
					<DiagramPresentation model={presentation} onClose={() => setPresentation(undefined)} />
				)}
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{model && (
				<section
					aria-label={`Canvas summary: ${countLabel(componentCount, "component")}, ${countLabel(dataFlowCount, "data flow")}, ${countLabel(threatCount, "identified threat")}, ${countLabel(mitigatedThreatCount, "mitigated threat")}`}
					data-testid="canvas-count-badge"
					className="flex shrink-0 items-center text-editor-caption text-muted-foreground"
				>
					<dl className="flex items-center gap-3">
						<CountItem label="Components" value={componentCount} />
						<CountItem label="Data flows" value={dataFlowCount} />
						<CountItem
							label="Threats"
							value={`${threatCount} / ${mitigatedThreatCount}`}
							title="Threats: identified / mitigated"
						/>
					</dl>
				</section>
			)}

			{/* View toggles */}
			<div className="flex shrink-0 items-center gap-0.5">
				{model && <span aria-hidden="true" className="mr-1 h-4 w-px bg-editor-separator" />}
				<MenuButton
					testId="btn-toggle-left-panel"
					icon={LayoutPanelLeft}
					tooltip="Toggle component palette"
					onClick={toggleLeftPanel}
				/>
				<MenuButton
					testId="btn-toggle-right-panel"
					icon={PanelRight}
					tooltip="Toggle properties panel"
					onClick={toggleRightPanel}
				/>
			</div>

			<span aria-hidden="true" className="h-4 w-px shrink-0 bg-editor-separator" />

			{/* Settings + Help */}
			<div className="flex shrink-0 items-center gap-0.5">
				<MenuButton
					testId="btn-guide-picker"
					icon={BookOpen}
					tooltip="Guided Tours"
					onClick={() => setGuidePickerOpen(true)}
				/>
				<MenuButton
					testId="btn-settings-dialog"
					icon={Settings}
					tooltip={`Settings (${modKey},)`}
					onClick={openSettingsDialog}
				/>
			</div>
			{guidePickerOpen && <GuidePicker onClose={() => setGuidePickerOpen(false)} />}
		</header>
	);
}

function MenuButton({
	testId,
	icon: Icon,
	tooltip,
	onClick,
	disabled,
}: {
	testId?: string;
	icon: LucideIcon;
	tooltip: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			data-testid={testId}
			onClick={onClick}
			disabled={disabled}
			title={tooltip}
			className="grid size-8 place-items-center rounded-editor-control text-muted-foreground hover:bg-editor-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
		>
			<Icon size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
		</button>
	);
}

function CountItem({
	label,
	value,
	title,
}: {
	label: string;
	value: number | string;
	title?: string;
}) {
	return (
		<div className="flex gap-1 whitespace-nowrap" title={title}>
			<dt>{label}</dt> <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
		</div>
	);
}

function countLabel(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
