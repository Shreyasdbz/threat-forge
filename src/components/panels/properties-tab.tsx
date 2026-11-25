import { MarkerType } from "@xyflow/react";
import { ArrowLeftRight, Box, ChevronDown, MousePointer2, RotateCcw } from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useState,
} from "react";
import { getComponent, listCategories, listComponents } from "@/lib/registry/registry";
import { type DfdEdge, type DfdEdgeData, useCanvasStore } from "@/stores/canvas-store";
import { useActiveStores } from "@/stores/document-stores";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import type { DataFlow } from "@/types/threat-model";

const ROW = "grid min-h-11 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2 px-3 py-1.5";
const LABEL = "text-editor-footnote text-editor-secondary-label";
const INPUT =
	"min-h-7 w-full min-w-0 rounded-editor-control border-0 bg-transparent px-2 py-1 text-left text-editor-body text-foreground placeholder:text-editor-secondary-label hover:bg-editor-hover focus:bg-editor-fill";

function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2">
			<h3 className="px-3 text-editor-footnote text-editor-secondary-label">{title}</h3>
			<div className="divide-y divide-editor-separator rounded-editor-panel bg-editor-surface">
				{children}
			</div>
		</section>
	);
}

function InspectorField({ label, children }: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: each caller passes its form control as the label child
		<label className={ROW}>
			<span className={LABEL}>{label}</span>
			{children}
		</label>
	);
}

function InspectorSelect({ className = "", ...props }: ComponentProps<"select">) {
	return (
		<span className="relative min-w-0">
			<select {...props} className={`${INPUT} appearance-none pr-7 ${className}`} />
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-editor-secondary-label"
			/>
		</span>
	);
}

export function PropertiesTab() {
	const selectedElementId = useModelStore((s) => s.selectedElementId);
	const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
	const selectedBoundaryId = useModelStore((s) => s.selectedBoundaryId);
	const model = useModelStore((s) => s.model);

	if (!model) {
		return <p className="text-editor-caption text-muted-foreground">No model open.</p>;
	}

	if (selectedEdgeId) {
		const flow = model.data_flows.find((f) => f.id === selectedEdgeId);
		if (!flow) {
			return <p className="text-editor-caption text-muted-foreground">Data flow not found.</p>;
		}
		return <EdgeProperties key={flow.id} flow={flow} />;
	}

	if (selectedBoundaryId) {
		const boundary = model.trust_boundaries.find((b) => b.id === selectedBoundaryId);
		if (!boundary) {
			return <p className="text-editor-caption text-muted-foreground">Trust boundary not found.</p>;
		}
		return <TrustBoundaryProperties boundaryId={selectedBoundaryId} />;
	}

	if (selectedElementId) {
		return <ElementProperties key={selectedElementId} elementId={selectedElementId} />;
	}

	return (
		<div className="px-2 py-8 text-left">
			<MousePointer2 className="mb-3 size-4 text-muted-foreground" aria-hidden="true" />
			<h2 className="text-editor-footnote">Nothing selected</h2>
			<p className="mt-1 text-editor-caption text-muted-foreground">
				Select an element or connector on the canvas to view its properties.
			</p>
		</div>
	);
}

