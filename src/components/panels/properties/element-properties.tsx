import { Box } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { getComponent, listCategories, listComponents } from "@/lib/registry/registry";
import { useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import { useUiStore } from "@/stores/ui-store";
import {
	ColorField,
	CommaSeparatedField,
	EditableField,
	EditableTextarea,
	InspectorField,
	InspectorGroup,
	LABEL,
	ReadOnlyField,
	ROW,
} from "./inspector-fields";
import { ThreatLink } from "./threat-link";

const FONT_SIZE_OPTIONS = [12, 14, 16, 20, 24, 32, 48];

export function ElementProperties({ elementId }: { elementId: string }) {
	const model = useModelStore((s) => s.model);
	const updateElement = useModelStore((s) => s.updateElement);
	const setTab = useUiStore((s) => s.setRightPanelTab);

	// Read current colors from canvas node data (must be before early return for hooks rules)
	const node = useCanvasStore((s) => s.nodes.find((n) => n.id === elementId));
	const fillColor = node?.data.elementFillColor;
	const strokeColor = node?.data.elementStrokeColor;
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
						<NativeSelect value={element.type} onChange={(e) => handleTypeChange(e.target.value)}>
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
						</NativeSelect>
					</InspectorField>
				)}

				{isTextAnnotation && <ReadOnlyField label="Type" value="Text Annotation" />}

				{/* Sub-type dropdown (conditional, not for text) */}
				{!isTextAnnotation && subtypes.length > 0 && (
					<InspectorField label="Sub Type">
						<NativeSelect
							value={element.subtype ?? ""}
							onChange={(e) => handleSubtypeChange(e.target.value)}
						>
							<option value="">None</option>
							{subtypes.map((st) => (
								<option key={st.id} value={st.id}>
									{st.label}
								</option>
							))}
						</NativeSelect>
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
							<NativeSelect
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
							</NativeSelect>
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
						<NativeSelect
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
						</NativeSelect>
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
