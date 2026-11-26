import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Copy,
	Loader2,
	Shield,
	Trash2,
	Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { CanvasContextMenu, type ContextMenuItem } from "@/components/canvas/canvas-context-menu";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { copyTextToClipboard } from "@/lib/platform";
import { getComponent } from "@/lib/registry/registry";
import { serializeThreatYaml } from "@/lib/thf-yaml";
import { cn } from "@/lib/utils";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import type {
	Mitigation,
	MitigationStatus,
	Severity,
	StrideCategory,
	Threat,
} from "@/types/threat-model";

const STRIDE_CATEGORIES: StrideCategory[] = [
	"Spoofing",
	"Tampering",
	"Repudiation",
	"Information Disclosure",
	"Denial of Service",
	"Elevation of Privilege",
];

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const MITIGATION_STATUSES: MitigationStatus[] = [
	"not_started",
	"in_progress",
	"mitigated",
	"accepted",
	"transferred",
];

export function ThreatsTab() {
	const model = useModelStore((s) => s.model);
	const selectedElementId = useModelStore((s) => s.selectedElementId);
	const selectedThreatId = useModelStore((s) => s.selectedThreatId);
	const setSelectedThreat = useModelStore((s) => s.setSelectedThreat);
	const isAnalyzing = useModelStore((s) => s.isAnalyzing);
	const analyzeThreats = useModelStore((s) => s.analyzeThreats);
	const [filterByElement, setFilterByElement] = useState(false);

	if (!model) {
		return <p className="text-editor-caption text-muted-foreground">No model open.</p>;
	}

	const hasElements = model.elements.length > 0;
	const threats =
		filterByElement && selectedElementId
			? model.threats.filter((t) => t.element === selectedElementId || t.flow === selectedElementId)
			: model.threats;

	const selectedElement = selectedElementId
		? model.elements.find((e) => e.id === selectedElementId)
		: null;

	return (
		<div className="flex flex-col gap-4">
			<h2 className="text-editor-title3">Threats</h2>
			{/* Analyze button */}
			<Button
				type="button"
				data-testid="btn-stride-analyze"
				variant="secondary"
				disabled={!hasElements || isAnalyzing}
				onClick={() => void analyzeThreats()}
				className="self-start text-editor-footnote"
			>
				{isAnalyzing ? (
					<>
						<Loader2 className="size-4 animate-spin" />
						Analyzing...
					</>
				) : (
					<>
						<Zap className="size-4" />
						Run STRIDE Analysis
					</>
				)}
			</Button>

			{/* Filter toggle when element is selected */}
			{selectedElement && model.threats.length > 0 && (
				<button
					type="button"
					onClick={() => setFilterByElement(!filterByElement)}
					className="flex items-center gap-1.5 text-editor-caption text-muted-foreground hover:text-foreground transition-colors"
				>
					<Shield className="h-3 w-3" />
					{filterByElement
						? `Showing threats for "${selectedElement.name}"`
						: "Filter by selected element"}
				</button>
			)}

			{/* Empty states */}
			{!hasElements && (
				<div className="flex flex-col items-center gap-2 py-6 text-center">
					<AlertTriangle className="h-8 w-8 text-muted-foreground/50" />
					<p className="text-editor-caption text-muted-foreground">
						Add elements to the canvas, then run STRIDE analysis to identify threats.
					</p>
				</div>
			)}

			{hasElements && threats.length === 0 && (
				<p className="text-editor-caption text-muted-foreground">
					{filterByElement
						? "No threats linked to this element."
						: 'No threats identified yet. Click "Run STRIDE Analysis" to get started.'}
				</p>
			)}

			{/* Threat list */}
			{threats.map((threat) => (
				<ThreatCard
					key={threat.id}
					threat={threat}
					isSelected={selectedThreatId === threat.id}
					onSelect={() => setSelectedThreat(selectedThreatId === threat.id ? null : threat.id)}
				/>
			))}
		</div>
	);
}

