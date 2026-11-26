import { useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import { ColorField, EditableField, InspectorGroup, ReadOnlyField } from "./inspector-fields";

export function TrustBoundaryProperties({ boundaryId }: { boundaryId: string }) {
	const model = useModelStore((s) => s.model);
	const updateTrustBoundary = useModelStore((s) => s.updateTrustBoundary);
	const boundary = model?.trust_boundaries.find((b) => b.id === boundaryId);

	// Read current colors from canvas node data
	const node = useCanvasStore((s) => s.nodes.find((n) => n.id === boundaryId));
	const fillColor = node?.data.boundaryFillColor;
	const strokeColor = node?.data.boundaryStrokeColor;
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
