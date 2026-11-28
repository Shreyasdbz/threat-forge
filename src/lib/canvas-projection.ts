import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type {
	DataFlow,
	DiagramLayout,
	Element,
	Group,
	ThreatModel,
	TrustBoundary,
} from "@/types/threat-model";
import { DEFAULT_NODE_WIDTH } from "./canvas-utils";

/** ReactFlow node data payload for DFD elements.
 *  Uses `type` + index signature to satisfy ReactFlow's `Record<string, unknown>` constraint. */
export type DfdNodeData = {
	[key: string]: unknown;
	label: string;
	elementType: string;
	subtype?: string;
	icon?: string;
	trustZone: string;
	description: string;
	technologies: string[];
	architectureGroupId?: string;
	groupAccent?: string;
	groupStrokeOpacity?: number;
	/** Element fill color */
	elementFillColor?: string;
	/** Element stroke color */
	elementStrokeColor?: string;
	/** Element fill opacity (0-1) */
	elementFillOpacity?: number;
	/** Element stroke opacity (0-1) */
	elementStrokeOpacity?: number;
	elementSize?: Element["size"];
	/** Font size in pixels (for text annotations) */
	fontSize?: number;
	/** Font weight: "normal" | "bold" (for text annotations) */
	fontWeight?: string;
	/** For trust boundary group nodes */
	isBoundary?: boolean;
	boundaryName?: string;
	/** Trust boundary fill color (CSS color with opacity) */
	boundaryFillColor?: string;
	/** Trust boundary stroke color (CSS color with opacity) */
	boundaryStrokeColor?: string;
	/** Trust boundary fill opacity (0-1) */
	boundaryFillOpacity?: number;
	/** Trust boundary stroke opacity (0-1) */
	boundaryStrokeOpacity?: number;
};

/** ReactFlow edge data payload for data flows.
 *  Uses `type` + index signature to satisfy ReactFlow's `Record<string, unknown>` constraint. */
export type DfdEdgeData = {
	[key: string]: unknown;
	name: string;
	protocol: string;
	data: string[];
	authenticated: boolean;
	/** User-facing flow number displayed on the edge */
	flowNumber?: number;
	/** Dragged label X offset from default position */
	labelOffsetX?: number;
	/** Dragged label Y offset from default position */
	labelOffsetY?: number;
	/** Custom edge stroke color (hex) */
	strokeColor?: string;
	/** Custom edge stroke opacity (0-1) */
	strokeOpacity?: number;
};

export type DfdNode = Node<DfdNodeData>;
export type DfdEdge = Edge<DfdEdgeData>;

function architectureGroupToNode(group: Group, index: number, canvasId: string): DfdNode {
	const { width, height } = group.size ?? { width: 420, height: 280 };
	return {
		id: canvasId,
		type: "architectureGroup",
		position: group.position ?? { x: 680, y: index * 320 },
		width,
		height,
		selectable: false,
		connectable: false,
		focusable: false,
		dragHandle: ".architecture-group-drag-handle",
		style: { width, height, pointerEvents: "none" },
		data: {
			architectureGroupId: group.id,
			groupAccent: group.stroke_color ?? group.fill_color,
			groupStrokeOpacity: group.stroke_opacity,
			label: group.name,
			elementType: "",
			trustZone: "",
			description: "",
			technologies: [],
		},
	};
}

export function elementToNode(element: Element, position: { x: number; y: number }): DfdNode {
	const isText = element.type === "text";
	const size = element.size;
	const sized =
		size &&
		[size.width, size.height].every((dimension) => Number.isFinite(dimension) && dimension > 0)
			? size
			: undefined;
	return {
		id: element.id,
		type: isText ? "textAnnotation" : "dfdElement",
		position,
		...(sized && {
			width: sized.width,
			height: sized.height,
			style: { width: sized.width, height: sized.height },
		}),
		data: {
			label: element.name,
			elementType: element.type,
			subtype: element.subtype,
			icon: element.icon,
			trustZone: element.trust_zone ?? "",
			description: element.description ?? "",
			technologies: element.technologies ?? [],
			elementFillColor: element.fill_color,
			elementStrokeColor: element.stroke_color,
			elementFillOpacity: element.fill_opacity,
			elementStrokeOpacity: element.stroke_opacity,
			...(sized && { elementSize: sized }),
			fontSize: element.font_size,
			fontWeight: element.font_weight,
		},
	};
}

export function boundaryToNode(
	boundary: TrustBoundary,
	position: { x: number; y: number },
): DfdNode {
	const w = boundary.size?.width ?? 400;
	const h = boundary.size?.height ?? 300;
	return {
		id: boundary.id,
		type: "trustBoundary",
		position,
		width: w,
		height: h,
		// pointerEvents:none on the ReactFlow wrapper so clicks inside the boundary
		// pass through to child nodes and edges. The label and resize handle inside
		// TrustBoundaryNode opt back in with pointer-events:auto.
		style: { width: w, height: h, pointerEvents: "none" as const },
		data: {
			label: boundary.name,
			elementType: "", // unused for boundaries
			trustZone: "",
			description: "",
			technologies: [],
			isBoundary: true,
			boundaryName: boundary.name,
			boundaryFillColor: boundary.fill_color,
			boundaryStrokeColor: boundary.stroke_color,
			boundaryFillOpacity: boundary.fill_opacity,
			boundaryStrokeOpacity: boundary.stroke_opacity,
		},
	};
}