function EdgeProperties({ flow }: { flow: DataFlow }) {
	const model = useModelStore((s) => s.model);
	const updateDataFlow = useModelStore((s) => s.updateDataFlow);
	const reverseEdge = useCanvasStore((s) => s.reverseEdge);

	// Read current colors from canvas edge data
	const edge = useCanvasStore((s) => s.edges.find((e) => e.id === flow.id));
	const strokeColor = (edge?.data?.strokeColor as string) ?? "";
	const strokeOpacity = (edge?.data?.strokeOpacity as number) ?? 1;

	const fromElement = model?.elements.find((e) => e.id === flow.from);
	const toElement = model?.elements.find((e) => e.id === flow.to);

	const syncEdgeData = (updates: Partial<DfdEdgeData>) => {
		const edges = useCanvasStore.getState().edges;
		const updatedEdges: DfdEdge[] = edges.map((e) =>
			e.id === flow.id ? { ...e, data: { ...e.data, ...updates } as DfdEdge["data"] } : e,
		);
		useCanvasStore.setState({ edges: updatedEdges });
	};

	const syncEdgeColor = (color: string | undefined, opacity: number) => {
		const edges = useCanvasStore.getState().edges;
		const updatedEdges: DfdEdge[] = edges.map((e) => {
			if (e.id !== flow.id) return e;
			return {
				...e,
				markerEnd: color
					? { type: MarkerType.ArrowClosed, width: 16, height: 16, color }
					: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
				data: { ...e.data, strokeColor: color, strokeOpacity: opacity } as DfdEdge["data"],
			};
		});
		useCanvasStore.setState({ edges: updatedEdges });
	};

	return (
		<div className="flex flex-col gap-3">
			<InspectorGroup title="Connection">
				<ReadOnlyField label="ID" value={flow.id} />
				<ReadOnlyField
					label="Direction"
					value={`${fromElement?.name ?? flow.from} → ${toElement?.name ?? flow.to}`}
				/>

				<button
					type="button"
					onClick={() => reverseEdge(flow.id)}
					className="flex min-h-11 w-full items-center gap-2 rounded-editor-panel px-3 text-editor-footnote text-editor-accent hover:bg-editor-hover"
				>
					<ArrowLeftRight className="h-3 w-3" />
					Flip Direction
				</button>

				<InspectorField label="Flow #">
					<input
						type="number"
						min="1"
						value={flow.flow_number ?? ""}
						placeholder="Auto"
						onChange={(e) => {
							const val = e.target.value ? Number.parseInt(e.target.value, 10) : undefined;
							updateDataFlow(flow.id, { flow_number: val });
							syncEdgeData({ flowNumber: val });
						}}
						className={`${INPUT} tabular-nums`}
					/>
				</InspectorField>

				<EditableField
					label="Name"
					value={flow.name}
					placeholder="e.g. Login Request"
					onChange={(value) => {
						updateDataFlow(flow.id, { name: value });
						syncEdgeData({ name: value });
					}}
				/>

				<EditableField
					label="Protocol"
					value={flow.protocol}
					placeholder="e.g. HTTPS, gRPC"
					onChange={(value) => {
						updateDataFlow(flow.id, { protocol: value });
						syncEdgeData({ protocol: value });
					}}
				/>

				<CommaSeparatedField
					label="Data"
					items={flow.data}
					placeholder="Comma-separated data items"
					onCommit={(data) => {
						updateDataFlow(flow.id, { data });
						syncEdgeData({ data });
					}}
				/>

				<InspectorField label="Authenticated">
					<input
						type="checkbox"
						checked={flow.authenticated}
						onChange={(e) => {
							updateDataFlow(flow.id, { authenticated: e.target.checked });
							syncEdgeData({ authenticated: e.target.checked });
						}}
						className="ml-2 size-4 accent-primary"
					/>
				</InspectorField>
			</InspectorGroup>

			<InspectorGroup title="Appearance">
				<ColorField
					label="Stroke Color"
					color={strokeColor}
					opacity={strokeOpacity}
					onColorChange={(color) => {
						syncEdgeColor(color || undefined, strokeOpacity);
						updateDataFlow(flow.id, { stroke_color: color || undefined });
					}}
					onOpacityChange={(opacity) => {
						syncEdgeColor(strokeColor || undefined, opacity);
						updateDataFlow(flow.id, { stroke_opacity: opacity });
					}}
				/>
			</InspectorGroup>

			{/* Related threats for this flow */}
			<FlowThreats flowId={flow.id} />
		</div>
	);
}

