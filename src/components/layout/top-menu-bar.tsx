import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import {
	type Icon,
	IconBook,
	IconDeviceFloppy,
	IconFileExport,
	IconFileImport,
	IconFilePlus,
	IconFolderOpen,
	IconLayoutSidebar,
	IconLayoutSidebarRight,
	IconPresentation,
	IconSettings,
	IconTrash,
} from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { useFileOperations } from "@/hooks/use-file-operations";
import { documentDisplayTitle } from "@/lib/document-display-title";
import { type DiagramFormat, saveDiagram } from "@/lib/export/diagram-export";
import { captureCanvasIntoModel } from "@/lib/model-capture";
import { requestGraphDeletion } from "@/lib/request-graph-deletion";
import { sequenceDiagrams, showingSequence } from "@/lib/sequence-views";
import { useCanvasStore } from "@/stores/canvas-store";
import { useActiveStores } from "@/stores/document-stores";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import type { ThreatModel } from "@/types/threat-model";
import { GuidePicker } from "../onboarding/guide-picker";
import { WhatsNewOverlay } from "../onboarding/whats-new-overlay";
import { DiagramPresentation } from "./diagram-presentation";

export function TopMenuBar() {
	const isDirty = useModelStore((s) => s.isDirty);
	const model = useModelStore((s) => s.model);
	const edgeSelected = useModelStore((s) => Boolean(s.selectedEdgeId));
	const graphSelected = useCanvasStore(
		(s) => s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected),
	);
	const sequenceVisible = useModelStore(showingSequence);
	const { interview } = useActiveStores();
	const interviewVisible = useStore(interview, (s) => s.visible);
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
	const {
		newModel,
		openModel,
		importModel,
		saveModel,
		saveModelAs,
		exportAsHtml,
		exportAsMarkdown,
	} = useFileOperations();
	const [guidePickerOpen, setGuidePickerOpen] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [presentation, setPresentation] = useState<{ model: ThreatModel; diagramId?: string }>();
	const [diagramExportError, setDiagramExportError] = useState<string>();
	const titleInputRef = useRef<HTMLInputElement>(null);

	function diagramSnapshot() {
		if (!model) return;
		const { selectedSequenceId } = useModelStore.getState();
		return {
			model: isDirty ? captureCanvasIntoModel(model, useCanvasStore.getState()) : model,
			diagramId: sequenceDiagrams(model).find(({ id }) => id === selectedSequenceId)?.id,
		};
	}

	async function exportDiagram(format: DiagramFormat) {
		const snapshot = diagramSnapshot();
		if (!snapshot) return;
		setDiagramExportError(undefined);
		try {
			await saveDiagram(snapshot.model, format, snapshot.diagramId);
		} catch {
			setDiagramExportError(`The ${format.toUpperCase()} export could not be saved.`);
		}
	}

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
			className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 border-b border-editor-line bg-editor-surface px-4 py-1"
		>
			{/* App title / branding */}
			<div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
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
					icon={IconFilePlus}
					tooltip={keytipsVisible ? `New Model (${modKey}N)` : "New Model"}
					onClick={() => void newModel()}
				/>
				<MenuButton
					testId="btn-open"
					icon={IconFolderOpen}
					tooltip={keytipsVisible ? `Open Model (${modKey}O)` : "Open Model"}
					onClick={() => void openModel()}
				/>
				<MenuButton
					testId="btn-save"
					icon={IconDeviceFloppy}
					tooltip={keytipsVisible ? `Save (${modKey}S)` : "Save"}
					onClick={() => void saveModel()}
					disabled={!model}
				/>
				{(graphSelected || edgeSelected) && !sequenceVisible && !interviewVisible && (
					<MenuButton
						testId="btn-delete-selection"
						icon={IconTrash}
						tooltip="Delete selection"
						onClick={() => void requestGraphDeletion()}
					/>
				)}
				<Menu.Root>
					<Menu.Trigger
						render={<Button type="button" variant="ghost" size="icon" />}
						data-testid="btn-export"
						aria-label="Export"
						title="Export"
						className="text-muted-foreground"
						disabled={!model}
					>
						<IconFileExport size={16} stroke={1.75} aria-hidden="true" />
					</Menu.Trigger>
					<Menu.Portal>
						<Menu.Positioner align="start" sideOffset={4} className="z-50">
							<Menu.Popup className="min-w-44 rounded-editor-panel border border-editor-separator bg-editor-raised p-1 shadow-editor-popover">
								{(["svg", "png"] as const).map((format) => (
									<Menu.Item
										key={format}
										className="cursor-default rounded px-2 py-1.5 text-editor-footnote outline-none data-[highlighted]:bg-editor-hover"
										onClick={() => void exportDiagram(format)}
									>
										Export as {format.toUpperCase()}
									</Menu.Item>
								))}
								<Menu.Separator className="my-1 h-px bg-editor-line" />
								<Menu.Item
									className="cursor-default rounded px-2 py-1.5 text-editor-footnote outline-none data-[highlighted]:bg-editor-hover"
									onClick={() => void exportAsHtml()}
								>
									Export as HTML
								</Menu.Item>
								<Menu.Item
									className="cursor-default rounded px-2 py-1.5 text-editor-footnote outline-none data-[highlighted]:bg-editor-hover"
									onClick={() => void exportAsMarkdown()}
								>
									Export as Markdown
								</Menu.Item>
							</Menu.Popup>
						</Menu.Positioner>
					</Menu.Portal>
				</Menu.Root>
				<span aria-hidden="true" className="mx-1 h-4 w-px bg-editor-separator" />
				<MenuButton
					testId="btn-present"
					icon={IconPresentation}
					tooltip="Present diagram"
					onClick={() => setPresentation(diagramSnapshot())}
					disabled={!model}
				/>
				<MenuButton
					testId="btn-import"
					icon={IconFileImport}
					tooltip="Import Microsoft Threat Model (.tm7)"
					onClick={() => void importModel()}
				/>
				{presentation && (
					<DiagramPresentation {...presentation} onClose={() => setPresentation(undefined)} />
				)}
			</div>

			{/* Spacer */}
			<div className="flex-1" />

			{model && (
				<section
					aria-label={`Canvas summary: ${countLabel(componentCount, "component")}, ${countLabel(dataFlowCount, "data flow")}, ${countLabel(threatCount, "identified threat")}, ${countLabel(mitigatedThreatCount, "mitigated threat")}`}
					data-testid="canvas-count-badge"
					className="hidden shrink-0 items-center text-editor-caption text-muted-foreground lg:flex"
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
					icon={IconLayoutSidebar}
					tooltip="Toggle component palette"
					onClick={toggleLeftPanel}
				/>
				<MenuButton
					testId="btn-toggle-right-panel"
					icon={IconLayoutSidebarRight}
					tooltip="Toggle properties panel"
					onClick={toggleRightPanel}
				/>
			</div>

			<span aria-hidden="true" className="h-4 w-px shrink-0 bg-editor-separator" />

			{/* Settings + Help */}
			<div className="flex shrink-0 items-center gap-0.5">
				<WhatsNewOverlay />
				<Dialog.Root open={guidePickerOpen} onOpenChange={setGuidePickerOpen}>
					<Dialog.Trigger
						render={<Button type="button" variant="ghost" size="icon" />}
						data-testid="btn-guide-picker"
						aria-label="Guided Tours"
						title="Guided Tours"
						className="text-muted-foreground"
					>
						<IconBook size={16} stroke={1.75} aria-hidden="true" />
					</Dialog.Trigger>
					{guidePickerOpen && <GuidePicker onClose={() => setGuidePickerOpen(false)} />}
				</Dialog.Root>
				<MenuButton
					testId="btn-settings-dialog"
					icon={IconSettings}
					tooltip={`Settings (${modKey},)`}
					onClick={openSettingsDialog}
				/>
			</div>
			{diagramExportError && (
				<p role="alert" className="basis-full text-editor-footnote text-destructive-foreground">
					{diagramExportError}
				</p>
			)}
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
	icon: Icon;
	tooltip: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			data-testid={testId}
			onClick={onClick}
			disabled={disabled}
			title={tooltip}
			className="text-muted-foreground"
		>
			<Icon size={16} stroke={1.75} aria-hidden="true" />
		</Button>
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
			<dt>{label}</dt> <dd className="tabular-nums text-foreground">{value}</dd>
		</div>
	);
}

function countLabel(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
