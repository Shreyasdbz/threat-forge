import { defaultRangeExtractor, useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Copy, Loader2, Shield, Trash2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
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

const VIRTUALIZE_AFTER = 80;

export function ThreatsTab() {
	const model = useModelStore((s) => s.model);
	const selectedElementId = useModelStore((s) => s.selectedElementId);
	const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
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
		filterByElement && selectedEdgeId
			? model.threats.filter((t) => t.flow === selectedEdgeId)
			: filterByElement && selectedElementId
				? model.threats.filter(
						(t) => t.element === selectedElementId || t.flow === selectedElementId,
					)
				: model.threats;

	const selectedElement = selectedElementId
		? model.elements.find((e) => e.id === selectedElementId)
		: null;
	const selectedFlow = model.data_flows.find((flow) => flow.id === selectedEdgeId);

	return (
		<div className={cn("flex flex-col gap-3", threats.length > VIRTUALIZE_AFTER && "h-full")}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="flex items-baseline gap-2 text-editor-title3">
					Threats
					{model.threats.length > 0 && (
						<span className="text-editor-caption text-muted-foreground">
							{model.threats.length}
						</span>
					)}
				</h2>
				<Button
					type="button"
					data-testid="btn-stride-analyze"
					variant="secondary"
					disabled={!hasElements || isAnalyzing}
					onClick={() => void analyzeThreats()}
					className="h-editor-control rounded-editor-control text-editor-footnote"
				>
					{isAnalyzing ? (
						<>
							<Loader2 className="size-4 animate-spin" />
							Analyzing...
						</>
					) : (
						"Run STRIDE Analysis"
					)}
				</Button>
			</div>

			{/* Filter toggle when element is selected */}
			{(selectedElement || selectedFlow) && model.threats.length > 0 && (
				<button
					type="button"
					onClick={() => setFilterByElement(!filterByElement)}
					className="flex items-center gap-1.5 text-editor-caption text-muted-foreground hover:text-foreground transition-colors"
				>
					<Shield className="h-3 w-3" />
					{filterByElement
						? `Showing threats for "${selectedElement?.name ?? selectedFlow?.name}"`
						: selectedFlow
							? "Filter by selected flow"
							: "Filter by selected element"}
				</button>
			)}

			{/* Empty states */}
			{!hasElements && (
				<p className="text-editor-caption text-muted-foreground">
					Add elements to the canvas, then run STRIDE analysis to identify threats.
				</p>
			)}

			{hasElements && threats.length === 0 && (
				<p className="text-editor-caption text-muted-foreground">
					{filterByElement
						? "No threats linked to this element."
						: 'No threats identified yet. Click "Run STRIDE Analysis" to get started.'}
				</p>
			)}

			<FindingsList threats={threats} selectedId={selectedThreatId} onSelect={setSelectedThreat} />
		</div>
	);
}

function FindingsList({
	threats,
	selectedId,
	onSelect,
}: {
	threats: Threat[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [pendingFocus, setPendingFocus] = useState<number | null>(null);
	const virtual = threats.length > VIRTUALIZE_AFTER;
	const focusedIndex = threats.findIndex(({ id }) => id === focusedId);
	const selectedIndex = threats.findIndex(({ id }) => id === selectedId);
	const virtualizer = useVirtualizer({
		count: threats.length,
		enabled: virtual,
		getScrollElement: () => scrollRef.current,
		getItemKey: useCallback((index: number) => threats[index].id, [threats]),
		estimateSize: () => 64,
		overscan: 6,
		rangeExtractor: (range) => {
			const indexes = new Set(defaultRangeExtractor(range));
			if (focusedIndex >= 0) indexes.add(focusedIndex);
			if (pendingFocus !== null && pendingFocus < threats.length) indexes.add(pendingFocus);
			return [...indexes].sort((a, b) => a - b);
		},
	});

	useLayoutEffect(() => {
		if (selectedIndex < 0) return;
		if (virtual) {
			virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
		} else {
			listRef.current?.children[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
		}
	}, [selectedIndex, virtual, virtualizer]);

	useLayoutEffect(() => {
		if (pendingFocus === null) return;
		const row = listRef.current?.querySelector(`[data-index="${pendingFocus}"]`);
		row?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
		setPendingFocus(null);
	}, [pendingFocus]);

	function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const next =
			event.key === "ArrowDown"
				? index + 1
				: event.key === "ArrowUp"
					? index - 1
					: event.key === "Home"
						? 0
						: event.key === "End"
							? threats.length - 1
							: null;
		if (next === null) return;
		event.preventDefault();
		if (next < 0 || next >= threats.length || next === index) return;
		virtualizer.scrollToIndex(next, { align: "auto" });
		setPendingFocus(next);
	}

	function renderRow(threat: Threat, index: number, item?: VirtualItem) {
		const selected = selectedId === threat.id;
		return (
			<li
				key={threat.id}
				aria-posinset={index + 1}
				aria-setsize={threats.length}
				data-index={index}
				ref={item ? virtualizer.measureElement : undefined}
				onFocusCapture={item ? () => setFocusedId(threat.id) : undefined}
				className={
					item ? "absolute inset-x-0 top-0 border-b border-editor-line last:border-b-0" : undefined
				}
				style={item ? { transform: `translateY(${item.start}px)` } : undefined}
			>
				<ThreatCard
					threat={threat}
					isSelected={selected}
					onSelect={() => onSelect(selected ? null : threat.id)}
					onNavigate={item ? (event) => navigate(event, index) : undefined}
				/>
			</li>
		);
	}

	return (
		<div ref={scrollRef} className={virtual ? "min-h-0 flex-1 overflow-y-auto" : undefined}>
			<ul
				ref={listRef}
				// biome-ignore lint/a11y/noRedundantRoles: WebKit drops list semantics when list-style is none.
				role="list"
				aria-label="Findings"
				className={virtual ? "relative" : "divide-y divide-editor-line"}
				style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
			>
				{virtual
					? virtualizer
							.getVirtualItems()
							.map((item) => renderRow(threats[item.index], item.index, item))
					: threats.map((threat, index) => renderRow(threat, index))}
			</ul>
		</div>
	);
}

function ThreatCard({
	threat,
	isSelected,
	onSelect,
	onNavigate,
}: {
	threat: Threat;
	isSelected: boolean;
	onSelect: () => void;
	onNavigate?: (event: KeyboardEvent<HTMLButtonElement>) => void;
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
			className={cn("text-editor-caption", isSelected && "bg-editor-surface")}
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
			<div className="flex items-end">
				{/* Header - clickable to expand/collapse */}
				<button
					ref={menuTrigger}
					type="button"
					onClick={onSelect}
					aria-keyshortcuts="Shift+F10 ContextMenu"
					onKeyDown={(event) => {
						onNavigate?.(event);
						if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
						event.preventDefault();
						const { left, bottom } = event.currentTarget.getBoundingClientRect();
						setContextMenu({ x: left, y: bottom, trigger: event.currentTarget });
					}}
					aria-expanded={isSelected}
					className="grid min-w-0 flex-1 grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-1 py-1.5 text-left hover:bg-editor-hover"
				>
					{isSelected ? (
						<ChevronDown className="mt-0.5 size-4 text-muted-foreground" />
					) : (
						<ChevronRight className="mt-0.5 size-4 text-muted-foreground" />
					)}
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="break-words text-editor-headline">{threat.title}</span>
						<div className="flex flex-wrap items-center gap-x-2">
							<CategoryBadge category={threat.category} />
							<SeverityBadge severity={threat.severity} />
							{threat.mitigation && <MitigationBadge status={threat.mitigation.status} />}
						</div>
					</div>
				</button>

				{/* Linked element link */}
				{linkedElement && !isSelected && (
					<button
						type="button"
						onClick={() => {
							setSelectedElement(linkedElement.id);
							setRightPanelTab("properties");
						}}
						title={linkedElement.name}
						className="min-h-editor-icon max-w-[35%] shrink-0 truncate px-1 text-left text-editor-caption text-editor-secondary-label hover:bg-editor-hover hover:text-editor-accent"
					>
						{linkedElement.name}
					</button>
				)}
			</div>

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

const BADGE = "text-editor-caption";

function SeverityBadge({ severity }: { severity: string }) {
	const colorMap: Record<string, string> = {
		critical: "text-editor-danger",
		high: "text-editor-warning",
		medium: "text-editor-warning",
		low: "text-editor-secondary-label",
		info: "text-editor-secondary-label",
	};

	return (
		<span className={`${BADGE} capitalize ${colorMap[severity] ?? "text-editor-secondary-label"}`}>
			{severity}
		</span>
	);
}

function CategoryBadge({ category }: { category: StrideCategory }) {
	return <span className="text-editor-secondary-label">{category}</span>;
}

function MitigationBadge({ status }: { status: MitigationStatus }) {
	const colorMap: Record<MitigationStatus, string> = {
		not_started: "text-editor-secondary-label",
		in_progress: "text-editor-secondary-label",
		mitigated: "text-editor-success",
		accepted: "text-editor-secondary-label",
		transferred: "text-editor-secondary-label",
	};

	return <span className={`${BADGE} ${colorMap[status]}`}>{formatMitigationStatus(status)}</span>;
}

function formatMitigationStatus(status: MitigationStatus): string {
	return status
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