export function flowToEdge(flow: DataFlow): DfdEdge {
	function handleId(id: string | undefined, kind: "source" | "target") {
		return id === "top" || id === "right" || id === "bottom" || id === "left"
			? `${id}-${kind}`
			: id;
	}

	return {
		id: flow.id,
		source: flow.from,
		target: flow.to,
		type: "dataFlow",
		sourceHandle: handleId(flow.source_handle, "source"),
		targetHandle: handleId(flow.target_handle, "target"),
		...(flow.stroke_color
			? {
					markerEnd: {
						type: MarkerType.ArrowClosed,
						width: 16,
						height: 16,
						color: flow.stroke_color,
					},
				}
			: {}),
		data: {
			name: flow.name ?? "",
			protocol: flow.protocol,
			data: flow.data,
			authenticated: flow.authenticated,
			flowNumber: flow.flow_number,
			labelOffsetX: flow.label_offset?.x,
			labelOffsetY: flow.label_offset?.y,
			strokeColor: flow.stroke_color,
			strokeOpacity: flow.stroke_opacity,
		},
	};
}

export function projectCanvas(
	model: ThreatModel,
	current: { nodes: readonly DfdNode[]; edges: readonly DfdEdge[] },
	layout: DiagramLayout | null,
): { nodes: DfdNode[]; edges: DfdEdge[] } {
	const layoutPositions = layout ? new Map(layout.nodes.map((n) => [n.id, n])) : null;

	// Keep existing node state for nodes that still exist (used when model changes in-place)
	const existingNodes = new Map(current.nodes.map((n) => [n.id, n]));
	const existingPositions = new Map(current.nodes.map((n) => [n.id, n.position]));

	// Position priority: saved layout > existing canvas positions > inline model position > default grid
	function resolvePosition(
		id: string,
		inlinePos: { x: number; y: number } | undefined,
		defaultPos: { x: number; y: number },
		parentId?: string,
	): { x: number; y: number } {
		const saved = layoutPositions?.get(id);
		if (saved) return { x: saved.x, y: saved.y };
		const existing = existingNodes.get(id);
		return (
			(existing?.parentId === parentId ? existingPositions.get(id) : undefined) ??
			inlinePos ??
			defaultPos
		);
	}

	// Convert trust boundaries to group nodes
	const boundaryNodes: DfdNode[] = model.trust_boundaries.map((b, i) => {
		const pos = resolvePosition(b.id, b.position, { x: 50 + i * 450, y: 50 });
		const node = boundaryToNode(b, pos);
		// Restore dimensions: saved layout > existing canvas > default
		const saved = layoutPositions?.get(b.id);
		const existing = existingNodes.get(b.id);
		const w =
			saved?.width ?? existing?.width ?? (existing?.style as Record<string, unknown>)?.width;
		const h =
			saved?.height ?? existing?.height ?? (existing?.style as Record<string, unknown>)?.height;
		if (w != null && h != null) {
			node.width = w as number;
			node.height = h as number;
			node.style = {
				...node.style,
				width: w as number,
				height: h as number,
			};
		}
		return node;
	});

	// Build a set of elements that belong to boundaries
	const elementToBoundary = new Map<string, string>();
	for (const b of model.trust_boundaries) {
		for (const elementId of b.contains) {
			elementToBoundary.set(elementId, b.id);
		}
	}

	// Convert elements to nodes
	const elementNodes: DfdNode[] = model.elements.map((e, i) => {
		const parentBoundary = elementToBoundary.get(e.id);
		const pos = resolvePosition(
			e.id,
			e.position,
			{
				x: 100 + (i % 4) * (DEFAULT_NODE_WIDTH + 136),
				y: 100 + Math.floor(i / 4) * 208,
			},
			parentBoundary,
		);
		const node = elementToNode(e, pos);

		// Parent to boundary if contained
		if (parentBoundary) {
			node.parentId = parentBoundary;
			node.extent = "parent";
		}

		return node;
	});

	// Convert flows to edges, preserving handle assignments from existing edges.
	// Model handles are authoritative when present (from save/load, reconnect, addDataFlow);
	// only fall back to existing canvas state when the model has no handle data.
	const existingEdgeMap = new Map(current.edges.map((e) => [e.id, e]));
	const edges: DfdEdge[] = model.data_flows.map((flow) => {
		const edge = flowToEdge(flow);
		const existing = existingEdgeMap.get(flow.id);
		if (existing?.sourceHandle && !flow.source_handle) edge.sourceHandle = existing.sourceHandle;
		if (existing?.targetHandle && !flow.target_handle) edge.targetHandle = existing.targetHandle;
		// Preserve dragged label position only if model has no label_offset for this flow.
		// When the model has label_offset (e.g. after undo/redo or drag-end write-back),
		// flowToEdge already applied it — don't override with stale canvas data.
		if (
			!flow.label_offset &&
			(existing?.data?.labelOffsetX != null || existing?.data?.labelOffsetY != null)
		) {
			edge.data = {
				...(edge.data as DfdEdgeData),
				labelOffsetX: existing.data.labelOffsetX,
				labelOffsetY: existing.data.labelOffsetY,
			};
		}
		return edge;
	});

	const componentIds = new Set([...boundaryNodes, ...elementNodes].map((node) => node.id));
	const groupNodes = (model.groups ?? []).map((group, index) => {
		let canvasId = `architecture-group:${group.id}`;
		while (componentIds.has(canvasId)) canvasId = `:${canvasId}`;
		componentIds.add(canvasId);
		return architectureGroupToNode(group, index, canvasId);
	});

	return { nodes: [...boundaryNodes, ...groupNodes, ...elementNodes], edges };
}