function ThreatCard({
	threat,
	isSelected,
	onSelect,
}: {
	threat: Threat;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const setSelectedElement = useModelStore((s) => s.setSelectedElement);
	const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
	const model = useModelStore((s) => s.model);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		trigger: HTMLButtonElement | null;
	} | null>(null);
	const menuTrigger = useRef<HTMLButtonElement>(null);

	const linkedElement = model?.elements.find((e) => e.id === threat.element);

	const handleCopyAsYaml = async () => {
		try {
			await copyTextToClipboard(serializeThreatYaml(threat));
		} catch {
			window.alert("Copy failed. Check clipboard permissions and try again.");
		}
	};

	const contextMenuItems: ContextMenuItem[] = [
		{ label: "Copy as YAML", icon: Copy, onClick: () => void handleCopyAsYaml() },
	];

	return (
		<div
			data-testid="threat-card"
			className={cn(
				"rounded-editor-panel border border-editor-separator bg-editor-surface text-editor-caption transition-colors",
				isSelected && "border-editor-accent",
			)}
			onContextMenu={(event) => {
				if (event.target instanceof Element && event.target.closest("input, textarea, select")) {
					return;
				}
				event.preventDefault();
				const button = event.target instanceof Element ? event.target.closest("button") : null;
				setContextMenu({
					x: event.clientX,
					y: event.clientY,
					trigger: button ?? menuTrigger.current,
				});
			}}
		>
			{/* Header - clickable to expand/collapse */}
			<button
				ref={menuTrigger}
				type="button"
				onClick={onSelect}
				aria-keyshortcuts="Shift+F10 ContextMenu"
				onKeyDown={(event) => {
					if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
					event.preventDefault();
					const { left, bottom } = event.currentTarget.getBoundingClientRect();
					setContextMenu({ x: left, y: bottom, trigger: event.currentTarget });
				}}
				aria-expanded={isSelected}
				className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 rounded-t-editor-panel px-3 py-2.5 text-left hover:bg-editor-hover"
			>
				{isSelected ? (
					<ChevronDown className="mt-0.5 size-4 text-muted-foreground" />
				) : (
					<ChevronRight className="mt-0.5 size-4 text-muted-foreground" />
				)}
				<div className="flex min-w-0 flex-col gap-2">
					<span className="text-editor-headline">{threat.title}</span>
					<div className="flex flex-wrap items-center gap-2">
						<CategoryBadge category={threat.category} />
						<SeverityBadge severity={threat.severity} />
						{threat.mitigation && <MitigationBadge status={threat.mitigation.status} />}
					</div>
				</div>
			</button>

			{/* Linked element link */}
			{linkedElement && !isSelected && (
				<div className="border-t border-editor-separator">
					<button
						type="button"
						onClick={() => {
							setSelectedElement(linkedElement.id);
							setRightPanelTab("properties");
						}}
						className="min-h-8 w-full rounded-b-editor-panel pl-9 pr-3 text-left text-editor-caption text-editor-secondary-label hover:bg-editor-hover hover:text-editor-accent"
					>
						{linkedElement.name}
					</button>
				</div>
			)}

			{/* Expanded detail editor */}
			{isSelected && <ThreatEditor threat={threat} />}

			{contextMenu && (
				<CanvasContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					items={contextMenuItems}
					trigger={contextMenu.trigger}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}

function ThreatEditor({ threat }: { threat: Threat }) {
	const updateThreat = useModelStore((s) => s.updateThreat);
	const deleteThreat = useModelStore((s) => s.deleteThreat);
	const setSelectedThreat = useModelStore((s) => s.setSelectedThreat);
	const setSelectedElement = useModelStore((s) => s.setSelectedElement);
	const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
	const model = useModelStore((s) => s.model);

	const linkedElement = model?.elements.find((e) => e.id === threat.element);

	const handleMitigationChange = (updates: Partial<Mitigation>) => {
		const current: Mitigation = threat.mitigation ?? {
			status: "not_started",
			description: "",
		};
		updateThreat(threat.id, { mitigation: { ...current, ...updates } });
	};

	return (
		<div className="flex flex-col gap-2 border-t border-border/50 p-2">
			{/* Title */}
			<FieldGroup label="Title">
				<input
					type="text"
					value={threat.title}
					onChange={(e) => updateThreat(threat.id, { title: e.target.value })}
					className="w-full"
				/>
			</FieldGroup>

			{/* Category + Severity row */}
			<div className="grid grid-cols-2 gap-2">
				<FieldGroup label="Category">
					<NativeSelect
						value={threat.category}
						onChange={(e) =>
							updateThreat(threat.id, {
								category: e.target.value as StrideCategory,
							})
						}
						className="w-full"
					>
						{STRIDE_CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</NativeSelect>
				</FieldGroup>

				<FieldGroup label="Severity">
					<NativeSelect
						value={threat.severity}
						onChange={(e) =>
							updateThreat(threat.id, {
								severity: e.target.value as Severity,
							})
						}
						className="w-full"
					>
						{SEVERITIES.map((s) => (
							<option key={s} value={s}>
								{s.charAt(0).toUpperCase() + s.slice(1)}
							</option>
						))}
					</NativeSelect>
				</FieldGroup>
			</div>

			{/* Description */}
			<FieldGroup label="Description">
				<textarea
					value={threat.description}
					onChange={(e) => updateThreat(threat.id, { description: e.target.value })}
					rows={3}
					className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-editor-caption focus:border-primary focus:outline-none"
				/>
			</FieldGroup>

			{/* Linked element */}
			{linkedElement && (
				<FieldGroup label="Element">
					<button
						type="button"
						onClick={() => {
							setSelectedElement(linkedElement.id);
							setRightPanelTab("properties");
						}}
						className="text-editor-caption text-primary hover:underline"
					>
						{linkedElement.name} (
						{getComponent(linkedElement.type)?.label ?? linkedElement.type.replace("_", " ")})
					</button>
				</FieldGroup>
			)}

			{/* Mitigation */}
			<FieldGroup label="Mitigation Status">
				<NativeSelect
					value={threat.mitigation?.status ?? "not_started"}
					onChange={(e) =>
						handleMitigationChange({
							status: e.target.value as MitigationStatus,
						})
					}
					className="w-full"
				>
					{MITIGATION_STATUSES.map((s) => (
						<option key={s} value={s}>
							{formatMitigationStatus(s)}
						</option>
					))}
				</NativeSelect>
			</FieldGroup>

			<FieldGroup label="Mitigation Notes">
				<textarea
					value={threat.mitigation?.description ?? ""}
					onChange={(e) => handleMitigationChange({ description: e.target.value })}
					rows={2}
					placeholder="Describe the mitigation approach..."
					className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-editor-caption placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
				/>
			</FieldGroup>

			{/* Delete */}
			<button
				type="button"
				onClick={() => {
					deleteThreat(threat.id);
					setSelectedThreat(null);
				}}
				className="flex items-center gap-1 self-start rounded px-2 py-1 text-editor-caption text-destructive hover:bg-destructive/10 transition-colors"
			>
				<Trash2 className="h-3 w-3" />
				Delete threat
			</button>
		</div>
	);
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: children always contain a form control
		<label className="block">
			<span className="mb-0.5 block text-editor-caption2 text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-editor-caption2";

function SeverityBadge({ severity }: { severity: string }) {
	const colorMap: Record<string, string> = {
		critical: "bg-editor-danger/10 text-editor-danger",
		high: "bg-editor-warning/10 text-editor-warning",
		medium: "bg-editor-warning/10 text-editor-warning",
		low: "bg-editor-fill text-editor-secondary-label",
		info: "bg-editor-fill text-editor-secondary-label",
	};

	return (
		<span
			className={`${BADGE} capitalize ${colorMap[severity] ?? "bg-editor-fill text-editor-secondary-label"}`}
		>
			{severity}
		</span>
	);
}

function CategoryBadge({ category }: { category: StrideCategory }) {
	const initial =
		category === "Information Disclosure"
			? "ID"
			: category === "Denial of Service"
				? "DoS"
				: category === "Elevation of Privilege"
					? "EoP"
					: category.charAt(0);

	return (
		<span className={`${BADGE} bg-editor-fill text-editor-secondary-label`} title={category}>
			{initial}
		</span>
	);
}

function MitigationBadge({ status }: { status: MitigationStatus }) {
	const colorMap: Record<MitigationStatus, string> = {
		not_started: "bg-editor-fill text-editor-secondary-label",
		in_progress: "bg-editor-fill text-editor-secondary-label",
		mitigated: "bg-editor-success/10 text-editor-success",
		accepted: "bg-editor-fill text-editor-secondary-label",
		transferred: "bg-editor-fill text-editor-secondary-label",
	};

	return <span className={`${BADGE} ${colorMap[status]}`}>{formatMitigationStatus(status)}</span>;
}

function formatMitigationStatus(status: MitigationStatus): string {
	return status
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