function FlowThreats({ flowId }: { flowId: string }) {
	const model = useModelStore((s) => s.model);
	const relatedThreats = model?.threats.filter((t) => t.element === flowId) ?? [];

	if (relatedThreats.length === 0) return null;

	return (
		<div className="border-t border-border pt-3">
			<p className="mb-1.5 text-editor-caption2 text-muted-foreground">
				Related Threats ({relatedThreats.length})
			</p>
			<div className="flex flex-col gap-1">
				{relatedThreats.map((threat) => (
					<ThreatLink
						key={threat.id}
						threatId={threat.id}
						title={threat.title}
						severity={threat.severity}
					/>
				))}
			</div>
		</div>
	);
}

const FONT_SIZE_OPTIONS = [12, 14, 16, 20, 24, 32, 48];

function ElementProperties({ elementId }: { elementId: string }) {
	const model = useModelStore((s) => s.model);
	const updateElement = useModelStore((s) => s.updateElement);
	const setTab = useUiStore((s) => s.setRightPanelTab);

	// Read current colors from canvas node data (must be before early return for hooks rules)
	const node = useCanvasStore((s) => s.nodes.find((n) => n.id === elementId));
	const fillColor = (node?.data.elementFillColor as string) ?? "";
	const strokeColor = (node?.data.elementStrokeColor as string) ?? "";
	const fillOpacity = (node?.data.elementFillOpacity as number) ?? 0.15;
	const strokeOpacity = (node?.data.elementStrokeOpacity as number) ?? 1.0;

	const element = model?.elements.find((e) => e.id === elementId);
	if (!element) {
		return <p className="text-editor-caption text-muted-foreground">Element not found.</p>;
	}

	const isTextAnnotation = element.type === "text";
	const subtypes = getComponent(element.type)?.variants ?? [];
	const relatedThreats = model?.threats.filter((t) => t.element === element.id) ?? [];

	/** Group library components by category for the type dropdown */
	const componentsByCategory = listCategories().map((cat) => ({
		category: cat.label,
		items: listComponents({ category: cat.id }),
	}));

	const syncElementNodeData = (updates: Record<string, unknown>) => {
		const nodes = useCanvasStore.getState().nodes;
		const updatedNodes = nodes.map((n) =>
			n.id === elementId ? { ...n, data: { ...n.data, ...updates } } : n,
		);
		useCanvasStore.setState({ nodes: updatedNodes });
		useModelStore.getState().markDirty();
	};

	const handleTypeChange = (newType: string) => {
		const comp = getComponent(newType);
		updateElement(element.id, {
			type: newType,
			subtype: undefined,
			icon: comp?.iconId,
		});
		syncElementNodeData({
			elementType: newType,
			subtype: undefined,
			icon: comp?.iconId,
		});
	};

	const handleSubtypeChange = (newSubtype: string) => {
		if (newSubtype === "") {
			updateElement(element.id, { subtype: undefined });
			syncElementNodeData({ subtype: undefined });
		} else {
			updateElement(element.id, { subtype: newSubtype });
			syncElementNodeData({ subtype: newSubtype });
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<Box className="size-4 shrink-0 text-editor-secondary-label" aria-hidden="true" />
				<h2 className="min-w-0 break-words text-editor-title3">{element.name}</h2>
			</div>
			<InspectorGroup title="Details">
				<ReadOnlyField label="ID" value={element.id} />

				{/* Type dropdown — hidden for text annotations */}
				{!isTextAnnotation && (
					<InspectorField label="Type">
						<InspectorSelect
							value={element.type}
							onChange={(e) => handleTypeChange(e.target.value)}
						>
							<option value="generic">Generic</option>
							{componentsByCategory.map((group) => (
								<optgroup key={group.category} label={group.category}>
									{group.items.map((comp) => (
										<option key={comp.id} value={comp.id}>
											{comp.label}
										</option>
									))}
								</optgroup>
							))}
						</InspectorSelect>
					</InspectorField>
				)}

				{isTextAnnotation && <ReadOnlyField label="Type" value="Text Annotation" />}

				{/* Sub-type dropdown (conditional, not for text) */}
				{!isTextAnnotation && subtypes.length > 0 && (
					<InspectorField label="Sub Type">
						<InspectorSelect
							value={element.subtype ?? ""}
							onChange={(e) => handleSubtypeChange(e.target.value)}
						>
							<option value="">None</option>
							{subtypes.map((st) => (
								<option key={st.id} value={st.id}>
									{st.label}
								</option>
							))}
						</InspectorSelect>
					</InspectorField>
				)}

				<EditableField
					label={isTextAnnotation ? "Text" : "Name"}
					value={element.name}
					onChange={(value) => {
						updateElement(element.id, { name: value });
						syncNodeLabel(element.id, value);
					}}
				/>

				{/* Trust Zone — not for text annotations */}
				{!isTextAnnotation && (
					<EditableField
						label="Trust Zone"
						value={element.trust_zone}
						placeholder="e.g. internal, dmz, external"
						onChange={(value) => {
							updateElement(element.id, { trust_zone: value });
							syncNodeTrustZone(element.id, value);
						}}
					/>
				)}

				<EditableTextarea
					label="Description"
					value={element.description}
					placeholder="Describe this element..."
					onChange={(value) => updateElement(element.id, { description: value })}
				/>
			</InspectorGroup>
			{!isTextAnnotation && (
				<InspectorGroup title="Architecture">
					{(["layer", "group"] as const).map((field) => (
						<InspectorField key={field} label={field === "layer" ? "Layer" : "Group"}>
							<InspectorSelect
								value={element[field] ?? ""}
								onChange={(event) =>
									updateElement(element.id, { [field]: event.target.value || undefined })
								}
							>
								<option value="">Unassigned</option>
								{(field === "layer" ? model?.layers : model?.groups)?.map((option) => (
									<option key={option.id} value={option.id}>
										{option.name}
									</option>
								))}
							</InspectorSelect>
						</InspectorField>
					))}
					<CommaSeparatedField
						label="Technologies"
						items={element.technologies ?? []}
						placeholder="e.g. nginx, TLS, OAuth"
						onCommit={(technologies) => updateElement(element.id, { technologies })}
					/>
					<button
						type="button"
						className="min-h-11 w-full rounded-b-editor-panel px-3 text-left text-editor-footnote text-editor-accent hover:bg-editor-hover"
						onClick={() => setTab("architecture")}
					>
						Browse layers and groups
					</button>
				</InspectorGroup>
			)}

			{/* Text-specific styling controls */}
			{isTextAnnotation && (
				<InspectorGroup title="Appearance">
					<ColorField
						label="Text Color"
						color={fillColor}
						opacity={(node?.data.elementFillOpacity as number) ?? 1.0}
						onColorChange={(color) => {
							syncElementNodeData({ elementFillColor: color || undefined });
							updateElement(element.id, { fill_color: color || undefined });
						}}
						onOpacityChange={(opacity) => {
							syncElementNodeData({ elementFillOpacity: opacity });
							updateElement(element.id, { fill_opacity: opacity });
						}}
					/>

					<InspectorField label="Font Size">
						<InspectorSelect
							value={element.font_size ?? 14}
							onChange={(e) => {
								const size = Number.parseInt(e.target.value, 10);
								updateElement(element.id, { font_size: size });
								syncElementNodeData({ fontSize: size });
							}}
							className="tabular-nums"
						>
							{FONT_SIZE_OPTIONS.map((size) => (
								<option key={size} value={size}>
									{size}px
								</option>
							))}
						</InspectorSelect>
					</InspectorField>

					<div className={ROW}>
						<span className={LABEL}>Font Weight</span>
						<div className="flex gap-1">
							{(["normal", "bold"] as const).map((weight) => (
								<button
									key={weight}
									type="button"
									onClick={() => {
										updateElement(element.id, { font_weight: weight });
										syncElementNodeData({ fontWeight: weight });
									}}
									className={`flex-1 rounded border px-2 py-1 text-editor-caption transition-colors ${
										(element.font_weight ?? "normal") === weight
											? "border-primary bg-accent text-accent-foreground"
											: "border-border bg-background text-muted-foreground hover:bg-accent/50"
									}`}
									style={{ fontWeight: weight }}
								>
									{weight === "normal" ? "Normal" : "Bold"}
								</button>
							))}
						</div>
					</div>
				</InspectorGroup>
			)}

			{/* Fill/Stroke colors — not for text annotations */}
			{!isTextAnnotation && (
				<InspectorGroup title="Appearance">
					<ColorField
						label="Fill Color"
						color={fillColor}
						opacity={fillOpacity}
						onColorChange={(color) => {
							syncElementNodeData({ elementFillColor: color || undefined });
							updateElement(element.id, { fill_color: color || undefined });
						}}
						onOpacityChange={(opacity) => {
							syncElementNodeData({ elementFillOpacity: opacity });
							updateElement(element.id, { fill_opacity: opacity });
						}}
					/>

					<ColorField
						label="Stroke Color"
						color={strokeColor}
						opacity={strokeOpacity}
						onColorChange={(color) => {
							syncElementNodeData({ elementStrokeColor: color || undefined });
							updateElement(element.id, { stroke_color: color || undefined });
						}}
						onOpacityChange={(opacity) => {
							syncElementNodeData({ elementStrokeOpacity: opacity });
							updateElement(element.id, { stroke_opacity: opacity });
						}}
					/>
				</InspectorGroup>
			)}

			{/* Related threats — not for text annotations */}
			{!isTextAnnotation && relatedThreats.length > 0 && (
				<div className="border-t border-border pt-3">
					<p className="mb-1.5 text-editor-caption2 text-muted-foreground">
						Related Threats ({relatedThreats.length})
					</p>
					<div className="flex flex-col gap-1">
						{relatedThreats.map((threat) => (
							<ThreatLink
								key={threat.id}
								threatId={threat.id}
								title={threat.title}
								severity={threat.severity}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ThreatLink({
	threatId,
	title,
	severity,
}: {
	threatId: string;
	title: string;
	severity: string;
}) {
	const setSelectedThreat = useModelStore((s) => s.setSelectedThreat);
	const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);

	return (
		<button
			type="button"
			onClick={() => {
				setSelectedThreat(threatId);
				setRightPanelTab("threats");
			}}
			className="flex items-center justify-between rounded px-1.5 py-1 text-editor-caption hover:bg-accent transition-colors text-left"
		>
			<span className="truncate">{title}</span>
			<SeverityDot severity={severity} />
		</button>
	);
}

function SeverityDot({ severity }: { severity: string }) {
	const colorMap: Record<string, string> = {
		critical: "bg-red-400",
		high: "bg-orange-400",
		medium: "bg-yellow-400",
		low: "bg-blue-400",
		info: "bg-gray-400",
	};

	return (
		<span className={`h-2 w-2 shrink-0 rounded-full ${colorMap[severity] ?? "bg-gray-400"}`} />
	);
}

function TrustBoundaryProperties({ boundaryId }: { boundaryId: string }) {
	const model = useModelStore((s) => s.model);
	const updateTrustBoundary = useModelStore((s) => s.updateTrustBoundary);
	const boundary = model?.trust_boundaries.find((b) => b.id === boundaryId);

	// Read current colors from canvas node data
	const node = useCanvasStore((s) => s.nodes.find((n) => n.id === boundaryId));
	const fillColor = (node?.data.boundaryFillColor as string) ?? "";
	const strokeColor = (node?.data.boundaryStrokeColor as string) ?? "";
	const fillOpacity = (node?.data.boundaryFillOpacity as number) ?? 0.05;
	const strokeOpacity = (node?.data.boundaryStrokeOpacity as number) ?? 0.6;

	if (!boundary) {
		return <p className="text-editor-caption text-muted-foreground">Boundary not found.</p>;
	}

	const syncBoundaryNodeData = (updates: Record<string, unknown>) => {
		const nodes = useCanvasStore.getState().nodes;
		const updatedNodes = nodes.map((n) =>
			n.id === boundaryId ? { ...n, data: { ...n.data, ...updates } } : n,
		);
		useCanvasStore.setState({ nodes: updatedNodes });
		useModelStore.getState().markDirty();
	};

	return (
		<div className="flex flex-col gap-3">
			<InspectorGroup title="Boundary">
				<ReadOnlyField label="ID" value={boundary.id} />
				<ReadOnlyField label="Type" value="Trust Boundary" />

				<EditableField
					label="Name"
					value={boundary.name}
					placeholder="e.g. Internal Network"
					onChange={(value) => {
						updateTrustBoundary(boundary.id, { name: value });
						syncBoundaryNodeData({ label: value, boundaryName: value });
					}}
				/>

				<ReadOnlyField
					label="Contains"
					value={
						boundary.contains.length > 0
							? boundary.contains
									.map((id) => model?.elements.find((e) => e.id === id)?.name ?? id)
									.join(", ")
							: "No elements"
					}
				/>
			</InspectorGroup>

			<InspectorGroup title="Appearance">
				<ColorField
					label="Fill Color"
					color={fillColor}
					opacity={fillOpacity}
					onColorChange={(color) => {
						syncBoundaryNodeData({ boundaryFillColor: color || undefined });
						updateTrustBoundary(boundary.id, { fill_color: color || undefined });
					}}
					onOpacityChange={(opacity) => {
						syncBoundaryNodeData({ boundaryFillOpacity: opacity });
						updateTrustBoundary(boundary.id, { fill_opacity: opacity });
					}}
				/>

				<ColorField
					label="Stroke Color"
					color={strokeColor}
					opacity={strokeOpacity}
					onColorChange={(color) => {
						syncBoundaryNodeData({ boundaryStrokeColor: color || undefined });
						updateTrustBoundary(boundary.id, { stroke_color: color || undefined });
					}}
					onOpacityChange={(opacity) => {
						syncBoundaryNodeData({ boundaryStrokeOpacity: opacity });
						updateTrustBoundary(boundary.id, { stroke_opacity: opacity });
					}}
				/>
			</InspectorGroup>
		</div>
	);
}

function ColorField({
	label,
	color,
	opacity,
	onColorChange,
	onOpacityChange,
}: {
	label: string;
	color: unknown;
	opacity: number;
	onColorChange: (color: string) => void;
	onOpacityChange: (opacity: number) => void;
}) {
	const hex =
		typeof color === "string" ? color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1] : undefined;
	const swatchColor =
		hex?.length === 3
			? `#${[...hex].map((digit) => digit.repeat(2)).join("")}`
			: hex
				? `#${hex}`
				: undefined;
	return (
		<div className={ROW}>
			<span className={LABEL}>{label}</span>
			<div className="flex min-w-0 flex-wrap items-center gap-1">
				<span className="relative grid size-7 shrink-0 place-items-center rounded-editor-control hover:bg-editor-hover has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-editor-accent">
					<span
						aria-hidden="true"
						style={{ backgroundColor: swatchColor }}
						className={`size-5 rounded-sm border border-editor-outline ${swatchColor ? "" : "bg-linear-to-br from-transparent from-45% via-editor-secondary-label via-50% to-transparent to-55%"}`}
					/>
					<input
						type="color"
						aria-label={label}
						aria-description={swatchColor ? undefined : "Default color"}
						title={swatchColor ?? "Default color"}
						value={swatchColor ?? "#888888"}
						onChange={(e) => onColorChange(e.target.value)}
						className="absolute inset-0 size-full cursor-pointer opacity-0"
					/>
				</span>
				<label className="flex shrink-0 items-center rounded-editor-control pr-1 text-editor-caption text-editor-secondary-label hover:bg-editor-hover focus-within:bg-editor-fill">
					<input
						type="number"
						aria-label={`${label} opacity (%)`}
						min={0}
						max={100}
						step={5}
						value={Math.round(opacity * 100)}
						onChange={(e) => {
							if (Number.isFinite(e.target.valueAsNumber)) {
								onOpacityChange(Math.max(0, Math.min(100, e.target.valueAsNumber)) / 100);
							}
						}}
						className="h-7 w-10 appearance-none rounded-editor-control bg-transparent pl-1 text-right text-foreground tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
					/>
					%
				</label>
				{swatchColor ? (
					<button
						type="button"
						onClick={() => onColorChange("")}
						aria-label={`Reset ${label.toLowerCase()} to default`}
						title="Reset to default"
						className="grid size-7 place-items-center rounded-editor-control text-muted-foreground hover:bg-editor-hover"
					>
						<RotateCcw className="size-4" aria-hidden="true" />
					</button>
				) : null}
			</div>
		</div>
	);
}

function syncNodeLabel(elementId: string, name: string) {
	const nodes = useCanvasStore.getState().nodes;
	const updatedNodes = nodes.map((n) =>
		n.id === elementId ? { ...n, data: { ...n.data, label: name } } : n,
	);
	useCanvasStore.setState({ nodes: updatedNodes });
}

function syncNodeTrustZone(elementId: string, trustZone: string) {
	const nodes = useCanvasStore.getState().nodes;
	const updatedNodes = nodes.map((n) =>
		n.id === elementId ? { ...n, data: { ...n.data, trustZone } } : n,
	);
	useCanvasStore.setState({ nodes: updatedNodes });
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<dl className={ROW}>
			<dt className={LABEL}>{label}</dt>
			<dd
				className={`min-w-0 wrap-anywhere px-2 text-left ${
					label === "ID" ? "break-all font-editor-mono text-editor-caption" : "text-editor-body"
				}`}
			>
				{value}
			</dd>
		</dl>
	);
}

function EditableField({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<InspectorField label={label}>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				className={INPUT}
			/>
		</InspectorField>
	);
}

function EditableTextarea({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="grid gap-1.5 px-3 py-2.5">
			<span className={LABEL}>{label}</span>
			<textarea
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				rows={3}
				className={`${INPUT} resize-none`}
			/>
		</label>
	);
}

/**
 * A text input that accepts comma-separated values but only parses them on blur,
 * allowing the user to type commas freely without the input fighting them.
 */
function CommaSeparatedField({
	label,
	items,
	placeholder,
	onCommit,
}: {
	label: string;
	items: string[];
	placeholder?: string;
	onCommit: (items: string[]) => void;
}) {
	const [rawText, setRawText] = useState(items.join(", "));
	const [isFocused, setIsFocused] = useState(false);
	const { pendingDrafts } = useActiveStores();
	const draftId = useId();

	useLayoutEffect(
		() => () => {
			pendingDrafts.delete(draftId);
		},
		[draftId, pendingDrafts],
	);

	// Sync from external changes only when not focused
	useEffect(() => {
		if (!isFocused) {
			setRawText(items.join(", "));
		}
	}, [items, isFocused]);

	const commitValue = useCallback(() => {
		if (!pendingDrafts.delete(draftId)) return;
		const parsed = rawText
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		onCommit(parsed);
	}, [draftId, pendingDrafts, rawText, onCommit]);

	return (
		<InspectorField label={label}>
			<input
				type="text"
				value={rawText}
				placeholder={placeholder}
				onChange={(e) => {
					const value = e.target.value;
					if (value === items.join(", ")) pendingDrafts.delete(draftId);
					else pendingDrafts.add(draftId);
					setRawText(value);
				}}
				onFocus={() => setIsFocused(true)}
				onBlur={() => {
					setIsFocused(false);
					commitValue();
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") commitValue();
				}}
				className={INPUT}
			/>
		</InspectorField>
	);
}
