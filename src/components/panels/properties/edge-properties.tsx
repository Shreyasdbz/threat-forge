import { MarkerType } from "@xyflow/react";
import { ArrowLeftRight } from "lucide-react";
import { type DfdEdge, type DfdEdgeData, useCanvasStore } from "@/stores/canvas-store";
import { useModelStore } from "@/stores/model-store";
import type { DataFlow } from "@/types/threat-model";
import {
	ColorField,
	CommaSeparatedField,
	EditableField,
	INPUT,
	InspectorField,
	InspectorGroup,
	ReadOnlyField,
} from "./inspector-fields";
import { ThreatLink } from "./threat-link";

export function EdgeProperties({ flow }: { flow: DataFlow }) {
	const model = useModelStore((s) => s.model);
	const updateDataFlow = useModelStore((s) => s.updateDataFlow);
	const reverseEdge = useCanvasStore((s) => s.reverseEdge);

	// Read current colors from canvas edge data
	const edge = useCanvasStore((s) => s.edges.find((e) => e.id === flow.id));
	const strokeColor = edge?.data?.strokeColor as string | undefined;
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
